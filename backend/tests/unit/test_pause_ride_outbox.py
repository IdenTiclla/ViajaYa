"""Frontera transaccional y contrato realtime de PauseRideForEdit."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_pause_ride_for_edit
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxPauseRideEventRecorder
from app.application.dto import CreateOfferInput
from app.application.use_cases.pause_ride_for_edit import PauseRideForEdit
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
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
    create_offer_use_case,
    pause_ride_use_case,
)

_ORIGIN = Location(-16.5, -68.13, "Casa", "Calle 1")
_DESTINATION = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-pause-{uuid.uuid4()}@viajaya.com",
    )


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-pause-{uuid.uuid4()}@viajaya.com",
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
    driver = await users.add(_driver())
    rides = InMemoryRideRequestRepository()
    ride = await rides.add(_ride(rider.id))
    offers = InMemoryOfferRepository(rides=rides, users=users)
    offer = await create_offer_use_case(rides, offers).execute(
        driver,
        ride.id,
        CreateOfferInput(accept_at_fare=True),
    )
    return rides, offers, rider, driver, ride, offer


async def test_pause_builder_and_direct_delivery_share_exact_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rides, offers, rider, driver, ride, offer = await _memory_scenario()
    result = await pause_ride_use_case(rides, offers).execute(rider, ride.id)

    batch = events.build_pause_ride_events(result)
    assert [event.event_type for event in batch] == [
        "ride_closed",
        "offer_withdrawn",
        "ride_paused",
    ]
    assert [event.topic for event in batch] == [
        pool_topic(ServiceType.TAXI.value),
        ride_topic(ride.id),
        driver_topic(driver.id),
    ]
    assert [(event.aggregate_type, event.aggregate_id) for event in batch] == [
        ("ride", ride.id),
        ("ride", ride.id),
        ("ride", ride.id),
    ]
    assert batch[0].payload["data"] == {
        "ride_id": str(ride.id),
        "pool_version": ride.pool_version,
        "reason": "paused",
    }
    assert batch[1].payload["data"] == {
        "driver_id": str(driver.id),
        "offer_id": str(offer.detail.offer.id),
    }
    assert batch[2].payload["data"]["id"] == str(ride.id)
    assert batch[2].payload["data"]["offer_id"] == str(offer.detail.offer.id)

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_ride_paused(result)

    assert delivered == [(event.topic, event.payload) for event in batch]


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
    return rides, rider, driver, ride, offer


async def test_pause_persists_business_and_outbox_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        rides, rider, driver, ride, offer = await _sql_scenario(session)

        result = await get_pause_ride_for_edit(
            rides,
            session,
            Settings(
                realtime_outbox_dispatch_mode="shadow",
                realtime_outbox_recording_enabled=True,
            ),
        ).execute(rider, ride.id)

        ride_row = await session.get(RideRequestModel, ride.id)
        offer_row = await session.get(OfferModel, offer.id)
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
        assert ride_row.paused is True
        assert offer_row is not None
        assert offer_row.status is OfferStatus.REJECTED
        expected = events.build_pause_ride_events(result)
        assert [row.event_type for row in outbox_rows] == [
            event.event_type for event in expected
        ]
        assert [row.payload for row in outbox_rows] == [event.payload for event in expected]
        assert [row.aggregate_version for row in outbox_rows] == [1, 2, 3]
        assert [row.stream_version for row in outbox_rows] == [1, 1, 1]
        assert aggregate_count == 1
        assert stream_count == 3
        assert outbox_rows[2].topic == driver_topic(driver.id)


async def test_failure_after_pause_outbox_flush_rolls_back_everything(
    session_factory,
) -> None:
    async with session_factory() as session:
        rides, rider, _, ride, offer = await _sql_scenario(session)
        recorder = OutboxPauseRideEventRecorder(SqlAlchemyRealtimeOutbox(session))

        class RecordThenFail:
            async def record(self, result):
                await recorder.record(result)
                raise RuntimeError("failure after inserting the outbox")

        use_case = PauseRideForEdit(
            rides,
            SqlAlchemyOfferRepository(session, commit_pause=False),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),  # type: ignore[arg-type]
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
        assert ride_row.paused is False
        assert ride_row.status is RideStatus.SEARCHING
        assert offer_row is not None
        assert offer_row.status is OfferStatus.PENDING
        assert event_count == 0
        assert aggregate_count == 0
        assert stream_count == 0
