"""Tests of the canonical realtime batch validator."""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    LocalHubRealtimeOutboxBatchPublisher,
    serialize_realtime_outbox_batch_v2,
    validate_realtime_outbox_batch,
)
from app.application.dto import RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.infrastructure.realtime import hub as realtime_hub_module


def _event(
    *,
    batch_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    sequence: int = 0,
    batch_size: int = 1,
    topic: str | None = None,
    aggregate_version: int = 1,
    stream_version: int = 1,
    event_type: str = "ride_closed",
    payload: dict[str, object] | None = None,
) -> RealtimeOutboxEvent:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC)
    return RealtimeOutboxEvent(
        id=event_id or uuid.uuid4(),
        batch_id=batch_id or uuid.uuid4(),
        correlation_id=uuid.uuid4(),
        sequence=sequence,
        batch_size=batch_size,
        event_type=event_type,
        topic=topic or "pool:taxi",
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=aggregate_version,
        stream_version=stream_version,
        payload=payload
        or {
            "type": "ride_closed",
            "data": {
                "ride_id": str(ride_id),
                "pool_version": 1,
                "reason": "terminal",
            },
        },
        created_at=now,
        next_attempt_at=now,
        published_at=None,
        attempts=1,
        last_error=None,
    )


def test_accepts_a_canonical_batch() -> None:
    validate_realtime_outbox_batch([_event()])


def test_canonical_validator_implements_the_application_port() -> None:
    CanonicalRealtimeOutboxBatchValidator().validate([_event()])


def test_validator_accepts_historical_ride_closed_without_generation() -> None:
    event = _event()
    legacy = replace(
        event,
        payload={
            "type": "ride_closed",
            "data": {"ride_id": str(event.aggregate_id)},
        },
    )

    validate_realtime_outbox_batch([legacy])


def test_historical_offers_withdrawn_is_valid_but_v2_requires_exact_offers() -> None:
    driver_id = uuid.uuid4()
    ride_id = uuid.uuid4()
    offer_id = uuid.uuid4()
    base = replace(
        _event(),
        event_type="offers_withdrawn",
        topic=f"driver:{driver_id}",
        aggregate_type="driver",
        aggregate_id=driver_id,
        payload={
            "type": "offers_withdrawn",
            "data": {"ride_ids": [str(ride_id)]},
        },
    )

    validate_realtime_outbox_batch([base])
    with pytest.raises(ValueError, match="requiere offers"):
        serialize_realtime_outbox_batch_v2([base])

    exact = replace(
        base,
        payload={
            "type": "offers_withdrawn",
            "data": {
                "ride_ids": [str(ride_id)],
                "offers": [
                    {
                        "ride_id": str(ride_id),
                        "offer_id": str(offer_id),
                    }
                ],
            },
        },
    )

    envelope = serialize_realtime_outbox_batch_v2([exact])[0]
    assert envelope["data"] == exact.payload["data"]


def test_rejects_an_empty_batch() -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="vacío") as error:
        validate_realtime_outbox_batch([])

    assert error.value.code == "empty_batch"


def test_rejects_more_than_one_batch_id() -> None:
    events = [_event(sequence=0), _event(sequence=1)]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="batch_id"):
        validate_realtime_outbox_batch(events)


def test_rejects_inconsistent_durable_cardinality() -> None:
    batch_id = uuid.uuid4()
    events = [
        _event(batch_id=batch_id, sequence=0, batch_size=3),
        _event(batch_id=batch_id, sequence=1, batch_size=3),
    ]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="cardinalidad") as error:
        validate_realtime_outbox_batch(events)

    assert error.value.code == "invalid_sequence"


@pytest.mark.parametrize("sequences", [[1], [0, 2], [1, 0]])
def test_rejects_a_non_contiguous_sequence_from_zero(sequences: list[int]) -> None:
    batch_id = uuid.uuid4()
    events = [
        _event(batch_id=batch_id, sequence=sequence, batch_size=len(sequences))
        for sequence in sequences
    ]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="secuencia"):
        validate_realtime_outbox_batch(events)


def test_rejects_a_duplicate_event_id() -> None:
    batch_id = uuid.uuid4()
    event_id = uuid.uuid4()
    events = [
        _event(batch_id=batch_id, event_id=event_id, sequence=0, batch_size=2),
        _event(batch_id=batch_id, event_id=event_id, sequence=1, batch_size=2),
    ]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="event_id duplicado"):
        validate_realtime_outbox_batch(events)


@pytest.mark.parametrize("aggregate_version", [0, -1, 2**53])
def test_rejects_a_non_positive_aggregate_version(aggregate_version: int) -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="aggregate_version"):
        validate_realtime_outbox_batch([_event(aggregate_version=aggregate_version)])


@pytest.mark.parametrize("stream_version", [0, -1, 2**53])
def test_rejects_a_non_positive_stream_version(stream_version: int) -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="stream_version"):
        validate_realtime_outbox_batch([_event(stream_version=stream_version)])


def test_rejects_non_contiguous_versions_of_the_same_stream_in_a_batch() -> None:
    batch_id = uuid.uuid4()
    events = [
        _event(batch_id=batch_id, sequence=0, batch_size=2, stream_version=4),
        _event(batch_id=batch_id, sequence=1, batch_size=2, stream_version=6),
    ]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="stream.*contigua"):
        validate_realtime_outbox_batch(events)


@pytest.mark.parametrize(
    "topic",
    [
        "pool:bicicleta",
        "ride:not-a-uuid",
        "driver:",
        f"otro:{uuid.uuid4()}",
        f"ride:{uuid.uuid4()}:extra",
    ],
)
def test_rejects_a_topic_outside_the_allowed_space(topic: str) -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="topic no permitido"):
        validate_realtime_outbox_batch([_event(topic=topic)])


def test_rejects_a_mismatch_between_event_type_and_payload_type() -> None:
    event = _event()

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="payload.type") as error:
        validate_realtime_outbox_batch([replace(event, event_type="offer_expired")])

    assert error.value.code == "event_type_mismatch"


def test_rejects_a_payload_outside_the_contract_without_leaking_it() -> None:
    private_value = "DATO_PRIVADO_NO_DEBE_APARECER"
    event = _event(
        payload={
            "type": "ride_closed",
            "data": {"ride_id": private_value},
        }
    )

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="fuera del contrato") as error:
        validate_realtime_outbox_batch([event])

    assert error.value.code == "invalid_payload"
    assert private_value not in str(error.value)


def test_rejects_a_topic_not_allowed_by_the_event_type() -> None:
    event = _event(topic=f"ride:{uuid.uuid4()}")

    with pytest.raises(
        InvalidRealtimeOutboxBatchError,
        match="no admite el stream",
    ) as error:
        validate_realtime_outbox_batch([event])

    assert error.value.code == "invalid_routing"


def test_rejects_a_topic_that_does_not_match_the_aggregate() -> None:
    driver_id = uuid.uuid4()
    event = _event(
        topic=f"ride:{uuid.uuid4()}",
        event_type="offer_withdrawn",
        payload={
            "type": "offer_withdrawn",
            "data": {"driver_id": str(driver_id)},
        },
    )

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="stream.*aggregate_id"):
        validate_realtime_outbox_batch([event])


def test_rejects_a_payload_that_does_not_match_the_aggregate() -> None:
    event = _event(
        payload={
            "type": "ride_closed",
            "data": {
                "ride_id": str(uuid.uuid4()),
                "pool_version": 1,
                "reason": "terminal",
            },
        }
    )

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="payload.*aggregate_id"):
        validate_realtime_outbox_batch([event])


def test_rejects_a_pool_that_does_not_match_the_service() -> None:
    ride_id = uuid.uuid4()
    event = _event(
        topic="pool:moto",
        event_type="ride_created",
        payload={
            "type": "ride_created",
            "data": {
                "id": str(ride_id),
                "service_type": "taxi",
                "fare": "25.00",
                "payment_method": "cash",
                "origin": {
                    "latitude": -16.5,
                    "longitude": -68.13,
                    "name": "Origen",
                    "address": "Origen 123",
                    "country_code": "BO",
                },
                "destination": {
                    "latitude": -16.51,
                    "longitude": -68.14,
                    "name": "Destino",
                    "address": "Destino 123",
                    "country_code": "BO",
                },
                "rider": {
                    "id": str(uuid.uuid4()),
                    "full_name": "Pasajero",
                    "rating": 4.5,
                    "trips_completed": 3,
                },
                "pool_version": 1,
                "created_at": None,
            },
        },
    )
    event = replace(event, aggregate_id=ride_id)

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="servicio.*pool"):
        validate_realtime_outbox_batch([event])


def test_serializes_a_single_outbox_batch_to_a_v2_envelope() -> None:
    event = _event(stream_version=9)

    envelope = serialize_realtime_outbox_batch_v2([event])[0]

    assert envelope == {
        "schema_version": 2,
        "kind": "event",
        "event_id": str(event.id),
        "batch_id": str(event.batch_id),
        "correlation_id": str(event.correlation_id),
        "sequence": 0,
        "aggregate_type": "ride",
        "aggregate_id": str(event.aggregate_id),
        "aggregate_version": 1,
        "stream": event.topic,
        "stream_version": 9,
        "occurred_at": event.created_at.isoformat().replace("+00:00", "Z"),
        "type": "ride_closed",
        "data": {
            "ride_id": str(event.aggregate_id),
            "pool_version": 1,
            "reason": "terminal",
        },
    }


def test_serializes_a_canonical_batch_preserving_sequence_and_stream() -> None:
    batch_id = uuid.uuid4()
    events = [
        _event(batch_id=batch_id, sequence=0, batch_size=2, stream_version=20),
        _event(batch_id=batch_id, sequence=1, batch_size=2, stream_version=21),
    ]

    envelopes = serialize_realtime_outbox_batch_v2(events)

    assert [envelope["sequence"] for envelope in envelopes] == [0, 1]
    assert [envelope["stream_version"] for envelope in envelopes] == [20, 21]
    assert all(envelope["stream"] == "pool:taxi" for envelope in envelopes)


def test_v2_serializer_rejects_a_non_canonical_batch() -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="secuencia"):
        serialize_realtime_outbox_batch_v2([_event(sequence=1)])


async def test_local_publisher_pre_serializes_everything_before_the_first_send(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = _event(batch_size=2)
    invalid_second = replace(
        first,
        id=uuid.uuid4(),
        sequence=1,
        aggregate_version=2,
        stream_version=2,
        payload={
            "type": "ride_closed",
            "data": {"ride_id": str(first.aggregate_id)},
        },
    )
    broadcast = AsyncMock()
    monkeypatch.setattr(realtime_hub_module.hub, "broadcast_versioned", broadcast)

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="contrato v2"):
        await LocalHubRealtimeOutboxBatchPublisher().publish(
            [first, invalid_second]
        )

    broadcast.assert_not_awaited()


async def test_local_publisher_sends_in_order_and_delegates_resync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = _event(batch_size=2)
    second = replace(
        first,
        id=uuid.uuid4(),
        sequence=1,
        aggregate_version=2,
        stream_version=2,
    )
    broadcast = AsyncMock()
    force_resync = AsyncMock()
    monkeypatch.setattr(realtime_hub_module.hub, "broadcast_versioned", broadcast)
    monkeypatch.setattr(realtime_hub_module.hub, "force_resync", force_resync)
    publisher = LocalHubRealtimeOutboxBatchPublisher()

    await publisher.publish([first, second])
    await publisher.force_resync([first.topic])

    assert [call.args[0] for call in broadcast.await_args_list] == [
        first.topic,
        second.topic,
    ]
    assert [call.args[1]["event_id"] for call in broadcast.await_args_list] == [
        str(first.id),
        str(second.id),
    ]
    force_resync.assert_awaited_once_with([first.topic])
