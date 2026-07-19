"""Carreras PostgreSQL de los avances durables del viaje."""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_accept_offer, get_cancel_ride
from app.api.v1.realtime_outbox import OutboxUpdateRideStatusEventRecorder
from app.application.dto import CancelRideResult, RideDetail
from app.application.use_cases.update_ride_status import UpdateRideStatus
from app.domain.entities import (
    Location,
    Offer,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.exceptions import InvalidRideTransitionError
from app.infrastructure.config import Settings
from app.infrastructure.db.models import RealtimeOutboxModel, RideRequestModel
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork

_TIMEOUT_SECONDS = 10


def _settings(*, enabled: bool = True) -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow" if enabled else "off",
        realtime_outbox_recording_enabled=enabled,
    )


def _rider() -> User:
    return User(
        full_name="Pasajero carrera estado",
        email=f"rider-status-race-{uuid.uuid4()}@test.com",
    )


def _driver() -> User:
    return User(
        full_name="Conductor carrera estado",
        email=f"driver-status-race-{uuid.uuid4()}@test.com",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        is_online=True,
    )


async def _insert_scenario(sessions):
    async with sessions() as session:
        users = SqlAlchemyUserRepository(session)
        rider = await users.add(_rider())
        driver = await users.add(_driver())
        rides = SqlAlchemyRideRequestRepository(session)
        ride = await rides.add(
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
        accepted = await get_accept_offer(
            rides,
            session,
            _settings(enabled=False),
        ).execute(rider, offer.id)
        return rider, driver, accepted.detail.ride


class _BarrierRides(SqlAlchemyRideRequestRepository):
    """Hace que ambos contendientes validen el mismo estado previo al CAS."""

    def __init__(
        self,
        session: AsyncSession,
        barrier: asyncio.Barrier,
        *,
        commit_update_if_state: bool = True,
    ) -> None:
        super().__init__(
            session,
            commit_update_if_state=commit_update_if_state,
        )
        self._barrier = barrier

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        ride = await super().get_by_id(ride_id)
        await self._barrier.wait()
        return ride


def _status_use_case(
    session: AsyncSession,
    rides: SqlAlchemyRideRequestRepository,
) -> UpdateRideStatus:
    return UpdateRideStatus(
        rides,
        SqlAlchemyOfferRepository(session),
        SqlAlchemyUserRepository(session),
        SqlAlchemyUnitOfWork(session),
        OutboxUpdateRideStatusEventRecorder(SqlAlchemyRealtimeOutbox(session)),
    )


async def test_duplicate_advance_has_one_winner_and_one_batch(pg_test_db) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    _, driver, ride = await _insert_scenario(sessions)
    barrier = asyncio.Barrier(2)

    async with sessions() as first_session, sessions() as second_session:
        first = _status_use_case(
            first_session,
            _BarrierRides(
                first_session,
                barrier,
                commit_update_if_state=False,
            ),
        )
        second = _status_use_case(
            second_session,
            _BarrierRides(
                second_session,
                barrier,
                commit_update_if_state=False,
            ),
        )

        results = await asyncio.wait_for(
            asyncio.gather(
                first.execute(driver, ride.id, RideStatus.ARRIVING),
                second.execute(driver, ride.id, RideStatus.ARRIVING),
                return_exceptions=True,
            ),
            timeout=_TIMEOUT_SECONDS,
        )

    assert sum(isinstance(result, RideDetail) for result in results) == 1
    assert sum(
        isinstance(result, InvalidRideTransitionError) for result in results
    ) == 1

    async with sessions() as verification_session:
        status = await verification_session.scalar(
            select(RideRequestModel.status).where(RideRequestModel.id == ride.id)
        )
        rows = (
            await verification_session.execute(
                select(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.aggregate_id == ride.id)
                .order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()

    assert status is RideStatus.ARRIVING
    assert [row.event_type for row in rows] == ["ride_status", "ride_status"]
    assert len({row.batch_id for row in rows}) == 1
    assert [row.sequence for row in rows] == [0, 1]
    assert [row.aggregate_version for row in rows] == [1, 2]
    assert [row.stream_version for row in rows] == [1, 1]


async def test_advance_and_cancel_preserve_only_winning_durable_outcome(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    rider, driver, ride = await _insert_scenario(sessions)
    barrier = asyncio.Barrier(2)

    async with sessions() as status_session, sessions() as cancel_session:
        status_use_case = _status_use_case(
            status_session,
            _BarrierRides(
                status_session,
                barrier,
                commit_update_if_state=False,
            ),
        )
        cancel_use_case = get_cancel_ride(
            _BarrierRides(cancel_session, barrier),
            SqlAlchemyUserRepository(cancel_session),
            cancel_session,
            _settings(),
        )

        advanced, cancelled = await asyncio.wait_for(
            asyncio.gather(
                status_use_case.execute(driver, ride.id, RideStatus.ARRIVING),
                cancel_use_case.execute(rider, ride.id),
                return_exceptions=True,
            ),
            timeout=_TIMEOUT_SECONDS,
        )

    advance_won = isinstance(advanced, RideDetail)
    cancel_won = isinstance(cancelled, CancelRideResult)
    assert advance_won is not cancel_won
    loser = cancelled if advance_won else advanced
    assert isinstance(loser, InvalidRideTransitionError)

    async with sessions() as verification_session:
        status = await verification_session.scalar(
            select(RideRequestModel.status).where(RideRequestModel.id == ride.id)
        )
        rows = (
            await verification_session.execute(
                select(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.aggregate_id == ride.id)
                .order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()

    if advance_won:
        assert status is RideStatus.ARRIVING
        assert [row.event_type for row in rows] == [
            "ride_status",
            "ride_status",
        ]
    else:
        assert status is RideStatus.CANCELLED
        assert [row.event_type for row in rows] == [
            "ride_status",
            "ride_status",
            "ride_closed",
        ]
    assert len({row.batch_id for row in rows}) == 1
