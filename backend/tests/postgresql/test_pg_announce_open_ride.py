"""Orden transaccional PostgreSQL del anuncio de presencia."""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.deps import build_cancel_ride_on_disconnect
from app.api.v1.realtime_outbox import OutboxAnnounceOpenRideEventRecorder
from app.application.use_cases.announce_open_ride import AnnounceOpenRide
from app.domain.entities import Location, RideRequest, User
from app.infrastructure.config import Settings
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork

_TIMEOUT_SECONDS = 10


def _settings() -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_recording_enabled=True,
    )


async def _insert_scenario(sessions):
    async with sessions() as session:
        rider = await SqlAlchemyUserRepository(session).add(
            User(
                full_name="Pasajero presencia",
                email=f"presence-{uuid.uuid4()}@concurrency.test",
            )
        )
        ride = await SqlAlchemyRideRequestRepository(session).add(
            RideRequest(
                rider_id=rider.id,
                origin=Location(-17.39, -66.15, "Origen", "Calle 1"),
                destination=Location(-17.40, -66.16, "Destino", "Calle 2"),
                fare=Decimal("20.00"),
            )
        )
        return ride


async def _wait_for_database_lock(engine, backend_pid: int) -> None:
    """Espera evidencia de PostgreSQL, no un retraso temporal del task."""
    async def wait() -> None:
        while True:
            async with engine.connect() as connection:
                wait_event_type = await connection.scalar(
                    text(
                        """
                        SELECT wait_event_type
                        FROM pg_stat_activity
                        WHERE pid = :backend_pid
                        """
                    ),
                    {"backend_pid": backend_pid},
                )
            if wait_event_type == "Lock":
                return
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait(), timeout=_TIMEOUT_SECONDS)


async def test_announcement_lock_orders_following_cancellation(pg_test_db) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    ride = await _insert_scenario(sessions)
    recorded = asyncio.Event()
    release = asyncio.Event()

    async with sessions() as announce_session, sessions() as cancel_session:
        delegate = OutboxAnnounceOpenRideEventRecorder(
            SqlAlchemyRealtimeOutbox(announce_session)
        )

        class PausingRecorder:
            async def record(self, detail) -> None:
                await delegate.record(detail)
                recorded.set()
                await release.wait()

        announce = AnnounceOpenRide(
            SqlAlchemyRideRequestRepository(announce_session),
            SqlAlchemyUnitOfWork(announce_session),
            PausingRecorder(),
        )
        cancellation = build_cancel_ride_on_disconnect(
            cancel_session,
            _settings(),
        )
        cancel_backend_pid = await cancel_session.scalar(text("SELECT pg_backend_pid()"))
        assert cancel_backend_pid is not None

        announce_task = asyncio.create_task(announce.execute(ride.id))
        await asyncio.wait_for(recorded.wait(), timeout=_TIMEOUT_SECONDS)
        cancel_task = asyncio.create_task(cancellation.execute(ride.id))
        await _wait_for_database_lock(pg_test_db.engine, cancel_backend_pid)

        assert not cancel_task.done()
        release.set()
        announced, cancelled = await asyncio.wait_for(
            asyncio.gather(announce_task, cancel_task),
            timeout=_TIMEOUT_SECONDS,
        )

    assert announced is not None
    assert cancelled is not None
    async with pg_test_db.engine.connect() as connection:
        rows = (
            await connection.execute(
                select(
                    RealtimeOutboxModel.event_type,
                    RealtimeOutboxModel.aggregate_version,
                )
                .where(RealtimeOutboxModel.aggregate_id == ride.id)
                .order_by(
                    RealtimeOutboxModel.aggregate_version
                )
            )
        ).all()

    assert rows == [
        ("ride_created", 1),
        ("ride_status", 2),
        ("ride_closed", 3),
    ]


async def test_cancellation_committed_first_prevents_late_announcement(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    ride = await _insert_scenario(sessions)

    async with sessions() as cancel_session:
        cancelled = await build_cancel_ride_on_disconnect(
            cancel_session,
            _settings(),
        ).execute(ride.id)
    async with sessions() as announce_session:
        announced = await AnnounceOpenRide(
            SqlAlchemyRideRequestRepository(announce_session),
            SqlAlchemyUnitOfWork(announce_session),
            OutboxAnnounceOpenRideEventRecorder(
                SqlAlchemyRealtimeOutbox(announce_session)
            ),
        ).execute(ride.id)

    assert cancelled is not None
    assert announced is None
    async with pg_test_db.engine.connect() as connection:
        event_types = (
            await connection.execute(
                select(RealtimeOutboxModel.event_type)
                .where(RealtimeOutboxModel.aggregate_id == ride.id)
                .order_by(
                    RealtimeOutboxModel.aggregate_version
                )
            )
        ).scalars().all()

    assert event_types == ["ride_status", "ride_closed"]
