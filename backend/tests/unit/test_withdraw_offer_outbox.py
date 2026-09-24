"""Atomicity and realtime contract of an offer's voluntary withdrawal."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.api.deps import get_withdraw_offer
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxWithdrawOfferEventRecorder
from app.application.use_cases.withdraw_offer import WithdrawOffer
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
from app.domain.exceptions import InvalidRideTransitionError
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
from app.infrastructure.realtime.hub import ride_topic
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryUnitOfWork,
    InMemoryWithdrawOfferEventRecorder,
    withdraw_offer_use_case,
)


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-withdraw-{uuid.uuid4()}@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        is_online=True,
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
    driver = _driver()
    offers = InMemoryOfferRepository()
    offer = await offers.add(_offer(driver.id, uuid.uuid4()))
    return offers, driver, offer


async def _sql_scenario(session):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(
        User(
            full_name="Pasajero",
            email=f"rider-withdraw-{uuid.uuid4()}@viajaya.com",
        )
    )
    driver = await users.add(_driver())
    ride = await SqlAlchemyRideRequestRepository(session).add(
        RideRequest(
            rider_id=rider.id,
            origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
            destination=Location(-16.49, -68.14, "Trabajo", "Av. 2"),
            service_type=ServiceType.TAXI,
            fare=Decimal("25.00"),
        )
    )
    offer = await SqlAlchemyOfferRepository(session).add(
        _offer(driver.id, ride.id)
    )
    return driver, offer


async def test_builder_and_direct_delivery_share_exact_withdrawal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, offer = await _memory_scenario()

    batch = events.build_withdraw_offer_events(offer)
    assert len(batch) == 1
    assert batch[0].event_type == "offer_withdrawn"
    assert batch[0].topic == ride_topic(offer.ride_id)
    assert (batch[0].aggregate_type, batch[0].aggregate_id) == (
        "ride",
        offer.ride_id,
    )
    assert batch[0].payload == {
        "type": "offer_withdrawn",
        "data": {
            "driver_id": str(offer.driver_id),
            "offer_id": str(offer.id),
        },
    }

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_offer_withdrawn_by_driver(offer)

    assert delivered == [(batch[0].topic, batch[0].payload)]


async def test_use_case_mutates_records_and_then_commits() -> None:
    offers, driver, offer = await _memory_scenario()
    operations: list[str] = []
    recorder = InMemoryWithdrawOfferEventRecorder(operations=operations)
    unit_of_work = InMemoryUnitOfWork(offers, operations=operations)

    withdrawn = await withdraw_offer_use_case(
        offers,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(driver, offer.id)

    assert withdrawn.status is OfferStatus.REJECTED
    assert recorder.offers == [withdrawn]
    assert operations == ["record", "commit"]
    assert unit_of_work.rollbacks == 0


async def test_recorder_failure_rolls_back_memory_mutation() -> None:
    offers, driver, offer = await _memory_scenario()
    recorder = InMemoryWithdrawOfferEventRecorder(
        error=RuntimeError("the recorder failed")
    )
    unit_of_work = InMemoryUnitOfWork(offers)

    with pytest.raises(RuntimeError, match="the recorder failed"):
        await withdraw_offer_use_case(
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(driver, offer.id)

    restored = await offers.get_by_id(offer.id)
    assert restored is not None
    assert restored.status is OfferStatus.PENDING
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_lost_compare_and_set_rolls_back_without_recording() -> None:
    offers, driver, offer = await _memory_scenario()
    recorder = InMemoryWithdrawOfferEventRecorder()
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
        await WithdrawOffer(
            RaceLosingOffers(),
            unit_of_work,
            recorder,
        ).execute(driver, offer.id)

    restored = await offers.get_by_id(offer.id)
    assert restored is not None and restored.status is OfferStatus.PENDING
    assert recorder.offers == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_withdrawal_and_outbox_persist_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        driver, offer = await _sql_scenario(session)

        withdrawn = await get_withdraw_offer(
            session,
            _settings(),
        ).execute(driver, offer.id)

    async with session_factory() as verification_session:
        row = await verification_session.get(OfferModel, offer.id)
        outbox_rows = (
            await verification_session.execute(select(RealtimeOutboxModel))
        ).scalars().all()
        assert withdrawn.status is OfferStatus.REJECTED
        assert row is not None and row.status is OfferStatus.REJECTED
        assert len(outbox_rows) == 1
        expected = events.build_withdraw_offer_events(withdrawn)[0]
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
        driver, offer = await _sql_scenario(session)

        withdrawn = await get_withdraw_offer(
            session,
            _settings(enabled=False),
        ).execute(driver, offer.id)

        assert withdrawn.status is OfferStatus.REJECTED
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0


async def test_failure_after_outbox_flush_rolls_back_offer_and_counters(
    session_factory,
) -> None:
    async with session_factory() as session:
        driver, offer = await _sql_scenario(session)
        recorder = OutboxWithdrawOfferEventRecorder(
            SqlAlchemyRealtimeOutbox(session)
        )

        class RecordThenFail:
            async def record(self, withdrawn: Offer) -> None:
                await recorder.record(withdrawn)
                raise RuntimeError("failure after inserting the outbox")

        use_case = WithdrawOffer(
            SqlAlchemyOfferRepository(
                session,
                commit_reject_if_pending=False,
            ),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="after inserting"):
            await use_case.execute(driver, offer.id)

        row = await session.get(OfferModel, offer.id, populate_existing=True)
        assert row is not None and row.status is OfferStatus.PENDING
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
        assert await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 0
        assert await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 0


async def test_sql_lost_compare_and_set_leaves_rollback_to_unit_of_work(
    session_factory,
) -> None:
    async with session_factory() as session:
        driver, offer = await _sql_scenario(session)

        # Another transaction wins. In UoW mode, the CAS must return ``None`` without
        # closing on its own the transaction that belongs to the application.
        async with session_factory() as competing_session:
            rejected = await SqlAlchemyOfferRepository(
                competing_session
            ).reject_if_pending(offer.id)
            assert rejected is not None

        del driver
        result = await SqlAlchemyOfferRepository(
            session,
            commit_reject_if_pending=False,
        ).reject_if_pending(offer.id)

        assert result is None
        assert session.in_transaction()
        await SqlAlchemyUnitOfWork(session).rollback()
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
