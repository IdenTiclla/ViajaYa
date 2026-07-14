"""Carreras focales de presencia y cierre automático de la negociación."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.api.v1 import events, presence
from app.application.dto import CancelRideResult
from app.application.use_cases.cancel_ride_on_disconnect import CancelRideOnDisconnect
from app.domain.entities import (
    Location,
    Offer,
    OfferStatus,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
)
from app.domain.repositories import OpenRideDetail, RiderSummary
from tests.fakes import InMemoryOfferRepository, InMemoryRideRequestRepository


def _ride() -> RideRequest:
    return RideRequest(
        rider_id=uuid.uuid4(),
        origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
        destination=Location(-16.49, -68.14, "Trabajo", "Av. 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
    )


@pytest.fixture(autouse=True)
async def _reset_presence_state():
    async def clear() -> None:
        tasks = set(presence._CANCEL_TASKS)
        tasks.update(presence._pending_cancels.values())
        tasks.update(presence._critical_cancels.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        presence._pending_cancels.clear()
        presence._critical_cancels.clear()
        presence._CANCEL_TASKS.clear()
        presence._last_seen.clear()

    await clear()
    yield
    await clear()


async def test_auto_cancel_updates_ride_and_pending_offers_as_one_fake_operation():
    ride = _ride()
    rides = InMemoryRideRequestRepository()
    await rides.add(ride)
    offers = InMemoryOfferRepository(rides=rides)
    live = Offer(
        ride_id=ride.id,
        driver_id=uuid.uuid4(),
        price=ride.fare,
        created_at=datetime.now(UTC),
    )
    expired = Offer(
        ride_id=ride.id,
        driver_id=uuid.uuid4(),
        price=ride.fare,
        created_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    accepted = Offer(
        ride_id=ride.id,
        driver_id=uuid.uuid4(),
        price=ride.fare,
        status=OfferStatus.ACCEPTED,
        created_at=datetime.now(UTC),
    )
    offers.offers.extend([live, expired, accepted])

    result = await CancelRideOnDisconnect(offers).execute(ride.id)

    assert result is not None
    assert result.ride.status is RideStatus.CANCELLED
    assert result.ride.cancelled_at is not None
    assert [offer.id for offer in result.cancelled_offers] == [live.id]
    assert live.status is OfferStatus.REJECTED
    assert expired.status is OfferStatus.REJECTED
    assert accepted.status is OfferStatus.ACCEPTED


async def test_auto_cancel_revalidates_paused_state_without_touching_offers():
    ride = replace(_ride(), paused=True)
    rides = InMemoryRideRequestRepository()
    await rides.add(ride)
    offers = InMemoryOfferRepository(rides=rides)
    pending = Offer(
        ride_id=ride.id,
        driver_id=uuid.uuid4(),
        price=ride.fare,
        created_at=datetime.now(UTC),
    )
    offers.offers.append(pending)

    result = await CancelRideOnDisconnect(offers).execute(ride.id)

    assert result is None
    assert ride.status is RideStatus.SEARCHING
    assert pending.status is OfferStatus.PENDING


async def test_reconnect_waits_for_critical_events_and_does_not_republish_cancelled_ride(
    monkeypatch: pytest.MonkeyPatch,
):
    ride = _ride()
    rider = User(id=ride.rider_id, full_name="Pasajero", email="rider@example.com")
    rejected_offer = Offer(
        ride_id=ride.id,
        driver_id=uuid.uuid4(),
        price=ride.fare,
        created_at=datetime.now(UTC),
    )
    state = {"ride": ride}
    events_started = asyncio.Event()
    release_events = asyncio.Event()
    calls: list[str] = []
    event_interrupted = False

    class FakeCancelRideOnDisconnect:
        def __init__(self, _offers: object) -> None:
            pass

        async def execute(self, _ride_id: uuid.UUID) -> CancelRideResult:
            state["ride"] = replace(
                ride,
                status=RideStatus.CANCELLED,
                cancelled_at=datetime.now(UTC),
            )
            return CancelRideResult(
                ride=state["ride"],
                cancelled_offers=[rejected_offer],
            )

    class FakeUsers:
        def __init__(self, _session: object) -> None:
            pass

        async def get_by_id(self, _user_id: uuid.UUID) -> User:
            return rider

    class FakeRides:
        def __init__(self, _session: object) -> None:
            pass

        async def open_ride_with_rider(self, _ride_id: uuid.UUID) -> OpenRideDetail:
            return OpenRideDetail(
                ride=state["ride"],
                rider=RiderSummary(
                    full_name=rider.full_name,
                    rating=None,
                    trips_completed=0,
                ),
            )

    @asynccontextmanager
    async def session_factory():
        yield object()

    async def publish_ride_status(_detail: object) -> None:
        nonlocal event_interrupted
        calls.append("ride_status")
        events_started.set()
        try:
            await release_events.wait()
        except asyncio.CancelledError:
            event_interrupted = True
            raise

    async def publish_ride_closed(*_args: object) -> None:
        calls.append("ride_closed")

    async def publish_offer_rejected(*_args: object, **_kwargs: object) -> None:
        calls.append("offer_rejected")

    async def publish_ride_created(_detail: object) -> None:
        calls.append("ride_created")

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.0)
    monkeypatch.setattr(presence.hub, "has_subscribers", lambda _topic: False)
    monkeypatch.setattr(presence, "CancelRideOnDisconnect", FakeCancelRideOnDisconnect)
    monkeypatch.setattr(presence, "SqlAlchemyUserRepository", FakeUsers)
    monkeypatch.setattr(presence, "SqlAlchemyRideRequestRepository", FakeRides)
    monkeypatch.setattr(events, "publish_ride_status", publish_ride_status)
    monkeypatch.setattr(events, "publish_ride_closed", publish_ride_closed)
    monkeypatch.setattr(events, "publish_offer_rejected", publish_offer_rejected)
    monkeypatch.setattr(events, "publish_ride_created", publish_ride_created)

    presence.on_passenger_disconnect(ride.id, session_factory)
    await events_started.wait()
    critical = presence._critical_cancels[ride.id]

    reconnect = asyncio.create_task(
        presence.on_passenger_connect(ride.id, session_factory)
    )
    await asyncio.sleep(0)

    assert not reconnect.done()
    assert not critical.cancelled()
    release_events.set()
    await reconnect
    await critical

    assert event_interrupted is False
    assert calls == ["ride_status", "ride_closed", "offer_rejected"]
    assert ride.id not in presence._critical_cancels
