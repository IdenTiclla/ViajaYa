"""Transactional boundary and realtime contract of cancellations."""

from __future__ import annotations

import uuid
from dataclasses import replace
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import build_cancel_ride_on_disconnect, get_cancel_ride
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxCancelRideEventRecorder
from app.application.dto import CancelRideResult, CreateOfferInput, RideDetail
from app.application.use_cases.cancel_ride import CancelRide
from app.domain.entities import (
    Location,
    Offer,
    OfferStatus,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
    RideRequestModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime.hub import driver_topic, pool_topic, ride_topic
from tests.fakes import (
    InMemoryCancelRideEventRecorder,
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUnitOfWork,
    InMemoryUserRepository,
    accept_offer_use_case,
    cancel_ride_use_case,
    create_offer_use_case,
)

_ORIGIN = Location(-16.5, -68.13, "Casa", "Calle 1")
_DESTINATION = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-cancel-{uuid.uuid4()}@viajaya.com",
    )


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-cancel-{uuid.uuid4()}@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        is_online=True,
    )


def _ride(rider_id: uuid.UUID) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=_ORIGIN,
        destination=_DESTINATION,
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
    )


async def _memory_scenario():
    users = InMemoryUserRepository()
    rider = await users.add(_rider())
    drivers = [await users.add(_driver()), await users.add(_driver())]
    rides = InMemoryRideRequestRepository()
    ride = await rides.add(_ride(rider.id))
    offers = InMemoryOfferRepository(rides=rides, users=users)
    created = [
        await create_offer_use_case(rides, offers).execute(
            driver,
            ride.id,
            CreateOfferInput(accept_at_fare=True),
        )
        for driver in drivers
    ]
    return users, rides, offers, rider, drivers, ride, created


async def test_cancel_builder_and_direct_delivery_share_exact_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    users, rides, offers, rider, drivers, ride, created = await _memory_scenario()
    result = await cancel_ride_use_case(rides, offers, users).execute(rider, ride.id)

    batch = events.build_cancel_ride_events(result)
    assert [event.event_type for event in batch] == [
        "ride_status",
        "ride_closed",
        "offer_rejected",
        "offer_rejected",
    ]
    assert [event.topic for event in batch[:2]] == [
        ride_topic(ride.id),
        pool_topic(ServiceType.TAXI.value),
    ]
    assert batch[1].payload["data"] == {
        "ride_id": str(ride.id),
        "pool_version": ride.pool_version,
        "reason": "terminal",
    }
    expected_offers = sorted(
        [item.detail.offer for item in created],
        key=lambda item: item.id.hex,
    )
    assert [event.topic for event in batch[2:]] == [
        driver_topic(offer.driver_id) for offer in expected_offers
    ]
    assert [event.payload["data"]["offer_id"] for event in batch[2:]] == [
        str(offer.id) for offer in expected_offers
    ]
    assert all(
        (event.aggregate_type, event.aggregate_id) == ("ride", ride.id)
        for event in batch
    )
    assert all(
        event.payload["data"]["reason"] == "ride_cancelled"
        for event in batch[2:]
    )
    assert {offer.driver_id for offer in expected_offers} == {
        driver.id for driver in drivers
    }

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_ride_cancelled(result)

    assert delivered == [(event.topic, event.payload) for event in batch]


async def test_cancel_paused_ride_emits_terminal_close_in_same_pool_generation() -> None:
    users, rides, offers, rider, _, ride, _ = await _memory_scenario()
    ride.paused = True
    await rides.update(ride)

    result = await cancel_ride_use_case(rides, offers, users).execute(rider, ride.id)
    closed = events.build_cancel_ride_events(result)[1]

    assert closed.payload["data"] == {
        "ride_id": str(ride.id),
        "pool_version": ride.pool_version,
        "reason": "terminal",
    }


def test_assigned_cancel_builder_notifies_driver_before_closing_pool() -> None:
    rider = _rider()
    driver = _driver()
    accepted_offer = Offer(
        ride_id=uuid.uuid4(),
        driver_id=driver.id,
        price=Decimal("23.00"),
        status=OfferStatus.ACCEPTED,
    )
    ride = replace(
        _ride(rider.id),
        id=accepted_offer.ride_id,
        status=RideStatus.CANCELLED,
        driver_id=driver.id,
        accepted_offer_id=accepted_offer.id,
    )
    result = CancelRideResult(
        detail=RideDetail(
            ride=ride,
            rider=rider,
            driver=driver,
            accepted_offer=accepted_offer,
        ),
        cancelled_offers=[],
    )

    batch = events.build_cancel_ride_events(result)

    assert [event.event_type for event in batch] == [
        "ride_status",
        "ride_status",
        "ride_closed",
    ]
    assert [event.topic for event in batch] == [
        ride_topic(ride.id),
        driver_topic(driver.id),
        pool_topic(ride.service_type.value),
    ]
    assert batch[0].payload == batch[1].payload
    assert batch[2].payload["data"] == {
        "ride_id": str(ride.id),
        "pool_version": ride.pool_version,
        "reason": "terminal",
    }


async def test_assigned_driver_can_cancel_with_enriched_detail() -> None:
    users = InMemoryUserRepository()
    rider = await users.add(_rider())
    driver = await users.add(_driver())
    rides = InMemoryRideRequestRepository()
    ride = await rides.add(_ride(rider.id))
    offers = InMemoryOfferRepository(rides=rides, users=users)
    created = await create_offer_use_case(rides, offers).execute(
        driver,
        ride.id,
        CreateOfferInput(accept_at_fare=True),
    )
    await accept_offer_use_case(rides, offers).execute(
        rider,
        created.detail.offer.id,
    )

    result = await cancel_ride_use_case(rides, offers, users).execute(
        driver,
        ride.id,
    )

    assert result.ride.status is RideStatus.CANCELLED
    assert result.detail.rider == rider
    assert result.detail.driver == driver
    assert result.detail.accepted_offer is not None
    assert result.detail.accepted_offer.id == created.detail.offer.id
    assert result.cancelled_offers == []
    assert [event.topic for event in events.build_cancel_ride_events(result)] == [
        ride_topic(ride.id),
        driver_topic(driver.id),
        pool_topic(ride.service_type.value),
    ]


async def test_cancel_records_before_commit_and_rolls_back_on_recorder_failure() -> None:
    users, rides, offers, rider, _, ride, created = await _memory_scenario()
    operations: list[str] = []
    unit_of_work = InMemoryUnitOfWork(
        offers,
        rides=rides,
        operations=operations,
    )
    recorder = InMemoryCancelRideEventRecorder(
        operations=operations,
        error=RuntimeError("the outbox failed"),
    )

    with pytest.raises(RuntimeError, match="the outbox failed"):
        await cancel_ride_use_case(
            rides,
            offers,
            users,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(rider, ride.id)

    assert operations == ["record", "rollback"]
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1
    assert (await rides.get_by_id(ride.id)).status is RideStatus.SEARCHING
    for item in created:
        stored = await offers.get_by_id(item.detail.offer.id)
        assert stored is not None
        assert stored.status is OfferStatus.PENDING


async def _sql_scenario(session: AsyncSession):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(_rider())
    driver = await users.add(_driver())
    rides = SqlAlchemyRideRequestRepository(session)
    ride = await rides.add(_ride(rider.id))
    offer = await SqlAlchemyOfferRepository(session).add(
        Offer(
            ride_id=ride.id,
            driver_id=driver.id,
            price=ride.fare,
        )
    )
    return users, rides, rider, driver, ride, offer


def _outbox_settings() -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_recording_enabled=True,
    )


async def _assert_cancel_persisted(
    session: AsyncSession,
    result: CancelRideResult,
    offer_id: uuid.UUID,
) -> None:
    ride_row = await session.get(RideRequestModel, result.ride.id)
    offer_row = await session.get(OfferModel, offer_id)
    outbox_rows = (
        await session.execute(
            select(RealtimeOutboxModel).order_by(RealtimeOutboxModel.sequence)
        )
    ).scalars().all()
    aggregate_count = await session.scalar(
        select(func.count(RealtimeAggregateVersionModel.aggregate_id))
    )
    stream_count = await session.scalar(
        select(func.count(RealtimeStreamVersionModel.topic))
    )

    assert ride_row is not None
    assert ride_row.status is RideStatus.CANCELLED
    assert offer_row is not None
    assert offer_row.status is OfferStatus.REJECTED
    expected = events.build_cancel_ride_events(result)
    assert [row.event_type for row in outbox_rows] == [
        event.event_type for event in expected
    ]
    assert [row.topic for row in outbox_rows] == [event.topic for event in expected]
    assert [row.payload for row in outbox_rows] == [event.payload for event in expected]
    assert [row.aggregate_version for row in outbox_rows] == [1, 2, 3]
    assert [row.stream_version for row in outbox_rows] == [1, 1, 1]
    assert aggregate_count == 1
    assert stream_count == 3


async def test_manual_cancel_persists_business_and_outbox_in_one_commit(
    session_factory,
) -> None:
    async with session_factory() as session:
        users, rides, rider, _, ride, offer = await _sql_scenario(session)

        result = await get_cancel_ride(
            rides,
            users,
            session,
            _outbox_settings(),
        ).execute(rider, ride.id)

        await _assert_cancel_persisted(session, result, offer.id)


async def test_absence_cancel_persists_business_and_outbox_in_one_commit(
    session_factory,
) -> None:
    async with session_factory() as session:
        _, _, _, _, ride, offer = await _sql_scenario(session)

        result = await build_cancel_ride_on_disconnect(
            session,
            _outbox_settings(),
        ).execute(ride.id)

        assert result is not None
        await _assert_cancel_persisted(session, result, offer.id)


async def test_failure_after_cancel_outbox_flush_rolls_back_everything(
    session_factory,
) -> None:
    async with session_factory() as session:
        users, rides, rider, _, ride, offer = await _sql_scenario(session)
        recorder = OutboxCancelRideEventRecorder(SqlAlchemyRealtimeOutbox(session))

        class RecordThenFail:
            async def record(self, result: CancelRideResult) -> None:
                await recorder.record(result)
                raise RuntimeError("failure after inserting the outbox")

        use_case = CancelRide(
            rides,
            SqlAlchemyOfferRepository(session, commit_cancel=False),
            users,
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="after inserting"):
            await use_case.execute(rider, ride.id)

        ride_row = await session.get(RideRequestModel, ride.id)
        offer_row = await session.get(OfferModel, offer.id)
        event_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))
        aggregate_count = await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        )
        stream_count = await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        )

        assert ride_row is not None
        assert ride_row.status is RideStatus.SEARCHING
        assert offer_row is not None
        assert offer_row.status is OfferStatus.PENDING
        assert event_count == 0
        assert aggregate_count == 0
        assert stream_count == 0
