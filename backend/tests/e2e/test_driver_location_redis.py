"""Optional real Redis test, isolated by a unique key prefix (never flushes Redis)."""

import asyncio
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.domain.driver_location import DriverLocation
from app.infrastructure.realtime.driver_location import RedisDriverLocationChannel


@pytest.mark.skipif(not os.getenv("TEST_REDIS_URL"), reason="Requires TEST_REDIS_URL")
async def test_location_cross_worker_reconnect_ordering_and_expiry():
    environment = f"test-gps-{uuid4().hex}"
    sender = RedisDriverLocationChannel(os.environ["TEST_REDIS_URL"], environment)
    receiver = RedisDriverLocationChannel(os.environ["TEST_REDIS_URL"], environment)
    now = datetime.now(UTC)
    point = DriverLocation(uuid4(), uuid4(), -16.5, -68.13, 5, 90, now, now)
    key = sender._prefix + str(point.ride_id)
    try:
        async with receiver.subscribe(point.ride_id) as messages:
            assert await sender.publish(point)
            assert await asyncio.wait_for(anext(messages), 3) == point
            assert not await sender.publish(replace(point, captured_at=now - timedelta(seconds=1)))
            assert await receiver.latest(point.ride_id) == point
            newer = replace(point, latitude=-16.51, captured_at=now + timedelta(seconds=1))
            assert await sender.publish(newer)
            assert await asyncio.wait_for(anext(messages), 3) == newer
        async with receiver.subscribe(point.ride_id):
            assert await receiver.latest(point.ride_id) == newer
        assert await receiver.latest(uuid4()) is None
        assert 0 < await sender._redis.ttl(key) <= 120
        await sender._redis.expire(key, 0)
        assert await receiver.latest(point.ride_id) is None
    finally:
        await sender._redis.delete(key)
        await sender.aclose()
        await receiver.aclose()
