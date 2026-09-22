"""Frontera transaccional y contrato realtime de CreateOffer."""

from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_create_offer
from app.api.v1 import events
from app.api.v1.realtime_outbox import (
    DisabledCreateOfferEventRecorder,
    OutboxCreateOfferEventRecorder,
)
from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.realtime import (
    OfferCreatedMessage,
    OfferWithdrawnData,
    OfferWithdrawnMessage,
    dump_negotiation_message,
)
from app.application.dto import CreateOfferInput
from app.application.use_cases.create_offer import CreateOffer
from app.domain.entities import (
    Location,
    RideRequest,
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
    ScheduledActionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime.hub import ride_topic
from tests.fakes import (
    InMemoryCreateOfferEventRecorder,
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUnitOfWork,
    create_offer_use_case,
)

_ORIGIN = Location(-16.5, -68.13, "Casa", "Calle 1")
_DESTINATION = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-{uuid.uuid4().hex[:6]}@viajaya.com",
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


async def _scenario() -> tuple[
    InMemoryRideRequestRepository,
    InMemoryOfferRepository,
    User,
    RideRequest,
]:
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository()
    rider = User(full_name="Pasajero", email="rider@viajaya.com")
    driver = _driver()
    ride = await rides.add(_ride(rider.id))
    return rides, offers, driver, ride


async def test_create_offer_records_after_mutation_and_commits_last():
    operations: list[str] = []

    class RecordingOfferRepository(InMemoryOfferRepository):
        async def create_or_supersede_atomically(
            self, offer, *, expected_ride_fare, expected_pool_version=None,
        ):
            result = await super().create_or_supersede_atomically(
                offer,
                expected_ride_fare=expected_ride_fare,
                expected_pool_version=expected_pool_version,
            )
            operations.append("mutate")
            return result

    rides, _, driver, ride = await _scenario()
    offers = RecordingOfferRepository()
    unit_of_work = InMemoryUnitOfWork(offers, operations=operations)
    recorder = InMemoryCreateOfferEventRecorder(operations=operations)

    result = await create_offer_use_case(
        rides,
        offers,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(driver, ride.id, CreateOfferInput(accept_at_fare=True))

    assert operations == ["mutate", "record", "commit"]
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 0
    assert recorder.results == [result]


async def test_create_offer_rolls_back_mutation_when_recording_fails():
    operations: list[str] = []
    rides, offers, driver, ride = await _scenario()
    unit_of_work = InMemoryUnitOfWork(offers, operations=operations)
    recorder = InMemoryCreateOfferEventRecorder(
        operations=operations,
        error=RuntimeError("outbox unavailable"),
    )

    with pytest.raises(RuntimeError, match="outbox unavailable"):
        await create_offer_use_case(
            rides,
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(driver, ride.id, CreateOfferInput(accept_at_fare=True))

    assert offers.offers == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1
    assert operations == ["record", "rollback"]


async def test_create_offer_rolls_back_when_commit_fails():
    operations: list[str] = []
    rides, offers, driver, ride = await _scenario()
    unit_of_work = InMemoryUnitOfWork(
        offers,
        operations=operations,
        commit_error=RuntimeError("commit failed"),
    )
    recorder = InMemoryCreateOfferEventRecorder(operations=operations)

    with pytest.raises(RuntimeError, match="commit failed"):
        await create_offer_use_case(
            rides,
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(driver, ride.id, CreateOfferInput(accept_at_fare=True))

    assert offers.offers == []
    assert operations == ["record", "commit", "rollback"]
    assert unit_of_work.rollbacks == 1


async def test_superseded_batch_preserves_order_and_direct_payload(monkeypatch):
    rides, offers, driver, ride = await _scenario()
    await create_offer_use_case(rides, offers).execute(
        driver,
        ride.id,
        CreateOfferInput(accept_at_fare=False, price=Decimal("30.00")),
    )
    improved = await create_offer_use_case(rides, offers).execute(
        driver,
        ride.id,
        CreateOfferInput(accept_at_fare=False, price=Decimal("27.00")),
    )

    batch = events.build_create_offer_events(improved)
    old_offer_id = improved.superseded_offer_id
    assert old_offer_id is not None
    assert [event.event_type for event in batch] == [
        "offer_withdrawn",
        "offer_created",
    ]
    assert [event.topic for event in batch] == [ride_topic(ride.id)] * 2
    assert [(event.aggregate_type, event.aggregate_id) for event in batch] == [
        ("ride", ride.id),
        ("ride", ride.id),
    ]
    assert batch[0].payload == dump_negotiation_message(
        OfferWithdrawnMessage(
            data=OfferWithdrawnData(
                driver_id=driver.id,
                offer_id=old_offer_id,
                reason="superseded",
            )
        )
    )
    assert batch[1].payload == dump_negotiation_message(
        OfferCreatedMessage(data=OfferResponse.from_detail(improved.detail))
    )

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_offer_superseded(old_offer_id, improved.detail)

    assert delivered == [(event.topic, event.payload) for event in batch]


async def test_outbox_recorder_uses_the_same_canonical_batch():
    class CapturingOutbox:
        def __init__(self) -> None:
            self.events = []

        async def add_batch(self, pending):
            self.events = list(pending)
            return []

    rides, offers, driver, ride = await _scenario()
    result = await create_offer_use_case(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    outbox = CapturingOutbox()

    await OutboxCreateOfferEventRecorder(outbox).record(result)  # type: ignore[arg-type]

    assert outbox.events == events.build_create_offer_events(result)
    assert outbox.events[0].payload == dump_negotiation_message(
        OfferCreatedMessage(data=OfferResponse.from_detail(result.detail))
    )


def test_get_create_offer_enables_outbox_and_disables_repository_autocommit():
    session = Mock(spec=AsyncSession)
    rides = InMemoryRideRequestRepository()
    settings = Settings(
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_recording_enabled=True,
        scheduled_actions_mode="shadow",
    )

    use_case = get_create_offer(rides, session, settings)  # type: ignore[arg-type]

    assert isinstance(use_case._offers, SqlAlchemyOfferRepository)
    assert use_case._offers._commit_create_or_supersede is False
    assert use_case._unit_of_work._session is session
    assert use_case._event_recorder._outbox._session is session
    assert use_case._scheduled_actions._session is session


def test_get_create_offer_keeps_outbox_disabled_but_records_action_by_default():
    session = Mock(spec=AsyncSession)

    use_case = get_create_offer(
        InMemoryRideRequestRepository(),
        session,  # type: ignore[arg-type]
        Settings(),
    )

    assert isinstance(use_case._event_recorder, DisabledCreateOfferEventRecorder)
    assert isinstance(use_case._scheduled_actions, SqlAlchemyScheduledActionRepository)
    assert use_case._scheduled_actions._session is session


async def _persist_sqlalchemy_scenario(session: AsyncSession):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(
        User(full_name="Pasajero SQL", email=f"rider-{uuid.uuid4()}@viajaya.com")
    )
    driver = await users.add(_driver())
    rides = SqlAlchemyRideRequestRepository(session)
    ride = await rides.add(_ride(rider.id))
    return rides, driver, ride


async def test_create_offer_persists_business_and_outbox_in_one_commit(
    session_factory,
):
    async with session_factory() as session:
        rides, driver, ride = await _persist_sqlalchemy_scenario(session)

        result = await get_create_offer(
            rides,
            session,
            Settings(
                realtime_outbox_dispatch_mode="shadow",
                realtime_outbox_recording_enabled=True,
                scheduled_actions_mode="shadow",
            ),
        ).execute(
            driver,
            ride.id,
            CreateOfferInput(accept_at_fare=True),
        )

        offer_count = await session.scalar(select(func.count(OfferModel.id)))
        outbox_events = (
            await session.execute(
                select(RealtimeOutboxModel).order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()
        version = await session.get(
            RealtimeAggregateVersionModel,
            {"aggregate_type": "ride", "aggregate_id": ride.id},
        )
        scheduled_action = await session.scalar(select(ScheduledActionModel))

    assert offer_count == 1
    assert len(outbox_events) == 1
    expected_payload = events.build_create_offer_events(result)[0].payload
    assert outbox_events[0].payload == expected_payload
    assert expected_payload["type"] == "offer_created"
    assert outbox_events[0].aggregate_version == 1
    assert outbox_events[0].stream_version == 1
    assert version is not None
    assert version.version == 1
    assert scheduled_action is not None
    assert scheduled_action.dedupe_key == f"expire_offer:{result.detail.offer.id}"
    assert scheduled_action.payload == {"offer_id": str(result.detail.offer.id)}
    assert scheduled_action.execute_at > result.detail.offer.created_at


async def test_create_offer_off_tambien_persiste_recuperacion_durable(
    session_factory,
) -> None:
    async with session_factory() as session:
        rides, driver, ride = await _persist_sqlalchemy_scenario(session)

        result = await get_create_offer(
            rides,
            session,
            Settings(_env_file=None, scheduled_actions_mode="off"),
        ).execute(
            driver,
            ride.id,
            CreateOfferInput(accept_at_fare=True),
        )

        scheduled_action = await session.scalar(select(ScheduledActionModel))
        outbox_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))

    assert scheduled_action is not None
    assert scheduled_action.aggregate_id == result.detail.offer.id
    assert scheduled_action.status == "pending"
    assert outbox_count == 0


async def test_error_after_scheduling_rolls_back_offer_outbox_and_action(
    session_factory,
):
    async with session_factory() as session:
        rides, driver, ride = await _persist_sqlalchemy_scenario(session)
        scheduled_actions = SqlAlchemyScheduledActionRepository(session)

        class ScheduleThenFail:
            async def schedule(self, action):
                await scheduled_actions.schedule(action)
                raise RuntimeError("fallo después de agendar")

        use_case = CreateOffer(
            rides,
            SqlAlchemyOfferRepository(session, commit_create_or_supersede=False),
            SqlAlchemyUnitOfWork(session),
            OutboxCreateOfferEventRecorder(SqlAlchemyRealtimeOutbox(session)),
            ScheduleThenFail(),  # type: ignore[arg-type]
        )

        with pytest.raises(RuntimeError, match="después de agendar"):
            await use_case.execute(
                driver,
                ride.id,
                CreateOfferInput(accept_at_fare=True),
            )

        offer_count = await session.scalar(select(func.count(OfferModel.id)))
        event_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))
        action_count = await session.scalar(
            select(func.count(ScheduledActionModel.id))
        )

    assert offer_count == 0
    assert event_count == 0
    assert action_count == 0


async def test_error_after_inserting_outbox_rolls_back_offer_event_and_version(
    session_factory,
):
    async with session_factory() as session:
        rides, driver, ride = await _persist_sqlalchemy_scenario(session)
        outbox = SqlAlchemyRealtimeOutbox(session)
        recorder = OutboxCreateOfferEventRecorder(outbox)

        class RecordThenFail:
            async def record(self, result):
                await recorder.record(result)
                raise RuntimeError("fallo después de insertar la outbox")

        use_case = CreateOffer(
            rides,
            SqlAlchemyOfferRepository(session, commit_create_or_supersede=False),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),  # type: ignore[arg-type]
        )

        with pytest.raises(RuntimeError, match="después de insertar"):
            await use_case.execute(
                driver,
                ride.id,
                CreateOfferInput(accept_at_fare=True),
            )

        offer_count = await session.scalar(select(func.count(OfferModel.id)))
        event_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))
        version_count = await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        )

    assert offer_count == 0
    assert event_count == 0
    assert version_count == 0
