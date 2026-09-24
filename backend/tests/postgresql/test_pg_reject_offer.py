"""PostgreSQL race between rejecting and accepting the same offer."""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.deps import get_accept_offer, get_reject_offer
from app.application.dto import AcceptOfferResult
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
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidRideTransitionError,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeOutboxModel,
    RideRequestModel,
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
                full_name="Pasajero carrera rechazo",
                email=f"rider-reject-race-{uuid.uuid4()}@test.com",
            )
        )
        driver = await users.add(
            User(
                full_name="Conductor carrera rechazo",
                email=f"driver-reject-race-{uuid.uuid4()}@test.com",
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


async def test_reject_and_accept_have_one_winner_and_one_durable_outcome(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    rider, driver, ride, offer = await _insert_scenario(sessions)
    barrier = asyncio.Barrier(2)

    async with sessions() as accept_session, sessions() as reject_session:
        accept = get_accept_offer(
            SqlAlchemyRideRequestRepository(accept_session),
            accept_session,
            _settings(),
        )
        reject = get_reject_offer(
            SqlAlchemyRideRequestRepository(reject_session),
            reject_session,
            _settings(),
        )

        async def run_accept():
            await barrier.wait()
            return await accept.execute(rider, offer.id)

        async def run_reject():
            await barrier.wait()
            return await reject.execute(rider, offer.id)

        accepted, rejected = await asyncio.wait_for(
            asyncio.gather(
                run_accept(),
                run_reject(),
                return_exceptions=True,
            ),
            timeout=_TIMEOUT_SECONDS,
        )

    accept_won = isinstance(accepted, AcceptOfferResult)
    reject_won = isinstance(rejected, Offer)
    assert accept_won is not reject_won

    async with pg_test_db.engine.connect() as connection:
        offer_status = await connection.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
        )
        ride_status = await connection.scalar(
            select(RideRequestModel.status).where(RideRequestModel.id == ride.id)
        )
        event_types = (
            await connection.execute(
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
        assert isinstance(rejected, InvalidRideTransitionError)
        assert offer_status is OfferStatus.ACCEPTED
        assert ride_status is RideStatus.ACCEPTED
        assert "offer_rejected" not in event_types
        assert event_types == [
            "ride_status",
            "ride_closed",
            "offer_accepted",
            "offers_withdrawn",
        ]
    else:
        assert isinstance(
            accepted,
            (DriverUnavailableError, InvalidRideTransitionError),
        )
        assert offer_status is OfferStatus.REJECTED
        assert ride_status is RideStatus.SEARCHING
        assert event_types == ["offer_rejected"]
