"""Latest-value delivery stays private, bounded and ordered."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.domain.driver_location import DriverLocation
from app.infrastructure.realtime.driver_location import MemoryDriverLocationChannel


def _location():
    now = datetime.now(UTC)
    return DriverLocation(uuid4(), uuid4(), -16.5, -68.13, 5, None, now, now)


async def test_channel_coalesces_slow_consumers_and_isolates_trips():
    channel = MemoryDriverLocationChannel()
    first = _location()
    async with channel.subscribe(first.ride_id) as updates:
        assert await channel.publish(first)
        newest = replace(
            first, latitude=-16.6, captured_at=first.captured_at + timedelta(seconds=1)
        )
        assert await channel.publish(newest)
        assert not await channel.publish(first)
        assert await channel.publish(_location())
        assert await anext(updates) == newest
        assert await channel.latest(first.ride_id) == newest
    assert not channel._listeners
    await channel.aclose()
    assert await channel.latest(first.ride_id) is None


async def test_expired_sample_is_not_exposed():
    channel = MemoryDriverLocationChannel()
    old = replace(_location(), received_at=datetime.now(UTC) - timedelta(seconds=121))
    await channel.publish(old)
    assert await channel.latest(old.ride_id) is None


def test_driver_location_contract_snapshot_is_current():
    from scripts.export_driver_location_contract import SNAPSHOT, serialize_contract

    assert SNAPSHOT.read_text() == serialize_contract()
