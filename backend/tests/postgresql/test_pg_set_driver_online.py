"""Carreras PostgreSQL de la desconexión durable del conductor."""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.deps import get_accept_offer, get_set_driver_online
from app.application.dto import AcceptOfferResult, DriverAvailabilityResult
from app.domain.entities import (
    Location,
    Offer,
    OfferStatus,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.exceptions import DriverUnavailableError, InvalidRideTransitionError
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeOutboxModel,
    RideRequestModel,
    UserModel,
)
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)

_TIMEOUT_SECONDS = 10


def _settings() -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_recording_enabled=True,
    )


async def _insert_scenario(sessions):
    async with sessions() as session:
        users = SqlAlchemyUserRepository(session)
        rider = await users.add(
            User(
                full_name="Pasajero carrera offline",
                email=f"rider-offline-race-{uuid.uuid4()}@test.com",
            )
        )
        driver = await users.add(
            User(
                full_name="Conductor carrera offline",
                email=f"driver-offline-race-{uuid.uuid4()}@test.com",
                role=UserRole.DRIVER,
                vehicle_type=VehicleType.TAXI,
                is_online=True,
            )
        )
        ride = await SqlAlchemyRideRequestRepository(session).add(
            RideRequest(
                rider_id=rider.id,
                origin=Location(-17.39, -66.15, "Origen", "Calle 1"),
                destination=Location(-17.40, -66.16, "Destino", "Calle 2"),
                service_type=ServiceType.TAXI,
                fare=Decimal("20.00"),
            )
        )
        offer = await SqlAlchemyOfferRepository(session).add(
            Offer(
                ride_id=ride.id,
                driver_id=driver.id,
                price=ride.fare,
                eta_min=5,
            )
        )
        return rider, driver, ride, offer


async def test_offline_and_accept_have_one_durable_winner(pg_test_db) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    rider, driver, ride, offer = await _insert_scenario(sessions)
    barrier = asyncio.Barrier(2)

    async with sessions() as accept_session, sessions() as offline_session:
        accept = get_accept_offer(
            SqlAlchemyRideRequestRepository(accept_session),
            accept_session,
            _settings(),
        )
        offline = get_set_driver_online(offline_session, _settings())

        async def run_accept():
            await barrier.wait()
            return await accept.execute(rider, offer.id)

        async def run_offline():
            await barrier.wait()
            return await offline.execute(driver, False)

        accepted, disconnected = await asyncio.wait_for(
            asyncio.gather(
                run_accept(),
                run_offline(),
                return_exceptions=True,
            ),
            timeout=_TIMEOUT_SECONDS,
        )

    accept_won = isinstance(accepted, AcceptOfferResult)
    offline_won = isinstance(disconnected, DriverAvailabilityResult)
    assert accept_won is not offline_won
    loser = disconnected if accept_won else accepted
    assert isinstance(
        loser,
        (DriverUnavailableError, InvalidRideTransitionError),
    )

    async with sessions() as verification_session:
        driver_online = await verification_session.scalar(
            select(UserModel.is_online).where(UserModel.id == driver.id)
        )
        ride_status = await verification_session.scalar(
            select(RideRequestModel.status).where(RideRequestModel.id == ride.id)
        )
        offer_status = await verification_session.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
        )
        event_types = (
            await verification_session.execute(
                select(RealtimeOutboxModel.event_type)
                .where(
                    RealtimeOutboxModel.aggregate_id.in_([ride.id, driver.id])
                )
                .order_by(
                    RealtimeOutboxModel.created_at,
                    RealtimeOutboxModel.sequence,
                )
            )
        ).scalars().all()

    if accept_won:
        assert driver_online is True
        assert ride_status is RideStatus.ACCEPTED
        assert offer_status is OfferStatus.ACCEPTED
        assert event_types == [
            "ride_status",
            "ride_closed",
            "offer_accepted",
            "offers_withdrawn",
        ]
    else:
        assert driver_online is False
        assert ride_status is RideStatus.SEARCHING
        assert offer_status is OfferStatus.REJECTED
        assert event_types == ["offer_withdrawn", "offers_withdrawn"]


async def test_two_offline_requests_create_one_withdrawal_batch(pg_test_db) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    _, driver, ride, offer = await _insert_scenario(sessions)
    barrier = asyncio.Barrier(2)

    async with sessions() as first_session, sessions() as second_session:
        first = get_set_driver_online(first_session, _settings())
        second = get_set_driver_online(second_session, _settings())

        async def run(use_case):
            await barrier.wait()
            return await use_case.execute(driver, False)

        results = await asyncio.wait_for(
            asyncio.gather(run(first), run(second)),
            timeout=_TIMEOUT_SECONDS,
        )

    assert all(isinstance(result, DriverAvailabilityResult) for result in results)
    assert sorted(len(result.withdrawn_offers) for result in results) == [0, 1]

    async with sessions() as verification_session:
        driver_online = await verification_session.scalar(
            select(UserModel.is_online).where(UserModel.id == driver.id)
        )
        offer_status = await verification_session.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
        )
        rows = (
            await verification_session.execute(
                select(RealtimeOutboxModel)
                .where(
                    RealtimeOutboxModel.aggregate_id.in_([ride.id, driver.id])
                )
                .order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()

    assert driver_online is False
    assert offer_status is OfferStatus.REJECTED
    assert [row.event_type for row in rows] == [
        "offer_withdrawn",
        "offers_withdrawn",
    ]
    assert len({row.batch_id for row in rows}) == 1
    assert [row.sequence for row in rows] == [0, 1]
    assert rows[0].payload == {
        "type": "offer_withdrawn",
        "data": {
            "driver_id": str(driver.id),
            "offer_id": str(offer.id),
            "reason": "driver_offline",
        },
    }
    assert rows[1].payload == {
        "type": "offers_withdrawn",
        "data": {
            "ride_ids": [str(ride.id)],
            "offers": [
                {
                    "ride_id": str(ride.id),
                    "offer_id": str(offer.id),
                }
            ],
            "reason": "driver_offline",
        },
    }
