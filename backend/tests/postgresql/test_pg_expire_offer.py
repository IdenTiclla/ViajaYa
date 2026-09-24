"""Carreras PostgreSQL del vencimiento durable de ofertas."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.deps import build_expire_offer, get_accept_offer, get_withdraw_offer
from app.domain import ride_policy
from app.domain.entities import (
    Location,
    Offer,
    OfferStatus,
    RideRequest,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.config import Settings
from app.infrastructure.db.models import OfferModel, RealtimeOutboxModel
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


async def _insert_scenario(sessions, *, expired: bool = True):
    async with sessions() as session:
        users = SqlAlchemyUserRepository(session)
        rider = await users.add(
            User(
                full_name="Pasajero carrera expiración",
                email=f"rider-expire-race-{uuid.uuid4()}@test.com",
            )
        )
        driver = await users.add(
            User(
                full_name="Conductor carrera expiración",
                email=f"driver-expire-race-{uuid.uuid4()}@test.com",
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
        if expired:
            await session.execute(
                update(OfferModel)
                .where(OfferModel.id == offer.id)
                .values(
                    created_at=datetime.now(UTC)
                    - OFFER_TTL
                    - timedelta(seconds=1)
                )
            )
            await session.commit()
        return rider, driver, ride, offer


async def test_two_expirations_create_one_batch(pg_test_db) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    _, _, ride, offer = await _insert_scenario(sessions)
    barrier = asyncio.Barrier(2)

    async with sessions() as first_session, sessions() as second_session:
        first = build_expire_offer(first_session, _settings())
        second = build_expire_offer(second_session, _settings())

        async def run(use_case):
            await barrier.wait()
            return await use_case.execute(offer.id)

        results = await asyncio.wait_for(
            asyncio.gather(run(first), run(second)),
            timeout=_TIMEOUT_SECONDS,
        )

    assert sum(result is not None for result in results) == 1

    async with sessions() as verification_session:
        offer_status = await verification_session.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
        )
        outbox_rows = (
            await verification_session.execute(
                select(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.aggregate_id == ride.id)
                .order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()

    assert offer_status is OfferStatus.EXPIRED
    assert [row.event_type for row in outbox_rows] == [
        "offer_expired",
        "offer_expired",
    ]
    assert len({row.batch_id for row in outbox_rows}) == 1
    assert [row.sequence for row in outbox_rows] == [0, 1]
    assert [row.aggregate_version for row in outbox_rows] == [1, 2]
    assert [row.stream_version for row in outbox_rows] == [1, 1]


async def test_stale_expiration_does_not_overwrite_concurrent_withdrawal(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    _, driver, ride, offer = await _insert_scenario(sessions)

    async with sessions() as stale_session:
        cached = await stale_session.get(OfferModel, offer.id)
        assert cached is not None and cached.status is OfferStatus.PENDING

        async with sessions() as withdraw_session:
            withdrawn = await get_withdraw_offer(
                withdraw_session,
                _settings(),
            ).execute(driver, offer.id)
            assert withdrawn.status is OfferStatus.REJECTED

        expired = await build_expire_offer(
            stale_session,
            _settings(),
        ).execute(offer.id)

    assert expired is None

    async with pg_test_db.engine.connect() as connection:
        offer_status = await connection.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
        )
        event_types = (
            await connection.execute(
                select(RealtimeOutboxModel.event_type)
                .where(RealtimeOutboxModel.aggregate_id == ride.id)
                .order_by(
                    RealtimeOutboxModel.created_at,
                    RealtimeOutboxModel.sequence,
                )
            )
        ).scalars().all()

    assert offer_status is OfferStatus.REJECTED
    assert event_types == ["offer_withdrawn"]


async def test_stale_expiration_does_not_overwrite_concurrent_acceptance(
    pg_test_db,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    rider, driver, ride, offer = await _insert_scenario(sessions, expired=False)

    async with sessions() as stale_session:
        cached = await stale_session.get(OfferModel, offer.id)
        assert cached is not None and cached.status is OfferStatus.PENDING

        async with sessions() as accept_session:
            accepted = await get_accept_offer(
                SqlAlchemyRideRequestRepository(accept_session),
                accept_session,
                _settings(),
            ).execute(rider, offer.id)
            assert accepted.detail.accepted_offer is not None
            assert accepted.detail.accepted_offer.status is OfferStatus.ACCEPTED

        # The preloaded PENDING copy would already be eligible to expire. Without
        # populate_existing, the lock would reuse that stale state and
        # overwrite the confirmed acceptance.
        monkeypatch.setattr(ride_policy, "OFFER_TTL", timedelta(seconds=0))
        expired = await build_expire_offer(
            stale_session,
            _settings(),
        ).execute(offer.id)

    assert expired is None

    async with pg_test_db.engine.connect() as connection:
        offer_status = await connection.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
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

    assert offer_status is OfferStatus.ACCEPTED
    assert event_types == [
        "ride_status",
        "ride_closed",
        "offer_accepted",
        "offers_withdrawn",
    ]
