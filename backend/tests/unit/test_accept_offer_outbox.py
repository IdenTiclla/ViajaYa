"""Frontera transaccional y contrato realtime de AcceptOffer."""

from __future__ import annotations

import uuid
from dataclasses import replace
from decimal import Decimal
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_accept_offer
from app.api.v1 import events
from app.api.v1.realtime_outbox import (
    DisabledAcceptOfferEventRecorder,
    OutboxAcceptOfferEventRecorder,
)
from app.application.dto import CreateOfferInput
from app.application.use_cases.accept_offer import AcceptOffer
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
    InMemoryAcceptOfferEventRecorder,
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUnitOfWork,
    InMemoryUserRepository,
    accept_offer_use_case,
    create_offer_use_case,
)

_ORIGIN = Location(-16.5, -68.13, "Casa", "Calle 1")
_DESTINATION = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _passenger(label: str) -> User:
    return User(
        full_name=f"Pasajero {label}",
        email=f"rider-{label}-{uuid.uuid4().hex[:6]}@viajaya.com",
    )


def _driver(label: str) -> User:
    return User(
        full_name=f"Conductor {label}",
        email=f"driver-{label}-{uuid.uuid4().hex[:6]}@viajaya.com",
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


async def _memory_scenario(
    *,
    offers_type: type[InMemoryOfferRepository] = InMemoryOfferRepository,
):
    users = InMemoryUserRepository()
    rider = await users.add(_passenger("principal"))
    other_rider = await users.add(_passenger("secundario"))
    winner = await users.add(_driver("ganador"))
    loser = await users.add(_driver("perdedor"))
    rides = InMemoryRideRequestRepository()
    accepted_ride = await rides.add(_ride(rider.id))
    other_ride = await rides.add(_ride(other_rider.id))
    offers = offers_type(rides=rides, users=users)

    chosen = await create_offer_use_case(rides, offers).execute(
        winner,
        accepted_ride.id,
        CreateOfferInput(accept_at_fare=True),
    )
    await create_offer_use_case(rides, offers).execute(
        loser,
        accepted_ride.id,
        CreateOfferInput(accept_at_fare=True),
    )
    await create_offer_use_case(rides, offers).execute(
        winner,
        other_ride.id,
        CreateOfferInput(accept_at_fare=True),
    )
    return rides, offers, rider, winner, loser, accepted_ride, other_ride, chosen


async def test_accept_offer_records_after_mutation_and_commits_last() -> None:
    operations: list[str] = []

    class RecordingOfferRepository(InMemoryOfferRepository):
        async def accept_atomically(self, offer_id):
            result = await super().accept_atomically(offer_id)
            operations.append("mutate")
            return result

    rides, offers, rider, _, _, _, _, chosen = await _memory_scenario(
        offers_type=RecordingOfferRepository
    )
    unit_of_work = InMemoryUnitOfWork(offers, rides=rides, operations=operations)
    recorder = InMemoryAcceptOfferEventRecorder(operations=operations)

    result = await accept_offer_use_case(
        rides,
        offers,
        unit_of_work=unit_of_work,
        event_recorder=recorder,
    ).execute(rider, chosen.detail.offer.id)

    assert operations == ["mutate", "record", "commit"]
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 0
    assert recorder.results == [result]


async def test_accept_offer_rolls_back_all_mutations_when_recording_fails() -> None:
    rides, offers, rider, _, _, accepted_ride, other_ride, chosen = (
        await _memory_scenario()
    )
    unit_of_work = InMemoryUnitOfWork(offers, rides=rides)
    recorder = InMemoryAcceptOfferEventRecorder(error=RuntimeError("outbox unavailable"))

    with pytest.raises(RuntimeError, match="outbox unavailable"):
        await accept_offer_use_case(
            rides,
            offers,
            unit_of_work=unit_of_work,
            event_recorder=recorder,
        ).execute(rider, chosen.detail.offer.id)

    restored_accepted_ride = await rides.get_by_id(accepted_ride.id)
    restored_other_ride = await rides.get_by_id(other_ride.id)
    assert restored_accepted_ride is not None
    assert restored_accepted_ride.status is RideStatus.SEARCHING
    assert restored_accepted_ride.driver_id is None
    assert restored_accepted_ride.accepted_offer_id is None
    assert restored_other_ride is not None
    assert all(offer.status is OfferStatus.PENDING for offer in offers.offers)
    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_accept_builder_preserves_order_routing_aggregates_and_direct_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rides, offers, rider, winner, loser, accepted_ride, other_ride, chosen = (
        await _memory_scenario()
    )
    result = await accept_offer_use_case(rides, offers).execute(
        rider,
        chosen.detail.offer.id,
    )

    batch = events.build_accept_offer_events(result)
    assert [event.event_type for event in batch] == [
        "ride_status",
        "ride_closed",
        "offer_accepted",
        "offers_withdrawn",
        "offer_withdrawn",
        "offer_rejected",
    ]
    assert [event.topic for event in batch] == [
        ride_topic(accepted_ride.id),
        pool_topic(ServiceType.TAXI.value),
        driver_topic(winner.id),
        driver_topic(winner.id),
        ride_topic(other_ride.id),
        driver_topic(loser.id),
    ]
    assert [(event.aggregate_type, event.aggregate_id) for event in batch] == [
        ("ride", accepted_ride.id),
        ("ride", accepted_ride.id),
        ("ride", accepted_ride.id),
        ("driver", winner.id),
        ("ride", other_ride.id),
        ("ride", accepted_ride.id),
    ]
    assert batch[1].payload["data"] == {
        "ride_id": str(accepted_ride.id),
        "pool_version": accepted_ride.pool_version,
        "reason": "terminal",
    }
    assert batch[3].payload["data"] == {"ride_ids": [str(other_ride.id)]}
    assert batch[4].payload["data"] == {"driver_id": str(winner.id)}
    assert batch[5].payload["data"] == {
        "ride_id": str(accepted_ride.id),
        "offer_id": None,
        "reason": "ride_taken",
    }

    delivered: list[tuple[str, dict[str, object]]] = []

    async def capture(topic: str, payload: dict[str, object]) -> None:
        delivered.append((topic, payload))

    monkeypatch.setattr(events.hub, "broadcast", capture)
    await events.publish_offer_accepted(result)

    assert delivered == [(event.topic, event.payload) for event in batch]


async def test_accept_outbox_recorder_uses_same_canonical_batch() -> None:
    class CapturingOutbox:
        def __init__(self) -> None:
            self.events = []

        async def add_batch(self, pending):
            self.events = list(pending)
            return []

    rides, offers, rider, _, _, _, _, chosen = await _memory_scenario()
    result = await accept_offer_use_case(rides, offers).execute(
        rider,
        chosen.detail.offer.id,
    )
    outbox = CapturingOutbox()

    await OutboxAcceptOfferEventRecorder(outbox).record(result)  # type: ignore[arg-type]

    assert outbox.events == events.build_accept_offer_events(result)


async def test_accept_builder_rejects_result_without_driver() -> None:
    rides, offers, rider, _, _, _, _, chosen = await _memory_scenario()
    result = await accept_offer_use_case(rides, offers).execute(
        rider,
        chosen.detail.offer.id,
    )
    invalid = replace(result, detail=replace(result.detail, driver=None))

    with pytest.raises(ValueError, match="conductor elegido"):
        events.build_accept_offer_events(invalid)


def test_get_accept_offer_wires_uow_and_recording_flag() -> None:
    session = Mock(spec=AsyncSession)
    rides = InMemoryRideRequestRepository()

    enabled = get_accept_offer(
        rides,
        session,  # type: ignore[arg-type]
        Settings(
            realtime_outbox_dispatch_mode="shadow",
            realtime_outbox_recording_enabled=True,
        ),
    )
    disabled = get_accept_offer(
        rides,
        session,  # type: ignore[arg-type]
        Settings(),
    )

    assert isinstance(enabled._offers, SqlAlchemyOfferRepository)
    assert enabled._offers._commit_accept is False
    assert enabled._unit_of_work._session is session
    assert enabled._event_recorder._outbox._session is session
    assert isinstance(disabled._event_recorder, DisabledAcceptOfferEventRecorder)


async def _sqlalchemy_scenario(session: AsyncSession):
    users = SqlAlchemyUserRepository(session)
    rider = await users.add(_passenger("sql-principal"))
    other_rider = await users.add(_passenger("sql-secundario"))
    winner = await users.add(_driver("sql-ganador"))
    loser = await users.add(_driver("sql-perdedor"))
    rides = SqlAlchemyRideRequestRepository(session)
    accepted_ride = await rides.add(_ride(rider.id))
    other_ride = await rides.add(_ride(other_rider.id))
    offers = SqlAlchemyOfferRepository(session)
    chosen = await offers.add(
        Offer(
            ride_id=accepted_ride.id,
            driver_id=winner.id,
            price=accepted_ride.fare,
        )
    )
    loser_offer = await offers.add(
        Offer(
            ride_id=accepted_ride.id,
            driver_id=loser.id,
            price=accepted_ride.fare,
        )
    )
    other_offer = await offers.add(
        Offer(
            ride_id=other_ride.id,
            driver_id=winner.id,
            price=other_ride.fare,
        )
    )
    return (
        rides,
        rider,
        winner,
        loser,
        accepted_ride,
        other_ride,
        chosen,
        loser_offer,
        other_offer,
    )


async def test_accept_persists_business_and_outbox_in_one_commit(session_factory) -> None:
    async with session_factory() as session:
        (
            rides,
            rider,
            winner,
            loser,
            accepted_ride,
            other_ride,
            chosen,
            loser_offer,
            other_offer,
        ) = await _sqlalchemy_scenario(session)

        result = await get_accept_offer(
            rides,
            session,
            Settings(
                realtime_outbox_dispatch_mode="shadow",
                realtime_outbox_recording_enabled=True,
            ),
        ).execute(rider, chosen.id)

        ride_row = await session.get(RideRequestModel, accepted_ride.id)
        offer_rows = (
            await session.execute(
                select(OfferModel).where(
                    OfferModel.id.in_([chosen.id, loser_offer.id, other_offer.id])
                )
            )
        ).scalars().all()
        outbox_rows = (
            await session.execute(
                select(RealtimeOutboxModel).order_by(RealtimeOutboxModel.sequence)
            )
        ).scalars().all()
        aggregate_versions = await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        )
        stream_versions = await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        )

    assert ride_row is not None
    assert ride_row.status is RideStatus.ACCEPTED
    assert ride_row.driver_id == winner.id
    assert ride_row.accepted_offer_id == chosen.id
    statuses = {row.id: row.status for row in offer_rows}
    assert statuses == {
        chosen.id: OfferStatus.ACCEPTED,
        loser_offer.id: OfferStatus.REJECTED,
        other_offer.id: OfferStatus.REJECTED,
    }
    expected = events.build_accept_offer_events(result)
    assert [row.event_type for row in outbox_rows] == [event.event_type for event in expected]
    assert [row.topic for row in outbox_rows] == [event.topic for event in expected]
    assert [row.payload for row in outbox_rows] == [event.payload for event in expected]
    assert [row.aggregate_version for row in outbox_rows] == [1, 2, 3, 1, 1, 4]
    assert [row.stream_version for row in outbox_rows] == [1, 1, 1, 2, 1, 1]
    assert aggregate_versions == 3
    assert stream_versions == 5
    assert result.withdrawn_ride_ids == [other_ride.id]
    assert result.losing_driver_ids == [loser.id]


async def test_failure_after_outbox_flush_rolls_back_acceptance_and_versions(
    session_factory,
) -> None:
    async with session_factory() as session:
        (
            rides,
            rider,
            _,
            _,
            accepted_ride,
            _,
            chosen,
            loser_offer,
            other_offer,
        ) = await _sqlalchemy_scenario(session)
        recorder = OutboxAcceptOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))

        class RecordThenFail:
            async def record(self, result):
                await recorder.record(result)
                raise RuntimeError("fallo después de insertar la outbox")

        use_case = AcceptOffer(
            rides,
            SqlAlchemyOfferRepository(session, commit_accept=False),
            SqlAlchemyUnitOfWork(session),
            RecordThenFail(),  # type: ignore[arg-type]
        )

        with pytest.raises(RuntimeError, match="después de insertar"):
            await use_case.execute(rider, chosen.id)

        ride_row = await session.get(RideRequestModel, accepted_ride.id)
        offer_rows = (
            await session.execute(
                select(OfferModel).where(
                    OfferModel.id.in_([chosen.id, loser_offer.id, other_offer.id])
                )
            )
        ).scalars().all()
        event_count = await session.scalar(select(func.count(RealtimeOutboxModel.id)))
        aggregate_count = await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        )
        stream_count = await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        )

    assert ride_row is not None
    assert ride_row.status is RideStatus.SEARCHING
    assert ride_row.driver_id is None
    assert ride_row.accepted_offer_id is None
    assert all(row.status is OfferStatus.PENDING for row in offer_rows)
    assert event_count == 0
    assert aggregate_count == 0
    assert stream_count == 0
