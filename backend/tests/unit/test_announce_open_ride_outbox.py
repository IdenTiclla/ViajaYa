"""Atomicity and realtime contract of the presence announcement."""

from __future__ import annotations

import uuid
from dataclasses import replace
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.api.deps import build_announce_open_ride
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxAnnounceOpenRideEventRecorder
from app.application.use_cases.announce_open_ride import AnnounceOpenRide
from app.domain.entities import Location, RideRequest, RideStatus, ServiceType, User
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime.hub import pool_topic
from tests.fakes import InMemoryRideRequestRepository, InMemoryUnitOfWork


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-announce-{uuid.uuid4()}@viajaya.com",
    )


def _ride(rider_id: uuid.UUID, *, paused: bool = False) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
        destination=Location(-16.49, -68.14, "Trabajo", "Av. 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
        paused=paused,
    )


def _outbox_settings(*, enabled: bool = True) -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow" if enabled else "off",
        realtime_outbox_recording_enabled=enabled,
    )


async def _sql_scenario(session, *, paused: bool = False):
    rider = await SqlAlchemyUserRepository(session).add(_rider())
    ride = await SqlAlchemyRideRequestRepository(session).add(
        _ride(rider.id, paused=paused)
    )
    return rider, ride


async def test_builder_and_direct_delivery_share_exact_announcement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rider = _rider()
    rides = InMemoryRideRequestRepository()
    ride = await rides.add(_ride(rider.id))
    detail = await rides.open_ride_with_rider(ride.id)
    assert detail is not None

    batch = events.build_announce_open_ride_events(detail)
    assert len(batch) == 1
    assert batch[0].event_type == "ride_created"
    assert batch[0].topic == pool_topic(ServiceType.TAXI.value)
    assert (batch[0].aggregate_type, batch[0].aggregate_id) == (
        "ride",
        ride.id,
    )
    assert batch[0].payload["data"]["pool_version"] == 1

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_ride_created(detail)

    assert delivered == [(batch[0].topic, batch[0].payload)]


async def test_use_case_records_before_commit() -> None:
    rides = InMemoryRideRequestRepository()
    ride = await rides.add(_ride(uuid.uuid4()))
    operations: list[str] = []
    unit_of_work = InMemoryUnitOfWork(operations=operations)

    class Recorder:
        async def record(self, detail) -> None:
            assert detail.ride.id == ride.id
            operations.append("record")

    detail = await AnnounceOpenRide(rides, unit_of_work, Recorder()).execute(ride.id)

    assert detail is not None
    assert operations == ["record", "commit"]
    assert unit_of_work.rollbacks == 0


@pytest.mark.parametrize(
    ("status", "paused"),
    [
        (RideStatus.SEARCHING, True),
        (RideStatus.ACCEPTED, False),
        (RideStatus.ARRIVING, False),
        (RideStatus.IN_PROGRESS, False),
        (RideStatus.COMPLETED, False),
        (RideStatus.CANCELLED, False),
    ],
)
async def test_ineligible_ride_does_not_record(status: RideStatus, paused: bool) -> None:
    rides = InMemoryRideRequestRepository()
    ride = await rides.add(
        replace(_ride(uuid.uuid4(), paused=paused), status=status)
    )
    unit_of_work = InMemoryUnitOfWork()

    class UnexpectedRecorder:
        async def record(self, _detail) -> None:
            pytest.fail("Must not record an announcement")

    result = await AnnounceOpenRide(
        rides,
        unit_of_work,
        UnexpectedRecorder(),
    ).execute(ride.id)

    assert result is None
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_missing_ride_rolls_back_without_recording() -> None:
    rides = InMemoryRideRequestRepository()
    unit_of_work = InMemoryUnitOfWork()

    class UnexpectedRecorder:
        async def record(self, _detail) -> None:
            pytest.fail("Must not record an announcement")

    result = await AnnounceOpenRide(
        rides,
        unit_of_work,
        UnexpectedRecorder(),
    ).execute(uuid.uuid4())

    assert result is None
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_announcement_and_versions_persist_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        _, ride = await _sql_scenario(session)

        detail = await build_announce_open_ride(
            session,
            _outbox_settings(),
        ).execute(ride.id)

        assert detail is not None
        rows = (await session.execute(select(RealtimeOutboxModel))).scalars().all()
        assert len(rows) == 1
        expected = events.build_announce_open_ride_events(detail)[0]
        assert (rows[0].event_type, rows[0].topic, rows[0].payload) == (
            expected.event_type,
            expected.topic,
            expected.payload,
        )
        assert rows[0].aggregate_version == 1
        assert rows[0].stream_version == 1
        assert await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 1
        assert await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 1


async def test_disabled_recording_keeps_legacy_delivery_without_backlog(
    session_factory,
) -> None:
    async with session_factory() as session:
        _, ride = await _sql_scenario(session)

        detail = await build_announce_open_ride(
            session,
            _outbox_settings(enabled=False),
        ).execute(ride.id)

        assert detail is not None
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0


async def test_failure_after_outbox_flush_rolls_back_events_and_counters(
    session_factory,
) -> None:
    async with session_factory() as session:
        _, ride = await _sql_scenario(session)
        recorder = OutboxAnnounceOpenRideEventRecorder(
            SqlAlchemyRealtimeOutbox(session)
        )

        class RecordThenFail:
            async def record(self, detail) -> None:
                await recorder.record(detail)
                raise RuntimeError("failure after inserting the outbox")

        use_case = AnnounceOpenRide(
            SqlAlchemyRideRequestRepository(session),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="after inserting"):
            await use_case.execute(ride.id)

        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
        assert await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 0
        assert await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 0


async def test_sql_lock_revalidates_paused_state_without_an_event(
    session_factory,
) -> None:
    async with session_factory() as session:
        _, ride = await _sql_scenario(session, paused=True)

        result = await build_announce_open_ride(
            session,
            _outbox_settings(),
        ).execute(ride.id)

        assert result is None
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
