"""Atomicity and realtime contract of an offer's explicit rejection."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.api.deps import get_reject_offer
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxRejectOfferEventRecorder
from app.application.use_cases.reject_offer import RejectOffer
from app.domain.entities import (
    Location,
    Offer,
    OfferStatus,
    RideRequest,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime.hub import driver_topic
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRejectOfferEventRecorder,
    InMemoryRideRequestRepository,
    InMemoryUnitOfWork,
    reject_offer_use_case,
)


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-reject-{uuid.uuid4()}@viajaya.com",
    )


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-reject-{uuid.uuid4()}@viajaya.com",
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
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository()
    ride = await rides.add(_ride(rider.id))
    offer = await offers.add(_offer(driver.id, ride.id))
    return rides, offers, rider, driver, offer


async def _sql_scenario(session):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(_rider())
    driver = await users.add(_driver())
    ride = await SqlAlchemyRideRequestRepository(session).add(_ride(rider.id))
    offer = await SqlAlchemyOfferRepository(session).add(
        _offer(driver.id, ride.id)
    )
    return rider, driver, offer


async def test_builder_and_direct_delivery_share_exact_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, _, _, offer = await _memory_scenario()

    batch = events.build_reject_offer_events(offer)
    assert len(batch) == 1
    assert batch[0].event_type == "offer_rejected"
    assert batch[0].topic == driver_topic(offer.driver_id)
    assert (batch[0].aggregate_type, batch[0].aggregate_id) == (
        "ride",
        offer.ride_id,
    )
    assert batch[0].payload == {
        "type": "offer_rejected",
        "data": {
            "ride_id": str(offer.ride_id),
            "offer_id": str(offer.id),
            "reason": "declined",
        },
    }

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_offer_rejected(offer)

    assert delivered == [(batch[0].topic, batch[0].payload)]


async def test_use_case_mutates_records_and_then_commits() -> None:
    rides, offers, rider, _, offer = await _memory_scenario()
    operations: list[str] = []
    recorder = InMemoryRejectOfferEventRecorder(operations=operations)
    unit_of_work = InMemoryUnitOfWork(offers, operations=operations)

    rejected = await reject_offer_use_case(
        rides,
        offers,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(rider, offer.id)

    assert rejected.status is OfferStatus.REJECTED
    assert recorder.offers == [rejected]
    assert operations == ["record", "commit"]
    assert unit_of_work.rollbacks == 0


async def test_foreign_rider_rolls_back_without_recording() -> None:
    rides, offers, _, _, offer = await _memory_scenario()
    recorder = InMemoryRejectOfferEventRecorder()
    unit_of_work = InMemoryUnitOfWork(offers)

    with pytest.raises(NotAuthorizedActionError):
        await reject_offer_use_case(
            rides,
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(_rider(), offer.id)

    assert offer.status is OfferStatus.PENDING
    assert recorder.offers == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_lost_compare_and_set_rolls_back_without_recording() -> None:
    rides, offers, rider, _, offer = await _memory_scenario()
    recorder = InMemoryRejectOfferEventRecorder()
    unit_of_work = InMemoryUnitOfWork(offers)

    class RaceLosingOffers(InMemoryOfferRepository):
        async def get_by_id(self, offer_id: uuid.UUID) -> Offer | None:
            return await offers.get_by_id(offer_id)

        async def reject_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
            current = await offers.get_by_id(offer_id)
            assert current is not None
            current.status = OfferStatus.REJECTED
            return None

    with pytest.raises(InvalidRideTransitionError):
        await RejectOffer(
            rides,
            RaceLosingOffers(),
            unit_of_work,
            recorder,
        ).execute(rider, offer.id)

    restored = await offers.get_by_id(offer.id)
    assert restored is not None and restored.status is OfferStatus.PENDING
    assert recorder.offers == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_recorder_failure_rolls_back_memory_mutation() -> None:
    rides, offers, rider, _, offer = await _memory_scenario()
    recorder = InMemoryRejectOfferEventRecorder(
        error=RuntimeError("the recorder failed")
    )
    unit_of_work = InMemoryUnitOfWork(offers)

    with pytest.raises(RuntimeError, match="the recorder failed"):
        await reject_offer_use_case(
            rides,
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(rider, offer.id)

    restored = await offers.get_by_id(offer.id)
    assert restored is not None and restored.status is OfferStatus.PENDING
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_rejection_and_outbox_persist_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        rider, _, offer = await _sql_scenario(session)

        rejected = await get_reject_offer(
            SqlAlchemyRideRequestRepository(session),
            session,
            _settings(),
        ).execute(rider, offer.id)

    async with session_factory() as verification_session:
        row = await verification_session.get(OfferModel, offer.id)
        outbox_rows = (
            await verification_session.execute(select(RealtimeOutboxModel))
        ).scalars().all()
        assert rejected.status is OfferStatus.REJECTED
        assert row is not None and row.status is OfferStatus.REJECTED
        assert len(outbox_rows) == 1
        expected = events.build_reject_offer_events(rejected)[0]
        assert (
            outbox_rows[0].event_type,
            outbox_rows[0].topic,
            outbox_rows[0].payload,
        ) == (expected.event_type, expected.topic, expected.payload)
        assert outbox_rows[0].aggregate_version == 1
        assert outbox_rows[0].stream_version == 1
        assert await verification_session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 1
        assert await verification_session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 1


async def test_disabled_recording_preserves_legacy_without_backlog(
    session_factory,
) -> None:
    async with session_factory() as session:
        rider, _, offer = await _sql_scenario(session)

        rejected = await get_reject_offer(
            SqlAlchemyRideRequestRepository(session),
            session,
            _settings(enabled=False),
        ).execute(rider, offer.id)

        assert rejected.status is OfferStatus.REJECTED
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0


async def test_failure_after_outbox_flush_rolls_back_offer_and_counters(
    session_factory,
) -> None:
    async with session_factory() as session:
        rider, _, offer = await _sql_scenario(session)
        recorder = OutboxRejectOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))

        class RecordThenFail:
            async def record(self, rejected: Offer) -> None:
                await recorder.record(rejected)
                raise RuntimeError("failure after inserting the outbox")

        use_case = RejectOffer(
            SqlAlchemyRideRequestRepository(session),
            SqlAlchemyOfferRepository(
                session,
                commit_reject_if_pending=False,
            ),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="after inserting"):
            await use_case.execute(rider, offer.id)

        row = await session.get(OfferModel, offer.id, populate_existing=True)
        assert row is not None and row.status is OfferStatus.PENDING
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
        assert await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 0
        assert await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 0
