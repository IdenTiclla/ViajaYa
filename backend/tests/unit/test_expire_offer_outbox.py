"""Atomicidad y contrato realtime del vencimiento de una oferta."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select, update

from app.api.deps import (
    build_execute_expire_offer_scheduled_action,
    build_expire_offer,
)
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxExpireOfferEventRecorder
from app.application.dto import PendingScheduledAction
from app.application.use_cases.expire_offer import ExpireOffer
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
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
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
from app.infrastructure.realtime.hub import driver_topic, ride_topic
from tests.fakes import (
    InMemoryExpireOfferEventRecorder,
    InMemoryOfferRepository,
    InMemoryUnitOfWork,
    expire_offer_use_case,
)


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-expire-{uuid.uuid4()}@viajaya.com",
    )


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-expire-{uuid.uuid4()}@viajaya.com",
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


def _offer(driver_id: uuid.UUID, ride_id: uuid.UUID, *, expired: bool = True) -> Offer:
    created_at = datetime.now(UTC)
    if expired:
        created_at -= OFFER_TTL + timedelta(seconds=1)
    return Offer(
        ride_id=ride_id,
        driver_id=driver_id,
        price=Decimal("25.00"),
        eta_min=5,
        created_at=created_at,
    )


def _settings(*, enabled: bool = True) -> Settings:
    return Settings(
        realtime_outbox_dispatch_mode="shadow" if enabled else "off",
        realtime_outbox_recording_enabled=enabled,
    )


async def _memory_scenario(*, expired: bool = True):
    rider, driver = _rider(), _driver()
    offers = InMemoryOfferRepository()
    ride = _ride(rider.id)
    offer = await offers.add(_offer(driver.id, ride.id, expired=expired))
    return offers, offer


async def _sql_scenario(session, *, expired: bool = True):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(_rider())
    driver = await users.add(_driver())
    ride = await SqlAlchemyRideRequestRepository(session).add(_ride(rider.id))
    offer = await SqlAlchemyOfferRepository(session).add(
        _offer(driver.id, ride.id, expired=False)
    )
    if expired:
        await session.execute(
            update(OfferModel)
            .where(OfferModel.id == offer.id)
            .values(created_at=datetime.now(UTC) - OFFER_TTL - timedelta(seconds=1))
        )
        await session.commit()
    return offer


async def test_builder_and_direct_delivery_share_exact_expiration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, offer = await _memory_scenario()

    batch = events.build_expire_offer_events(offer)
    assert len(batch) == 2
    assert [event.event_type for event in batch] == [
        "offer_expired",
        "offer_expired",
    ]
    assert [event.topic for event in batch] == [
        driver_topic(offer.driver_id),
        ride_topic(offer.ride_id),
    ]
    assert [
        (event.aggregate_type, event.aggregate_id) for event in batch
    ] == [("ride", offer.ride_id), ("ride", offer.ride_id)]
    expected_payload = {
        "type": "offer_expired",
        "data": {
            "ride_id": str(offer.ride_id),
            "offer_id": str(offer.id),
            "driver_id": str(offer.driver_id),
            "reason": "expired",
        },
    }
    assert [event.payload for event in batch] == [expected_payload, expected_payload]

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_offer_expired(offer)

    assert delivered == [(event.topic, event.payload) for event in batch]


async def test_use_case_mutates_records_and_then_commits() -> None:
    offers, offer = await _memory_scenario()
    operations: list[str] = []
    recorder = InMemoryExpireOfferEventRecorder(operations=operations)
    unit_of_work = InMemoryUnitOfWork(offers, operations=operations)

    expired = await expire_offer_use_case(
        offers,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(offer.id)

    assert expired is not None and expired.status is OfferStatus.EXPIRED
    assert recorder.offers == [expired]
    assert operations == ["record", "commit"]
    assert unit_of_work.rollbacks == 0


async def test_fresh_offer_rolls_back_without_recording() -> None:
    offers, offer = await _memory_scenario(expired=False)
    recorder = InMemoryExpireOfferEventRecorder()
    unit_of_work = InMemoryUnitOfWork(offers)

    result = await expire_offer_use_case(
        offers,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(offer.id)

    assert result is None
    assert offer.status is OfferStatus.PENDING
    assert recorder.offers == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_recorder_failure_rolls_back_memory_mutation() -> None:
    offers, offer = await _memory_scenario()
    recorder = InMemoryExpireOfferEventRecorder(
        error=RuntimeError("falló el recorder")
    )
    unit_of_work = InMemoryUnitOfWork(offers)

    with pytest.raises(RuntimeError, match="falló el recorder"):
        await expire_offer_use_case(
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(offer.id)

    restored = await offers.get_by_id(offer.id)
    assert restored is not None and restored.status is OfferStatus.PENDING
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_expiration_and_outbox_persist_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        offer = await _sql_scenario(session)
        expired = await build_expire_offer(session, _settings()).execute(offer.id)

    async with session_factory() as verification_session:
        row = await verification_session.get(OfferModel, offer.id)
        outbox_rows = (
            await verification_session.execute(
                select(RealtimeOutboxModel).order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()

        assert expired is not None and expired.status is OfferStatus.EXPIRED
        assert row is not None and row.status is OfferStatus.EXPIRED
        assert len(outbox_rows) == 2
        expected = events.build_expire_offer_events(expired)
        assert [
            (item.event_type, item.topic, item.payload) for item in outbox_rows
        ] == [
            (item.event_type, item.topic, item.payload) for item in expected
        ]
        assert len({item.batch_id for item in outbox_rows}) == 1
        assert [item.sequence for item in outbox_rows] == [0, 1]
        assert [item.aggregate_version for item in outbox_rows] == [1, 2]
        assert [item.stream_version for item in outbox_rows] == [1, 1]
        assert await verification_session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 1
        assert await verification_session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 2


async def test_scheduled_expiration_confirma_negocio_outbox_y_ack_en_un_commit(
    session_factory,
) -> None:
    completed_at = datetime.now(UTC)
    async with session_factory() as session:
        offer = await _sql_scenario(session)
        actions = SqlAlchemyScheduledActionRepository(session)
        await actions.schedule(
            PendingScheduledAction(
                dedupe_key=f"expire_offer:{offer.id}",
                action_type="expire_offer",
                aggregate_id=offer.id,
                generation=1,
                execute_at=completed_at,
                payload={"offer_id": str(offer.id)},
            )
        )
        await session.commit()
        claimed = await actions.claim_due(
            completed_at,
            completed_at - timedelta(minutes=1),
        )
        assert claimed is not None
        await session.commit()

    async with session_factory() as session:
        outcome = await build_execute_expire_offer_scheduled_action(
            session,
            _settings(),
        ).execute(claimed, completed_at)

    async with session_factory() as session:
        offer_status = await session.scalar(
            select(OfferModel.status).where(OfferModel.id == offer.id)
        )
        action = await session.scalar(select(ScheduledActionModel))
        outbox_count = await session.scalar(
            select(func.count(RealtimeOutboxModel.id))
        )
    assert outcome == "succeeded"
    assert offer_status is OfferStatus.EXPIRED
    assert action is not None and action.status == "succeeded"
    assert action.terminal_at is not None
    assert outbox_count == 2


async def test_disabled_recording_preserves_expiration_without_backlog(
    session_factory,
) -> None:
    async with session_factory() as session:
        offer = await _sql_scenario(session)
        expired = await build_expire_offer(
            session,
            _settings(enabled=False),
        ).execute(offer.id)

        assert expired is not None and expired.status is OfferStatus.EXPIRED
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0


async def test_sql_noop_leaves_rollback_to_unit_of_work(session_factory) -> None:
    async with session_factory() as session:
        offer = await _sql_scenario(session, expired=False)
        repository = SqlAlchemyOfferRepository(
            session,
            commit_mark_expired_if_pending=False,
        )

        result = await repository.mark_expired_if_pending(offer.id)

        assert result is None
        assert session.in_transaction()
        await SqlAlchemyUnitOfWork(session).rollback()
        assert not session.in_transaction()

    async with session_factory() as verification_session:
        row = await verification_session.get(OfferModel, offer.id)
        assert row is not None and row.status is OfferStatus.PENDING
        assert await verification_session.scalar(
            select(func.count(RealtimeOutboxModel.id))
        ) == 0


async def test_failure_after_outbox_flush_rolls_back_offer_and_counters(
    session_factory,
) -> None:
    async with session_factory() as session:
        offer = await _sql_scenario(session)
        recorder = OutboxExpireOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))

        class RecordThenFail:
            async def record(self, expired: Offer) -> None:
                await recorder.record(expired)
                raise RuntimeError("fallo después de insertar la outbox")

        use_case = ExpireOffer(
            SqlAlchemyOfferRepository(
                session,
                commit_mark_expired_if_pending=False,
            ),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="después de insertar"):
            await use_case.execute(offer.id)

        row = await session.get(OfferModel, offer.id, populate_existing=True)
        assert row is not None and row.status is OfferStatus.PENDING
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
        assert await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 0
        assert await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 0
