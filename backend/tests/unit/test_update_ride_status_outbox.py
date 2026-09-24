"""Atomicity and realtime contract of ride status changes."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.api.deps import get_accept_offer, get_update_ride_status
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxUpdateRideStatusEventRecorder
from app.api.v1.schemas.rides import RideResponse
from app.application.dto import RideDetail
from app.application.use_cases.update_ride_status import UpdateRideStatus
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
from app.domain.exceptions import InvalidRideTransitionError
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
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
from app.infrastructure.realtime.hub import driver_topic, ride_topic
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUnitOfWork,
    InMemoryUpdateRideStatusEventRecorder,
    InMemoryUserRepository,
    update_ride_status_use_case,
)


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-status-{uuid.uuid4()}@viajaya.com",
    )


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-status-{uuid.uuid4()}@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        is_online=True,
    )


def _ride(rider_id: uuid.UUID) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
        destination=Location(-16.49, -68.14, "Trabajo", "Av. 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
    )


def _offer(driver_id: uuid.UUID, ride_id: uuid.UUID) -> Offer:
    return Offer(
        ride_id=ride_id,
        driver_id=driver_id,
        price=Decimal("25.00"),
        eta_min=5,
    )


def _settings(*, enabled: bool = True) -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow" if enabled else "off",
        realtime_outbox_recording_enabled=enabled,
    )


async def _memory_scenario():
    rider, driver = _rider(), _driver()
    users = InMemoryUserRepository()
    await users.add(rider)
    await users.add(driver)
    rides = InMemoryRideRequestRepository(users=users)
    offers = InMemoryOfferRepository(rides=rides, users=users)
    ride = _ride(rider.id)
    ride.status = RideStatus.ACCEPTED
    ride.driver_id = driver.id
    offer = _offer(driver.id, ride.id)
    offer.status = OfferStatus.ACCEPTED
    ride.accepted_offer_id = offer.id
    await rides.add(ride)
    await offers.add(offer)
    return rides, offers, users, rider, driver, ride, offer


async def _sql_scenario(session):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(_rider())
    driver = await users.add(_driver())
    rides = SqlAlchemyRideRequestRepository(session)
    ride = await rides.add(_ride(rider.id))
    offer = await SqlAlchemyOfferRepository(session).add(
        _offer(driver.id, ride.id)
    )
    accepted = await get_accept_offer(
        rides,
        session,
        _settings(enabled=False),
    ).execute(rider, offer.id)
    return rider, driver, accepted.detail.ride, accepted.detail.accepted_offer


async def test_builder_and_direct_delivery_share_exact_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rides, offers, users, _, driver, ride, _ = await _memory_scenario()
    detail = await update_ride_status_use_case(rides, offers, users).execute(
        driver,
        ride.id,
        RideStatus.ARRIVING,
    )

    batch = events.build_update_ride_status_events(detail)
    assert len(batch) == 2
    assert [event.event_type for event in batch] == ["ride_status", "ride_status"]
    assert [event.topic for event in batch] == [
        ride_topic(ride.id),
        driver_topic(driver.id),
    ]
    assert [
        (event.aggregate_type, event.aggregate_id) for event in batch
    ] == [("ride", ride.id), ("ride", ride.id)]
    expected_payload = {
        "type": "ride_status",
        "data": RideResponse.from_detail(detail).model_dump(mode="json"),
    }
    assert [event.payload for event in batch] == [expected_payload, expected_payload]

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_ride_status(detail)

    assert delivered == [(event.topic, event.payload) for event in batch]


async def test_use_case_mutates_enriches_records_and_then_commits() -> None:
    rides, offers, users, rider, driver, ride, offer = await _memory_scenario()
    operations: list[str] = []
    recorder = InMemoryUpdateRideStatusEventRecorder(operations=operations)
    unit_of_work = InMemoryUnitOfWork(rides=rides, operations=operations)

    detail = await update_ride_status_use_case(
        rides,
        offers,
        users,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(driver, ride.id, RideStatus.ARRIVING)

    assert detail.ride.status is RideStatus.ARRIVING
    assert detail.rider == rider
    assert detail.driver == driver
    assert detail.accepted_offer == offer
    assert recorder.details == [detail]
    assert operations == ["record", "commit"]
    assert unit_of_work.rollbacks == 0


async def test_invalid_jump_rolls_back_without_recording() -> None:
    rides, offers, users, _, driver, ride, _ = await _memory_scenario()
    recorder = InMemoryUpdateRideStatusEventRecorder()
    unit_of_work = InMemoryUnitOfWork(rides=rides)

    with pytest.raises(InvalidRideTransitionError):
        await update_ride_status_use_case(
            rides,
            offers,
            users,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(driver, ride.id, RideStatus.COMPLETED)

    assert ride.status is RideStatus.ACCEPTED
    assert recorder.details == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_lost_compare_and_set_rolls_back_without_recording() -> None:
    rides, offers, users, _, driver, ride, _ = await _memory_scenario()
    recorder = InMemoryUpdateRideStatusEventRecorder()
    unit_of_work = InMemoryUnitOfWork(rides=rides)

    class RaceLosingRides(InMemoryRideRequestRepository):
        async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
            return await rides.get_by_id(ride_id)

        async def update_if_state(
            self,
            updated: RideRequest,
            expected_status: RideStatus,
            *,
            expected_paused: bool | None = None,
            expected_fare: Decimal | None = None,
        ) -> RideRequest | None:
            del updated, expected_status, expected_paused, expected_fare
            current = await rides.get_by_id(ride.id)
            assert current is not None
            current.status = RideStatus.ARRIVING
            return None

    with pytest.raises(InvalidRideTransitionError):
        await UpdateRideStatus(
            RaceLosingRides(),
            offers,
            users,
            unit_of_work,
            recorder,
        ).execute(driver, ride.id, RideStatus.ARRIVING)

    restored = await rides.get_by_id(ride.id)
    assert restored is not None and restored.status is RideStatus.ACCEPTED
    assert recorder.details == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_recorder_failure_rolls_back_memory_mutation() -> None:
    rides, offers, users, _, driver, ride, _ = await _memory_scenario()
    recorder = InMemoryUpdateRideStatusEventRecorder(
        error=RuntimeError("falló el recorder")
    )
    unit_of_work = InMemoryUnitOfWork(rides=rides)

    with pytest.raises(RuntimeError, match="falló el recorder"):
        await update_ride_status_use_case(
            rides,
            offers,
            users,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(driver, ride.id, RideStatus.ARRIVING)

    restored = await rides.get_by_id(ride.id)
    assert restored is not None and restored.status is RideStatus.ACCEPTED
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_full_progression_persists_exact_ordered_batches(session_factory) -> None:
    async with session_factory() as session:
        _, driver, ride, _ = await _sql_scenario(session)
        use_case = get_update_ride_status(session, _settings())

        arriving = await use_case.execute(driver, ride.id, RideStatus.ARRIVING)
        in_progress = await use_case.execute(
            driver,
            ride.id,
            RideStatus.IN_PROGRESS,
        )
        completed = await use_case.execute(driver, ride.id, RideStatus.COMPLETED)

    assert arriving.ride.status is RideStatus.ARRIVING
    assert in_progress.ride.status is RideStatus.IN_PROGRESS
    assert completed.ride.status is RideStatus.COMPLETED
    assert completed.ride.completed_at is not None

    async with session_factory() as verification_session:
        row = await verification_session.get(RideRequestModel, ride.id)
        outbox_rows = (
            await verification_session.execute(
                select(RealtimeOutboxModel).order_by(
                    RealtimeOutboxModel.aggregate_version
                )
            )
        ).scalars().all()

        assert row is not None and row.status is RideStatus.COMPLETED
        assert row.completed_at is not None
        assert [item.event_type for item in outbox_rows] == ["ride_status"] * 6
        assert [item.payload["data"]["status"] for item in outbox_rows] == [
            "arriving",
            "arriving",
            "in_progress",
            "in_progress",
            "completed",
            "completed",
        ]
        assert len({item.batch_id for item in outbox_rows}) == 3
        assert [item.sequence for item in outbox_rows] == [0, 1, 0, 1, 0, 1]
        assert [item.aggregate_version for item in outbox_rows] == list(range(1, 7))
        assert [item.stream_version for item in outbox_rows] == [1, 1, 2, 2, 3, 3]
        assert await verification_session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 1
        assert await verification_session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 2


async def test_disabled_recording_preserves_transition_without_backlog(
    session_factory,
) -> None:
    async with session_factory() as session:
        _, driver, ride, _ = await _sql_scenario(session)

        detail = await get_update_ride_status(
            session,
            _settings(enabled=False),
        ).execute(driver, ride.id, RideStatus.ARRIVING)

        assert detail.ride.status is RideStatus.ARRIVING
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0


async def test_failure_after_outbox_flush_rolls_back_ride_and_counters(
    session_factory,
) -> None:
    async with session_factory() as session:
        _, driver, ride, _ = await _sql_scenario(session)
        preparation = get_update_ride_status(session, _settings(enabled=False))
        await preparation.execute(driver, ride.id, RideStatus.ARRIVING)
        await preparation.execute(driver, ride.id, RideStatus.IN_PROGRESS)
        recorder = OutboxUpdateRideStatusEventRecorder(
            SqlAlchemyRealtimeOutbox(session)
        )

        class RecordThenFail:
            async def record(self, detail: RideDetail) -> None:
                await recorder.record(detail)
                raise RuntimeError("fallo después de insertar la outbox")

        use_case = UpdateRideStatus(
            SqlAlchemyRideRequestRepository(
                session,
                commit_update_if_state=False,
            ),
            SqlAlchemyOfferRepository(session),
            SqlAlchemyUserRepository(session),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="después de insertar"):
            await use_case.execute(driver, ride.id, RideStatus.COMPLETED)

        row = await session.get(RideRequestModel, ride.id, populate_existing=True)
        assert row is not None and row.status is RideStatus.IN_PROGRESS
        assert row.completed_at is None
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
        assert await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 0
        assert await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 0
