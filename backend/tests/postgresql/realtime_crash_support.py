"""Servidor hijo y publishers coordinados para el smoke de crash realtime."""

from __future__ import annotations

import asyncio
import socket
import uuid
from collections.abc import Sequence
from typing import Any, Literal, TypeAlias

import uvicorn
from redis.asyncio import Redis
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    LocalHubRealtimeOutboxBatchPublisher,
)
from app.api.v1.redis_realtime import RedisRealtimeBridge
from app.application.dto import RealtimeOutboxEvent
from app.application.interfaces import RealtimeOutboxBatchPublisher
from app.infrastructure.config import Settings
from app.main import create_app

CrashWindow: TypeAlias = Literal["before_publish", "after_publish"]
RealtimeDispatchMode: TypeAlias = Literal["live_local", "live_redis"]

_COORDINATION_TIMEOUT_SECONDS = 30.0


def _matches_target(
    events: Sequence[RealtimeOutboxEvent],
    *,
    ride_id: uuid.UUID,
    event_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
) -> bool:
    topic = f"ride:{ride_id}"
    return any(
        event.event_type == "offer_created"
        and event.topic == topic
        and (event_id is None or event.id == event_id)
        and (batch_id is None or event.batch_id == batch_id)
        for event in events
    )


async def _wait_release(release: Any) -> None:
    deadline = asyncio.get_running_loop().time() + _COORDINATION_TIMEOUT_SECONDS
    while not release.is_set():
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError("La coordinación del smoke de crash venció.")
        await asyncio.sleep(0.01)


class CrashGateRealtimeOutboxBatchPublisher(RealtimeOutboxBatchPublisher):
    """Suspende un batch una sola vez justo antes o después de publicarlo."""

    def __init__(
        self,
        delegate: RealtimeOutboxBatchPublisher,
        *,
        ride_id: uuid.UUID,
        window: CrashWindow,
        reached: Any,
        release: Any,
    ) -> None:
        self._delegate = delegate
        self._ride_id = ride_id
        self._window = window
        self._reached = reached
        self._release = release
        self._hit = False

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        matches = not self._hit and _matches_target(
            events,
            ride_id=self._ride_id,
        )
        if matches and self._window == "before_publish":
            self._hit = True
            self._reached.set()
            await _wait_release(self._release)

        await self._delegate.publish(events)

        if matches and self._window == "after_publish":
            self._hit = True
            self._reached.set()
            await _wait_release(self._release)

    async def force_resync(self, streams: Sequence[str]) -> None:
        await self._delegate.force_resync(streams)


class RecoveryGateRealtimeOutboxBatchPublisher(RealtimeOutboxBatchPublisher):
    """Retiene el replay exacto hasta que el cliente de recuperación se suscriba."""

    def __init__(
        self,
        delegate: RealtimeOutboxBatchPublisher,
        *,
        ride_id: uuid.UUID,
        event_id: uuid.UUID,
        batch_id: uuid.UUID,
        reached: Any,
        release: Any,
        published: Any,
    ) -> None:
        self._delegate = delegate
        self._ride_id = ride_id
        self._event_id = event_id
        self._batch_id = batch_id
        self._reached = reached
        self._release = release
        self._published = published
        self._hit = False

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        matches = not self._hit and _matches_target(
            events,
            ride_id=self._ride_id,
            event_id=self._event_id,
            batch_id=self._batch_id,
        )
        if matches:
            self._hit = True
            self._reached.set()
            await _wait_release(self._release)

        await self._delegate.publish(events)
        if matches:
            self._published.set()

    async def force_resync(self, streams: Sequence[str]) -> None:
        await self._delegate.force_resync(streams)


class CrashGateRedisRealtimeBridge(RedisRealtimeBridge):
    """Bridge Redis real con la misma compuerta exacta del crash local."""

    def __init__(
        self,
        *args: Any,
        ride_id: uuid.UUID,
        window: CrashWindow,
        reached: Any,
        release: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._target_ride_id = ride_id
        self._window = window
        self._reached = reached
        self._release = release
        self._hit = False

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        matches = not self._hit and _matches_target(
            events,
            ride_id=self._target_ride_id,
        )
        if matches and self._window == "before_publish":
            self._hit = True
            self._reached.set()
            await _wait_release(self._release)

        await super().publish(events)

        if matches and self._window == "after_publish":
            self._hit = True
            self._reached.set()
            await _wait_release(self._release)


class RecoveryGateRedisRealtimeBridge(RedisRealtimeBridge):
    """Bridge Redis real que retiene el replay hasta conectar el cliente."""

    def __init__(
        self,
        *args: Any,
        ride_id: uuid.UUID,
        event_id: uuid.UUID,
        batch_id: uuid.UUID,
        reached: Any,
        release: Any,
        published: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._target_ride_id = ride_id
        self._event_id = event_id
        self._batch_id = batch_id
        self._reached = reached
        self._release = release
        self._published = published
        self._hit = False

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        matches = not self._hit and _matches_target(
            events,
            ride_id=self._target_ride_id,
            event_id=self._event_id,
            batch_id=self._batch_id,
        )
        if matches:
            self._hit = True
            self._reached.set()
            await _wait_release(self._release)

        await super().publish(events)
        if matches:
            self._published.set()


def _validate_test_database_url(database_url: str) -> None:
    url = make_url(database_url)
    database = url.database or ""
    if url.drivername != "postgresql+asyncpg":
        raise RuntimeError("El smoke de crash requiere postgresql+asyncpg.")
    if not (database.startswith("test_") or database.endswith("_test")):
        raise RuntimeError("El smoke de crash requiere una base desechable de test.")


def run_realtime_server_process(
    listener: socket.socket,
    database_url: str,
    jwt_secret: str,
    ride_id: str,
    shutdown: Any,
    mode: Literal["crash", "recovery"],
    reached: Any,
    release: Any,
    *,
    crash_window: CrashWindow | None = None,
    dispatch_mode: RealtimeDispatchMode = "live_local",
    event_id: str | None = None,
    batch_id: str | None = None,
    published: Any | None = None,
    redis_url: str | None = None,
    redis_channel: str | None = None,
) -> None:
    """Punto de entrada picklable del proceso Uvicorn exclusivo de tests."""
    _validate_test_database_url(database_url)
    resolved_ride_id = uuid.UUID(ride_id)
    engine = create_async_engine(database_url, poolclass=NullPool)
    sessions = async_sessionmaker[AsyncSession](engine, expire_on_commit=False)
    settings = Settings(
        _env_file=None,
        database_url=database_url,
        jwt_secret=jwt_secret,
        realtime_outbox_dispatch_mode=dispatch_mode,
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=0.01,
        realtime_outbox_retry_base_seconds=0.05,
        realtime_outbox_retry_max_seconds=0.1,
        realtime_outbox_shutdown_timeout_seconds=2,
        realtime_redis_url=redis_url or "redis://localhost:6379/0",
        realtime_redis_channel=redis_channel or "viajaya:realtime",
        realtime_redis_connect_timeout_seconds=2,
        realtime_redis_reconnect_base_seconds=0.05,
        realtime_redis_reconnect_max_seconds=0.2,
    )
    app_options: dict[str, object] = {}
    if dispatch_mode == "live_local":
        delegate = LocalHubRealtimeOutboxBatchPublisher()
        if mode == "crash":
            if crash_window is None:
                raise RuntimeError("La instancia crash requiere una ventana exacta.")
            publisher: RealtimeOutboxBatchPublisher = CrashGateRealtimeOutboxBatchPublisher(
                delegate,
                ride_id=resolved_ride_id,
                window=crash_window,
                reached=reached,
                release=release,
            )
        else:
            if event_id is None or batch_id is None or published is None:
                raise RuntimeError("La recuperación requiere la identidad durable.")
            publisher = RecoveryGateRealtimeOutboxBatchPublisher(
                delegate,
                ride_id=resolved_ride_id,
                event_id=uuid.UUID(event_id),
                batch_id=uuid.UUID(batch_id),
                reached=reached,
                release=release,
                published=published,
            )
        app_options["realtime_outbox_batch_publisher"] = publisher
    else:
        if not redis_url or not redis_channel:
            raise RuntimeError("El crash live_redis requiere URL y canal aislados.")
        client = Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            health_check_interval=1,
        )
        bridge_options = {
            "channel": redis_channel,
            "connect_timeout_seconds": 2,
            "reconnect_base_seconds": 0.05,
            "reconnect_max_seconds": 0.2,
        }
        if mode == "crash":
            if crash_window is None:
                raise RuntimeError("La instancia crash requiere una ventana exacta.")
            bridge = CrashGateRedisRealtimeBridge(
                client,
                ride_id=resolved_ride_id,
                window=crash_window,
                reached=reached,
                release=release,
                **bridge_options,
            )
        else:
            if event_id is None or batch_id is None or published is None:
                raise RuntimeError("La recuperación requiere la identidad durable.")
            bridge = RecoveryGateRedisRealtimeBridge(
                client,
                ride_id=resolved_ride_id,
                event_id=uuid.UUID(event_id),
                batch_id=uuid.UUID(batch_id),
                reached=reached,
                release=release,
                published=published,
                **bridge_options,
            )
        app_options["realtime_redis_bridge"] = bridge

    app = create_app(
        settings=settings,
        session_factory=sessions,
        realtime_outbox_batch_validator=CanonicalRealtimeOutboxBatchValidator(),
        **app_options,
    )
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            log_level="warning",
            access_log=False,
            lifespan="on",
            timeout_graceful_shutdown=2,
        )
    )
    async def serve_until_shutdown() -> None:
        server_task = asyncio.create_task(
            server.serve(sockets=[listener]),
            name="realtime-crash-smoke-uvicorn",
        )
        try:
            while not shutdown.is_set():
                if server_task.done():
                    await server_task
                    return
                await asyncio.sleep(0.02)
            server.should_exit = True
            await server_task
        finally:
            if not server_task.done():
                server.should_exit = True
                await asyncio.gather(server_task, return_exceptions=True)
            await engine.dispose()

    asyncio.run(serve_until_shutdown())
