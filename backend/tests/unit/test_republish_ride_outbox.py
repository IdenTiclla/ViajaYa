"""Atomicity and realtime contract of pool creation and renewal."""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_create_ride_request,
    get_edit_ride,
    get_update_ride_fare,
)
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxRepublishRideEventRecorder
from app.application.dto import (
    CreateRideRequestInput,
    LocationInput,
    RideRepublishedResult,
)
from app.application.use_cases.reconcile_missing_scheduled_actions import (
    ReconcileMissingScheduledActions,
)
from app.application.use_cases.update_ride_fare import UpdateRideFare
from app.domain.entities import (
    Location,
    PaymentMethod,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
    RideRequestModel,
    ScheduledActionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.scheduled_actions_reconciliation import (
    SqlAlchemyMissingPassengerPresenceActionsReconciler,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime.hub import pool_topic, ride_topic
from tests.fakes import (
    InMemoryRepublishRideEventRecorder,
    InMemoryRideRequestRepository,
    InMemoryUnitOfWork,
    InMemoryUserRepository,
    create_ride_request_use_case,
    edit_ride_use_case,
    update_ride_fare_use_case,
)

_ORIGIN = Location(-16.5, -68.13, "Casa", "Calle 1")
_DESTINATION = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-republish-{uuid.uuid4()}@viajaya.com",
    )


def _ride(rider_id: uuid.UUID, *, paused: bool = False) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=_ORIGIN,
        destination=_DESTINATION,
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
        paused=paused,
    )


def _input(
    *,
    fare: Decimal = Decimal("35.00"),
    service_type: ServiceType = ServiceType.TAXI,
) -> CreateRideRequestInput:
    return CreateRideRequestInput(
        origin=LocationInput(-16.5, -68.13, "Casa", "Calle 1"),
        destination=LocationInput(-16.48, -68.15, "Mercado", "Av. 3"),
        service_type=service_type,
        fare=fare,
        payment_method=PaymentMethod.QR,
    )


async def _memory_ride(*, paused: bool = False):
    users = InMemoryUserRepository()
    rider = await users.add(_rider())
    rides = InMemoryRideRequestRepository(users)
    ride = await rides.add(_ride(rider.id, paused=paused))
    return rides, rider, ride


async def test_republish_builder_and_direct_delivery_share_exact_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rides, rider, ride = await _memory_ride()
    result = await update_ride_fare_use_case(rides).execute(
        rider,
        ride.id,
        Decimal("30.00"),
    )

    batch = events.build_republish_ride_events(result)
    assert [event.event_type for event in batch] == [
        "ride_status",
        "ride_created",
    ]
    assert [event.topic for event in batch] == [
        ride_topic(ride.id),
        pool_topic(ServiceType.TAXI.value),
    ]
    assert all(
        (event.aggregate_type, event.aggregate_id) == ("ride", ride.id)
        for event in batch
    )
    assert batch[0].payload["data"]["fare"] == "30.00"
    assert batch[1].payload["data"]["fare"] == "30.00"
    assert batch[1].payload["data"]["pool_version"] == 2

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_ride_republished(result)

    assert delivered == [(event.topic, event.payload) for event in batch]


async def test_edit_reopens_in_new_pool_with_canonical_order() -> None:
    rides, rider, ride = await _memory_ride(paused=True)

    result = await edit_ride_use_case(rides).execute(
        rider,
        ride.id,
        _input(service_type=ServiceType.DELIVERY),
    )
    batch = events.build_republish_ride_events(result)

    assert result.ride.paused is False
    assert result.ride.pool_version == 2
    assert [event.event_type for event in batch] == [
        "ride_status",
        "ride_created",
    ]
    assert [event.topic for event in batch] == [
        ride_topic(ride.id),
        pool_topic(ServiceType.DELIVERY.value),
    ]
    assert batch[1].payload["data"]["service_type"] == "delivery"
    assert batch[1].payload["data"]["rider"]["full_name"] == rider.full_name


async def test_republish_records_before_commit_and_rolls_back_on_failure() -> None:
    rides, rider, ride = await _memory_ride()
    operations: list[str] = []
    unit_of_work = InMemoryUnitOfWork(rides=rides, operations=operations)
    recorder = InMemoryRepublishRideEventRecorder(
        operations=operations,
        error=RuntimeError("falló la outbox"),
    )

    with pytest.raises(RuntimeError, match="falló la outbox"):
        await update_ride_fare_use_case(
            rides,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(rider, ride.id, Decimal("30.00"))

    stored = await rides.get_by_id(ride.id)
    assert stored is not None
    assert stored.fare == Decimal("25.00")
    assert stored.pool_version == 1
    assert operations == ["record", "rollback"]


async def test_create_ride_rolls_back_if_commit_fails() -> None:
    rides = InMemoryRideRequestRepository()
    unit_of_work = InMemoryUnitOfWork(
        rides=rides,
        commit_error=RuntimeError("falló el commit"),
    )

    with pytest.raises(RuntimeError, match="falló el commit"):
        await create_ride_request_use_case(
            rides,
            unit_of_work=unit_of_work,
        ).execute(_rider(), _input())

    assert rides.rides == []
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 1


async def _sql_scenario(session: AsyncSession, *, paused: bool = False):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(_rider())
    rides = SqlAlchemyRideRequestRepository(session)
    ride = await rides.add(_ride(rider.id, paused=paused))
    return rider, ride


def _outbox_settings() -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_recording_enabled=True,
    )


async def _assert_republish_persisted(
    session: AsyncSession,
    result: RideRepublishedResult,
) -> None:
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
    expected = events.build_republish_ride_events(result)

    assert [row.event_type for row in outbox_rows] == [
        event.event_type for event in expected
    ]
    assert [row.topic for row in outbox_rows] == [event.topic for event in expected]
    assert [row.payload for row in outbox_rows] == [event.payload for event in expected]
    assert [row.aggregate_version for row in outbox_rows] == [1, 2]
    assert [row.stream_version for row in outbox_rows] == [1, 1]
    assert aggregate_count == 1
    assert stream_count == 2


async def test_fare_persists_business_and_outbox_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        rider, ride = await _sql_scenario(session)

        result = await get_update_ride_fare(
            session,
            _outbox_settings(),
        ).execute(rider, ride.id, Decimal("30.00"))

        ride_row = await session.get(RideRequestModel, ride.id)
        assert ride_row is not None
        assert ride_row.fare == Decimal("30.00")
        assert ride_row.pool_version == 2
        await _assert_republish_persisted(session, result)


async def test_edit_persists_reopening_and_outbox_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        rider, ride = await _sql_scenario(session, paused=True)

        result = await get_edit_ride(
            session,
            _outbox_settings(),
        ).execute(
            rider,
            ride.id,
            _input(service_type=ServiceType.DELIVERY),
        )

        ride_row = await session.get(RideRequestModel, ride.id)
        assert ride_row is not None
        assert ride_row.paused is False
        assert ride_row.service_type is ServiceType.DELIVERY
        assert ride_row.pool_version == 2
        await _assert_republish_persisted(session, result)


async def test_failure_after_republish_outbox_flush_rolls_back_everything(
    session_factory,
) -> None:
    async with session_factory() as session:
        rider, ride = await _sql_scenario(session)
        recorder = OutboxRepublishRideEventRecorder(SqlAlchemyRealtimeOutbox(session))

        class RecordThenFail:
            async def record(self, result: RideRepublishedResult) -> None:
                await recorder.record(result)
                raise RuntimeError("fallo después de insertar la outbox")

        use_case = UpdateRideFare(
            SqlAlchemyRideRequestRepository(
                session,
                commit_update_if_state=False,
            ),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="después de insertar"):
            await use_case.execute(rider, ride.id, Decimal("30.00"))

        ride_row = await session.get(RideRequestModel, ride.id)
        event_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))
        aggregate_count = await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        )
        stream_count = await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        )

        assert ride_row is not None
        assert ride_row.fare == Decimal("25.00")
        assert ride_row.pool_version == 1
        assert event_count == 0
        assert aggregate_count == 0
        assert stream_count == 0


async def test_create_commits_without_announcing_before_presence(session_factory) -> None:
    async with session_factory() as session:
        rider = await SqlAlchemyUserRepository(session).add(_rider())

        ride = await get_create_ride_request(
            session,
            Settings(_env_file=None),
        ).execute(rider, _input())

        ride_row = await session.get(RideRequestModel, ride.id)
        event_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))
        assert ride_row is not None
        assert ride_row.status is RideStatus.SEARCHING
        assert event_count == 0


async def test_create_with_shared_presence_persists_initial_absence_action(
    session_factory,
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="live_redis",
        realtime_outbox_recording_enabled=True,
        scheduled_actions_mode="live",
        realtime_shared_presence_enabled=True,
        realtime_presence_grace_seconds=120,
    )
    async with session_factory() as session:
        rider = await SqlAlchemyUserRepository(session).add(_rider())

        ride = await get_create_ride_request(session, settings).execute(rider, _input())

        action = await session.scalar(
            select(ScheduledActionModel).where(
                ScheduledActionModel.dedupe_key
                == f"cancel_absent_ride:{ride.id}"
            )
        )
        assert action is not None
        assert ride.created_at is not None
        assert action.action_type == "cancel_absent_ride"
        assert action.generation == 1
        assert action.execute_at - ride.created_at == timedelta(seconds=120)


async def test_shared_presence_reconciles_searching_rides_from_previous_version(
    session_factory,
) -> None:
    async with session_factory() as session:
        rider = await SqlAlchemyUserRepository(session).add(_rider())
        ride = await get_create_ride_request(
            session,
            Settings(_env_file=None),
        ).execute(rider, _input())

        reconciler = ReconcileMissingScheduledActions(
            SqlAlchemyMissingPassengerPresenceActionsReconciler(
                session,
                grace_seconds=120,
            ),
            SqlAlchemyUnitOfWork(session),
        )
        assert await reconciler.execute(100) == 1
        assert await reconciler.execute(100) == 0

        action = await session.scalar(
            select(ScheduledActionModel).where(
                ScheduledActionModel.aggregate_id == ride.id,
                ScheduledActionModel.action_type == "cancel_absent_ride",
            )
        )
        assert action is not None
        assert action.payload == {"ride_id": str(ride.id)}
        assert action.execute_at > ride.created_at
