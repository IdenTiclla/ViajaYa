"""live_redis Uvicorn process for the multi-worker smoke."""

from __future__ import annotations

import asyncio
import socket
import uuid
from collections.abc import Sequence
from typing import Any

import uvicorn
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.redis_realtime import RedisRealtimeBridge
from app.application.dto import RealtimeOutboxEvent
from app.infrastructure.config import Settings
from app.main import create_app
from tests.postgresql.realtime_crash_support import _validate_test_database_url

_COORDINATION_TIMEOUT_SECONDS = 30.0


async def _wait_release(release: Any) -> None:
    deadline = asyncio.get_running_loop().time() + _COORDINATION_TIMEOUT_SECONDS
    while not release.is_set():
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError("La coordinación del restart Redis venció.")
        await asyncio.sleep(0.01)


class RestartGateRedisRealtimeBridge(RedisRealtimeBridge):
    """Hold the first failure and the replay of a test-only event."""

    def __init__(
        self,
        *args: Any,
        ride_id: uuid.UUID,
        first_reached: Any,
        first_release: Any,
        first_failed: Any,
        replay_reached: Any,
        replay_release: Any,
        replay_published: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._target_topic = f"ride:{ride_id}"
        self._first_reached = first_reached
        self._first_release = first_release
        self._first_failed = first_failed
        self._replay_reached = replay_reached
        self._replay_release = replay_release
        self._replay_published = replay_published
        self._target_attempts = 0

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        matches = any(
            event.event_type == "offer_created"
            and event.topic == self._target_topic
            for event in events
        )
        if not matches:
            await super().publish(events)
            return

        self._target_attempts += 1
        if self._target_attempts == 1:
            self._first_reached.set()
            await _wait_release(self._first_release)
            try:
                await super().publish(events)
            except BaseException:
                self._first_failed.set()
                raise
            raise RuntimeError("Redis publicó durante la ventana de caída del test.")

        if self._target_attempts == 2:
            self._replay_reached.set()
            await _wait_release(self._replay_release)
            await super().publish(events)
            self._replay_published.set()
            return

        await super().publish(events)


def run_redis_realtime_server_process(
    listener: socket.socket,
    database_url: str,
    redis_url: str,
    redis_channel: str,
    jwt_secret: str,
    shutdown: Any,
    shared_presence_enabled: bool = False,
) -> None:
    """Picklable entry point of an API replica with its own local hub."""
    _validate_test_database_url(database_url)
    if not redis_url.startswith(("redis://", "rediss://")):
        raise RuntimeError("El smoke multiworker requiere una URL Redis aislada.")

    engine = create_async_engine(database_url, poolclass=NullPool)
    sessions = async_sessionmaker[AsyncSession](engine, expire_on_commit=False)
    settings = Settings(
        _env_file=None,
        database_url=database_url,
        jwt_secret=jwt_secret,
        phone_otp_enabled=True,
        realtime_outbox_dispatch_mode="live_redis",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=0.01,
        realtime_outbox_shutdown_timeout_seconds=2,
        realtime_redis_url=redis_url,
        realtime_redis_channel=redis_channel,
        realtime_redis_connect_timeout_seconds=2,
        realtime_redis_reconnect_base_seconds=0.05,
        realtime_redis_reconnect_max_seconds=0.2,
        realtime_shared_presence_enabled=shared_presence_enabled,
        realtime_presence_key_prefix=f"{redis_channel}:presence",
        realtime_presence_lease_seconds=2,
        realtime_presence_renew_interval_seconds=0.5,
        realtime_presence_grace_seconds=2,
        realtime_presence_recheck_seconds=0.1,
        scheduled_actions_mode="live" if shared_presence_enabled else "off",
        scheduled_actions_poll_interval_seconds=0.05,
    )
    app = create_app(settings=settings, session_factory=sessions)
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
            name="realtime-redis-multiworker-uvicorn",
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


def run_redis_restart_server_process(
    listener: socket.socket,
    database_url: str,
    redis_url: str,
    redis_channel: str,
    jwt_secret: str,
    ride_id: str,
    shutdown: Any,
    first_reached: Any,
    first_release: Any,
    first_failed: Any,
    replay_reached: Any,
    replay_release: Any,
    replay_published: Any,
) -> None:
    """Instancia live_redis con compuertas alrededor de un publish durable."""
    _validate_test_database_url(database_url)
    if not redis_url.startswith(("redis://", "rediss://")):
        raise RuntimeError("El smoke de restart requiere una URL Redis aislada.")

    engine = create_async_engine(database_url, poolclass=NullPool)
    sessions = async_sessionmaker[AsyncSession](engine, expire_on_commit=False)
    settings = Settings(
        _env_file=None,
        database_url=database_url,
        jwt_secret=jwt_secret,
        phone_otp_enabled=True,
        realtime_outbox_dispatch_mode="live_redis",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=0.01,
        realtime_outbox_retry_base_seconds=0.05,
        realtime_outbox_retry_max_seconds=0.1,
        realtime_outbox_shutdown_timeout_seconds=2,
        realtime_redis_url=redis_url,
        realtime_redis_channel=redis_channel,
        realtime_redis_connect_timeout_seconds=0.5,
        realtime_redis_reconnect_base_seconds=0.05,
        realtime_redis_reconnect_max_seconds=0.2,
    )
    client = Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=0.5,
        socket_timeout=0.5,
        health_check_interval=1,
    )
    bridge = RestartGateRedisRealtimeBridge(
        client,
        channel=redis_channel,
        connect_timeout_seconds=0.5,
        reconnect_base_seconds=0.05,
        reconnect_max_seconds=0.2,
        ride_id=uuid.UUID(ride_id),
        first_reached=first_reached,
        first_release=first_release,
        first_failed=first_failed,
        replay_reached=replay_reached,
        replay_release=replay_release,
        replay_published=replay_published,
    )
    app = create_app(
        settings=settings,
        session_factory=sessions,
        realtime_redis_bridge=bridge,
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
            name="realtime-redis-restart-uvicorn",
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
