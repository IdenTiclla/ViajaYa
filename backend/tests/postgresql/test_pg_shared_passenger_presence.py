"""Presencia Redis y cancel_absent_ride durable sobre infraestructura real."""

from __future__ import annotations

import asyncio
import os
import uuid
from decimal import Decimal

import pytest
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.scheduled_actions import ApplicationScheduledActionExecutor
from app.application.use_cases.disconnect_passenger_presence import (
    DisconnectPassengerPresence,
)
from app.application.use_cases.renew_passenger_presence import RenewPassengerPresence
from app.domain.entities import Location, RideRequest, RideStatus, ServiceType, User
from app.infrastructure.config import Settings
from app.infrastructure.db.clock import database_utc_now
from app.infrastructure.db.models import RealtimeOutboxModel, ScheduledActionModel
from app.infrastructure.db.repositories import (
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime.hub import RealtimeHub
from app.infrastructure.realtime.passenger_presence import (
    RedisPassengerPresenceStore,
)
from app.infrastructure.scheduled_actions.worker import ScheduledActionsWorker


def _redis_url() -> str:
    url = os.getenv("VIAJAYA_TEST_REDIS_URL")
    if not url:
        pytest.skip("Define VIAJAYA_TEST_REDIS_URL para probar presencia compartida.")
    return url


def _store(
    client: Redis,
    prefix: str,
    *,
    lease_seconds: float = 0.1,
    grace_seconds: float = 0.2,
) -> RedisPassengerPresenceStore:
    return RedisPassengerPresenceStore(
        client,
        key_prefix=prefix,
        lease_seconds=lease_seconds,
        grace_seconds=grace_seconds,
        timeout_seconds=1,
        transport_hub=RealtimeHub(),
    )


async def test_lua_conserva_otra_conexion_y_expira_la_gracia() -> None:
    client = Redis.from_url(_redis_url(), decode_responses=True)
    prefix = f"viajaya:test:presence:{uuid.uuid4()}"
    store = _store(client, prefix)
    ride_id = uuid.uuid4()
    first = uuid.uuid4()
    second = uuid.uuid4()
    try:
        await store.preflight()
        await store.renew_websocket(ride_id, first)
        await store.renew_websocket(ride_id, second)
        await store.disconnect_websocket(ride_id, first)
        assert (await store.observe(ride_id)).live is True

        await store.disconnect_websocket(ride_id, second)
        disconnected = await store.observe(ride_id)
        assert disconnected.live is False
        assert disconnected.present is True
        await asyncio.sleep(0.25)
        assert (await store.observe(ride_id)).present is False
    finally:
        await client.delete(f"{prefix}:ride:{ride_id}")
        await store.aclose()


async def test_scheduler_cancela_solo_tras_ausencia_redis_confirmada(
    pg_test_db,
) -> None:
    redis_client = Redis.from_url(_redis_url(), decode_responses=True)
    prefix = f"viajaya:test:presence:{uuid.uuid4()}"
    store = _store(redis_client, prefix, lease_seconds=0.05, grace_seconds=0.15)
    sessions = async_sessionmaker(
        pg_test_db.engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    settings = Settings(
        _env_file=None,
        database_url=pg_test_db.url,
        realtime_outbox_dispatch_mode="live_redis",
        realtime_outbox_recording_enabled=True,
        scheduled_actions_mode="live",
        realtime_shared_presence_enabled=True,
        realtime_presence_recheck_seconds=0.05,
    )
    connection_id = uuid.uuid4()
    ride_id: uuid.UUID | None = None
    try:
        await store.preflight()
        async with sessions() as session:
            rider = await SqlAlchemyUserRepository(session).add(
                User(
                    full_name="Pasajero presencia durable",
                    email=f"presence-{uuid.uuid4()}@test.com",
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
            ride_id = ride.id

        async with sessions() as session:
            now = await database_utc_now(session)
            first = await RenewPassengerPresence(
                store,
                SqlAlchemyScheduledActionRepository(session),
                SqlAlchemyUnitOfWork(session),
            ).execute(
                ride.id,
                now,
                source="websocket",
                connection_id=connection_id,
            )
        async with sessions() as session:
            now = await database_utc_now(session)
            second = await DisconnectPassengerPresence(
                store,
                SqlAlchemyScheduledActionRepository(session),
                SqlAlchemyUnitOfWork(session),
            ).execute(ride.id, connection_id, now)

        assert second.id == first.id
        assert second.generation == first.generation + 1
        await asyncio.sleep(0.2)

        worker = ScheduledActionsWorker(
            sessions,
            ApplicationScheduledActionExecutor(
                sessions,
                settings,
                passenger_presence=store,
            ),
            poll_interval_seconds=1,
            lease_seconds=30,
            handler_timeout_seconds=10,
            max_attempts=5,
            retry_base_seconds=0.1,
            retry_max_seconds=1,
        )
        outcome = await worker.dispatch_once()

        assert outcome.status == "succeeded"
        async with sessions() as session:
            persisted_ride = await SqlAlchemyRideRequestRepository(session).get_by_id(
                ride.id
            )
            action = await session.scalar(
                select(ScheduledActionModel).where(
                    ScheduledActionModel.dedupe_key
                    == f"cancel_absent_ride:{ride.id}"
                )
            )
            outbox_rows = (
                await session.scalars(
                    select(RealtimeOutboxModel).where(
                        RealtimeOutboxModel.aggregate_id == ride.id
                    )
                )
            ).all()
        assert persisted_ride is not None
        assert persisted_ride.status is RideStatus.CANCELLED
        assert action is not None and action.status == "succeeded"
        assert len(outbox_rows) >= 2
        assert {row.correlation_id for row in outbox_rows} == {action.id}
    finally:
        if ride_id is not None:
            await redis_client.delete(f"{prefix}:ride:{ride_id}")
        await store.aclose()
