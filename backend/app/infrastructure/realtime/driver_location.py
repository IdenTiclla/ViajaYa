"""Coalesced local delivery and atomic Redis latest-position fanout."""

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from uuid import UUID

from redis.asyncio import Redis

from app.application.driver_location_channel import DriverLocationChannel
from app.domain.driver_location import LOCATION_RETENTION_SECONDS, DriverLocation


class MemoryDriverLocationChannel(DriverLocationChannel):
    def __init__(self):
        self._positions: dict[UUID, DriverLocation] = {}
        self._listeners: dict[UUID, set[asyncio.Queue[DriverLocation]]] = {}

    async def aclose(self) -> None:
        self._positions.clear()
        self._listeners.clear()

    async def latest(self, ride_id: UUID) -> DriverLocation | None:
        location = self._positions.get(ride_id)
        if (
            location
            and (datetime.now(UTC) - location.received_at).total_seconds()
            < LOCATION_RETENTION_SECONDS
        ):
            return location
        self._positions.pop(ride_id, None)
        return None

    async def publish(self, location: DriverLocation) -> bool:
        for ride_id in list(self._positions):
            await self.latest(ride_id)
        previous = self._positions.get(location.ride_id)
        if previous and previous.captured_at >= location.captured_at:
            return False
        self._positions[location.ride_id] = location
        for queue in self._listeners.get(location.ride_id, ()):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(location)
        return True

    @asynccontextmanager
    async def subscribe(self, ride_id: UUID) -> AsyncIterator[AsyncIterator[DriverLocation]]:
        queue: asyncio.Queue[DriverLocation] = asyncio.Queue(maxsize=1)
        self._listeners.setdefault(ride_id, set()).add(queue)

        async def updates():
            while True:
                yield await queue.get()

        try:
            yield updates()
        finally:
            self._listeners[ride_id].discard(queue)
            if not self._listeners[ride_id]:
                del self._listeners[ride_id]


_STORE_AND_PUBLISH = """
local old = redis.call('GET', KEYS[1])
if old and tonumber(cjson.decode(old).captured_epoch) >= tonumber(ARGV[1]) then
    return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('PUBLISH', KEYS[2], ARGV[2])
return 1
"""


def _encode(location: DriverLocation) -> str:
    values = asdict(location)
    for key in ("ride_id", "driver_id", "captured_at", "received_at"):
        values[key] = str(values[key])
    values["captured_epoch"] = location.captured_at.timestamp()
    return json.dumps(values)


def _decode(value: str) -> DriverLocation:
    data = json.loads(value)
    data.pop("captured_epoch")
    for key in ("ride_id", "driver_id"):
        data[key] = UUID(data[key])
    for key in ("captured_at", "received_at"):
        data[key] = datetime.fromisoformat(data[key])
    return DriverLocation(**data)


class RedisDriverLocationChannel(DriverLocationChannel):
    def __init__(self, url: str, environment: str):
        self._redis = Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=5,
            health_check_interval=15,
        )
        self._prefix = f"viajaya:{environment}:driver-location:"

    async def latest(self, ride_id: UUID) -> DriverLocation | None:
        value = await self._redis.get(self._prefix + str(ride_id))
        return _decode(value) if value else None

    async def publish(self, location: DriverLocation) -> bool:
        key = self._prefix + str(location.ride_id)
        return bool(
            await self._redis.eval(
                _STORE_AND_PUBLISH,
                2,
                key,
                key + ":live",
                location.captured_at.timestamp(),
                _encode(location),
                LOCATION_RETENTION_SECONDS,
            )
        )

    @asynccontextmanager
    async def subscribe(self, ride_id: UUID) -> AsyncIterator[AsyncIterator[DriverLocation]]:
        async with self._redis.pubsub() as subscription:
            await subscription.subscribe(self._prefix + str(ride_id) + ":live")
            # Consume subscription acknowledgement before reading the snapshot.
            async with asyncio.timeout(5):
                while True:
                    message = await subscription.get_message(timeout=5)
                    if message and message["type"] == "subscribe":
                        break

            async def updates():
                async for message in subscription.listen():
                    if message["type"] == "message":
                        yield _decode(message["data"])

            yield updates()

    async def aclose(self) -> None:
        await self._redis.aclose()
