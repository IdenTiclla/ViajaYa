"""Atomicidad y contrato realtime de la disponibilidad del conductor."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.api.deps import get_set_driver_online
from app.api.v1 import events
from app.api.v1.realtime_outbox import OutboxDriverAvailabilityEventRecorder
from app.application.dto import DriverAvailabilityResult
from app.application.use_cases.set_driver_online import SetDriverOnline
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
from app.domain.exceptions import DriverUnavailableError
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
    UserModel,
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
    InMemoryDriverAvailabilityEventRecorder,
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUnitOfWork,
    InMemoryUserRepository,
    set_driver_online_use_case,
)


def _rider() -> User:
    return User(
        full_name="Pasajero",
        email=f"rider-offline-{uuid.uuid4()}@viajaya.com",
    )


def _driver() -> User:
    return User(
        full_name="Conductor",
        email=f"driver-offline-{uuid.uuid4()}@viajaya.com",
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


async def _memory_scenario(*, offers_count: int = 2):
    driver = _driver()
    users = InMemoryUserRepository()
    await users.add(driver)
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    created: list[Offer] = []
    for _ in range(offers_count):
        rider = _rider()
        await users.add(rider)
        ride = await rides.add(_ride(rider.id))
        created.append(await offers.add(_offer(driver.id, ride.id)))
    return users, rides, offers, driver, created


async def _sql_scenario(session, *, offers_count: int = 2):
    users = SqlAlchemyUserRepository(session)
    driver = await users.add(_driver())
    rides = SqlAlchemyRideRequestRepository(session)
    offers = SqlAlchemyOfferRepository(session)
    created: list[Offer] = []
    for _ in range(offers_count):
        rider = await users.add(_rider())
        ride = await rides.add(_ride(rider.id))
        created.append(await offers.add(_offer(driver.id, ride.id)))
    return driver, created


async def test_builder_and_direct_delivery_share_exact_offline_fanout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    users, _, offers, driver, _ = await _memory_scenario()
    result = await set_driver_online_use_case(users, offers).execute(driver, False)

    batch = events.build_driver_availability_events(result)
    assert len(batch) == 3
    assert [event.event_type for event in batch] == [
        "offer_withdrawn",
        "offer_withdrawn",
        "offers_withdrawn",
    ]
    assert [event.topic for event in batch] == [
        *(ride_topic(offer.ride_id) for offer in result.withdrawn_offers),
        driver_topic(driver.id),
    ]
    assert [
        (event.aggregate_type, event.aggregate_id) for event in batch
    ] == [
        *(("ride", offer.ride_id) for offer in result.withdrawn_offers),
        ("driver", driver.id),
    ]
    for event, offer in zip(batch[:-1], result.withdrawn_offers, strict=True):
        assert event.payload == {
            "type": "offer_withdrawn",
            "data": {
                "driver_id": str(driver.id),
                "offer_id": str(offer.id),
                "reason": "driver_offline",
            },
        }
    assert batch[-1].payload == {
        "type": "offers_withdrawn",
        "data": {
            "ride_ids": [str(offer.ride_id) for offer in result.withdrawn_offers],
            "offers": [
                {
                    "ride_id": str(offer.ride_id),
                    "offer_id": str(offer.id),
                }
                for offer in result.withdrawn_offers
            ],
            "reason": "driver_offline",
        },
    }

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_driver_offline_offers(result)

    assert delivered == [(event.topic, event.payload) for event in batch]


async def test_empty_availability_changes_do_not_build_events() -> None:
    users, _, offers, driver, _ = await _memory_scenario(offers_count=0)

    online = await set_driver_online_use_case(users, offers).execute(driver, True)
    offline = await set_driver_online_use_case(users, offers).execute(driver, False)

    assert events.build_driver_availability_events(online) == []
    assert events.build_driver_availability_events(offline) == []


async def test_use_case_mutates_records_and_then_commits() -> None:
    users, _, offers, driver, created = await _memory_scenario()
    operations: list[str] = []
    recorder = InMemoryDriverAvailabilityEventRecorder(operations=operations)
    unit_of_work = InMemoryUnitOfWork(
        offers,
        users=users,
        operations=operations,
    )

    result = await set_driver_online_use_case(
        users,
        offers,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(driver, False)

    assert result.driver.is_online is False
    assert [offer.id for offer in result.withdrawn_offers] == [
        offer.id for offer in reversed(created)
    ]
    assert recorder.results == [result]
    assert operations == ["record", "commit"]
    assert unit_of_work.rollbacks == 0


async def test_expired_offers_are_rejected_without_offline_events() -> None:
    users, _, offers, driver, created = await _memory_scenario(offers_count=1)
    created[0].created_at = datetime.now(UTC) - OFFER_TTL - timedelta(seconds=1)

    result = await set_driver_online_use_case(users, offers).execute(driver, False)

    stored = await offers.get_by_id(created[0].id)
    assert stored is not None and stored.status is OfferStatus.REJECTED
    assert result.withdrawn_offers == []
    assert events.build_driver_availability_events(result) == []


async def test_mixed_live_and_expired_offers_only_publish_live_withdrawal() -> None:
    users, _, offers, driver, created = await _memory_scenario(offers_count=2)
    created[0].created_at = datetime.now(UTC) - OFFER_TTL - timedelta(seconds=1)

    result = await set_driver_online_use_case(users, offers).execute(driver, False)

    assert [offer.id for offer in result.withdrawn_offers] == [created[1].id]
    for offer in created:
        stored = await offers.get_by_id(offer.id)
        assert stored is not None and stored.status is OfferStatus.REJECTED
    batch = events.build_driver_availability_events(result)
    assert [event.event_type for event in batch] == [
        "offer_withdrawn",
        "offers_withdrawn",
    ]
    assert batch[0].payload["data"]["offer_id"] == str(created[1].id)


async def test_active_ride_rolls_back_without_recording() -> None:
    users, rides, offers, driver, _ = await _memory_scenario(offers_count=0)
    rider = _rider()
    ride = _ride(rider.id)
    ride.driver_id = driver.id
    ride.status = RideStatus.ACCEPTED
    await rides.add(ride)
    recorder = InMemoryDriverAvailabilityEventRecorder()
    unit_of_work = InMemoryUnitOfWork(offers, users=users)

    with pytest.raises(DriverUnavailableError):
        await set_driver_online_use_case(
            users,
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(driver, False)

    stored = await users.get_by_id(driver.id)
    assert stored is not None and stored.is_online is True
    assert recorder.results == []
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_recorder_failure_restores_driver_and_offers() -> None:
    users, _, offers, driver, created = await _memory_scenario(offers_count=1)
    recorder = InMemoryDriverAvailabilityEventRecorder(
        error=RuntimeError("falló el recorder")
    )
    unit_of_work = InMemoryUnitOfWork(offers, users=users)

    with pytest.raises(RuntimeError, match="falló el recorder"):
        await set_driver_online_use_case(
            users,
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(driver, False)

    stored_driver = await users.get_by_id(driver.id)
    stored_offer = await offers.get_by_id(created[0].id)
    assert stored_driver is not None and stored_driver.is_online is True
    assert stored_offer is not None and stored_offer.status is OfferStatus.PENDING
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_offline_and_outbox_persist_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        driver, _ = await _sql_scenario(session)
        result = await get_set_driver_online(session, _settings()).execute(
            driver,
            False,
        )

    async with session_factory() as verification_session:
        driver_row = await verification_session.get(UserModel, driver.id)
        offer_statuses = (
            await verification_session.execute(
                select(OfferModel.status).where(OfferModel.driver_id == driver.id)
            )
        ).scalars().all()
        outbox_rows = (
            await verification_session.execute(
                select(RealtimeOutboxModel).order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()

        assert driver_row is not None and driver_row.is_online is False
        assert offer_statuses == [OfferStatus.REJECTED, OfferStatus.REJECTED]
        expected = events.build_driver_availability_events(result)
        assert [
            (row.event_type, row.topic, row.payload) for row in outbox_rows
        ] == [
            (event.event_type, event.topic, event.payload) for event in expected
        ]
        assert len({row.batch_id for row in outbox_rows}) == 1
        assert [row.sequence for row in outbox_rows] == [0, 1, 2]
        assert [row.aggregate_version for row in outbox_rows] == [1, 1, 1]
        assert [row.stream_version for row in outbox_rows] == [1, 1, 1]
        assert await verification_session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 3
        assert await verification_session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 3


@pytest.mark.parametrize("is_online", [True, False])
async def test_empty_change_with_recording_enabled_creates_no_backlog(
    session_factory,
    is_online: bool,
) -> None:
    async with session_factory() as session:
        driver, _ = await _sql_scenario(session, offers_count=0)
        result = await get_set_driver_online(session, _settings()).execute(
            driver,
            is_online,
        )

        assert result.driver.is_online is is_online
        assert result.withdrawn_offers == []
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0


async def test_disabled_recording_preserves_offline_without_backlog(
    session_factory,
) -> None:
    async with session_factory() as session:
        driver, _ = await _sql_scenario(session, offers_count=1)
        result = await get_set_driver_online(
            session,
            _settings(enabled=False),
        ).execute(driver, False)

        assert result.driver.is_online is False
        assert len(result.withdrawn_offers) == 1
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0


async def test_failure_after_outbox_flush_rolls_back_driver_offers_and_counters(
    session_factory,
) -> None:
    async with session_factory() as session:
        driver, created = await _sql_scenario(session, offers_count=1)
        recorder = OutboxDriverAvailabilityEventRecorder(
            SqlAlchemyRealtimeOutbox(session)
        )

        class RecordThenFail:
            async def record(self, result: DriverAvailabilityResult) -> None:
                await recorder.record(result)
                raise RuntimeError("fallo después de insertar la outbox")

        use_case = SetDriverOnline(
            SqlAlchemyUserRepository(session, commit_set_online=False),
            SqlAlchemyOfferRepository(
                session,
                commit_set_driver_offline=False,
            ),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),
        )
        with pytest.raises(RuntimeError, match="después de insertar"):
            await use_case.execute(driver, False)

        driver_row = await session.get(UserModel, driver.id, populate_existing=True)
        offer_row = await session.get(
            OfferModel,
            created[0].id,
            populate_existing=True,
        )
        assert driver_row is not None and driver_row.is_online is True
        assert offer_row is not None and offer_row.status is OfferStatus.PENDING
        assert await session.scalar(select(func.count(RealtimeOutboxModel.id))) == 0
        assert await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        ) == 0
        assert await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        ) == 0
