"""Fanout real Redis entre dos hubs locales independientes."""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime

import pytest
from redis.asyncio import Redis

from app.api.v1.redis_realtime import RedisRealtimeBridge
from app.application.dto import RealtimeOutboxEvent
from app.infrastructure.realtime.hub import RealtimeHub


class _RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []
        self.closed_with: list[int] = []

    async def send_json(self, message: dict[str, object]) -> None:
        self.messages.append(message)

    async def close(self, code: int) -> None:
        self.closed_with.append(code)


def _event() -> RealtimeOutboxEvent:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC)
    return RealtimeOutboxEvent(
        id=uuid.uuid4(),
        batch_id=uuid.uuid4(),
        correlation_id=uuid.uuid4(),
        sequence=0,
        batch_size=1,
        event_type="ride_closed",
        topic="pool:taxi",
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=1,
        stream_version=1,
        payload={
            "type": "ride_closed",
            "data": {
                "ride_id": str(ride_id),
                "pool_version": 1,
                "reason": "terminal",
            },
        },
        created_at=now,
        next_attempt_at=now,
        published_at=None,
        attempts=1,
        last_error=None,
    )


async def test_real_redis_delivers_the_same_event_to_two_processes(pg_test_db) -> None:
    del pg_test_db
    redis_url = os.getenv("VIAJAYA_TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("Set VIAJAYA_TEST_REDIS_URL to certify the Redis fan-out.")

    channel = f"viajaya:test:realtime:{uuid.uuid4()}"
    first_hub = RealtimeHub()
    second_hub = RealtimeHub()
    first_socket = _RecordingSocket()
    second_socket = _RecordingSocket()
    first_hub.subscribe("pool:taxi", first_socket)  # type: ignore[arg-type]
    second_hub.subscribe("pool:taxi", second_socket)  # type: ignore[arg-type]
    first = RedisRealtimeBridge.from_url(
        redis_url,
        channel=channel,
        connect_timeout_seconds=2,
        reconnect_base_seconds=0.05,
        reconnect_max_seconds=0.2,
        local_hub=first_hub,
    )
    second = RedisRealtimeBridge.from_url(
        redis_url,
        channel=channel,
        connect_timeout_seconds=2,
        reconnect_base_seconds=0.05,
        reconnect_max_seconds=0.2,
        local_hub=second_hub,
    )
    await asyncio.gather(first.preflight(), second.preflight())
    first_task = asyncio.create_task(first.run())
    second_task = asyncio.create_task(second.run())
    try:
        await asyncio.gather(
            first.wait_until_ready(2),
            second.wait_until_ready(2),
        )
        await first.publish([_event()])
        for _ in range(100):
            if first_socket.messages and second_socket.messages:
                break
            await asyncio.sleep(0.01)

        assert len(first_socket.messages) == 1
        assert second_socket.messages == first_socket.messages
        assert first.last_publish_subscriber_count == 2

        admin = Redis.from_url(redis_url, decode_responses=True)
        try:
            killed = int(
                await admin.execute_command(
                    "CLIENT",
                    "KILL",
                    "TYPE",
                    "pubsub",
                    "SKIPME",
                    "yes",
                )
            )
        finally:
            await admin.aclose()
        assert killed >= 2
        for _ in range(200):
            if (
                first.reconnect_count
                and second.reconnect_count
                and first.connected
                and second.connected
            ):
                break
            await asyncio.sleep(0.01)
        assert first_socket.closed_with == [1012]
        assert second_socket.closed_with == [1012]
        assert first.connected is True
        assert second.connected is True
    finally:
        first.stop()
        second.stop()
        await asyncio.gather(first_task, second_task)
