"""Pruebas del validador canónico de batches realtime."""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    validate_realtime_outbox_batch,
)
from app.application.dto import RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError


def _event(
    *,
    batch_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    sequence: int = 0,
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
        sequence=sequence,
        event_type=event_type,
        topic=topic or "pool:taxi",
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=aggregate_version,
        stream_version=stream_version,
        payload=payload or {"type": "ride_closed", "data": {"ride_id": str(ride_id)}},
        created_at=now,
        next_attempt_at=now,
        published_at=None,
        attempts=1,
        last_error=None,
    )


def test_acepta_un_lote_canonico() -> None:
    validate_realtime_outbox_batch([_event()])


def test_validador_canonico_implementa_el_puerto_de_aplicacion() -> None:
    CanonicalRealtimeOutboxBatchValidator().validate([_event()])


def test_rechaza_un_lote_vacio() -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="vacío"):
        validate_realtime_outbox_batch([])


def test_rechaza_mas_de_un_batch_id() -> None:
    events = [_event(sequence=0), _event(sequence=1)]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="batch_id"):
        validate_realtime_outbox_batch(events)


@pytest.mark.parametrize("sequences", [[1], [0, 2], [1, 0]])
def test_rechaza_una_secuencia_no_contigua_desde_cero(sequences: list[int]) -> None:
    batch_id = uuid.uuid4()
    events = [_event(batch_id=batch_id, sequence=sequence) for sequence in sequences]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="secuencia"):
        validate_realtime_outbox_batch(events)


def test_rechaza_un_event_id_duplicado() -> None:
    batch_id = uuid.uuid4()
    event_id = uuid.uuid4()
    events = [
        _event(batch_id=batch_id, event_id=event_id, sequence=0),
        _event(batch_id=batch_id, event_id=event_id, sequence=1),
    ]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="event_id duplicado"):
        validate_realtime_outbox_batch(events)


@pytest.mark.parametrize("aggregate_version", [0, -1])
def test_rechaza_aggregate_version_no_positiva(aggregate_version: int) -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="aggregate_version"):
        validate_realtime_outbox_batch([_event(aggregate_version=aggregate_version)])


@pytest.mark.parametrize("stream_version", [0, -1])
def test_rechaza_stream_version_no_positiva(stream_version: int) -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="stream_version"):
        validate_realtime_outbox_batch([_event(stream_version=stream_version)])


def test_rechaza_versiones_no_contiguas_del_mismo_stream_en_un_lote() -> None:
    batch_id = uuid.uuid4()
    events = [
        _event(batch_id=batch_id, sequence=0, stream_version=4),
        _event(batch_id=batch_id, sequence=1, stream_version=6),
    ]

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="stream.*contigua"):
        validate_realtime_outbox_batch(events)


@pytest.mark.parametrize(
    "topic",
    [
        "pool:bicicleta",
        "ride:no-es-uuid",
        "driver:",
        f"otro:{uuid.uuid4()}",
        f"ride:{uuid.uuid4()}:extra",
    ],
)
def test_rechaza_un_topic_fuera_del_espacio_permitido(topic: str) -> None:
    with pytest.raises(InvalidRealtimeOutboxBatchError, match="topic no permitido"):
        validate_realtime_outbox_batch([_event(topic=topic)])


def test_rechaza_discrepancia_entre_event_type_y_payload_type() -> None:
    event = _event()

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="payload.type"):
        validate_realtime_outbox_batch([replace(event, event_type="offer_expired")])


def test_rechaza_payload_fuera_del_contrato_sin_filtrarlo() -> None:
    private_value = "DATO_PRIVADO_NO_DEBE_APARECER"
    event = _event(
        payload={
            "type": "ride_closed",
            "data": {"ride_id": private_value},
        }
    )

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="fuera del contrato") as error:
        validate_realtime_outbox_batch([event])

    assert private_value not in str(error.value)


def test_rechaza_un_topic_no_admitido_por_el_tipo_de_evento() -> None:
    event = _event(topic=f"ride:{uuid.uuid4()}")

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="no admite el topic"):
        validate_realtime_outbox_batch([event])


def test_rechaza_un_topic_que_no_coincide_con_el_agregado() -> None:
    driver_id = uuid.uuid4()
    event = _event(
        topic=f"ride:{uuid.uuid4()}",
        event_type="offer_withdrawn",
        payload={
            "type": "offer_withdrawn",
            "data": {"driver_id": str(driver_id)},
        },
    )

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="topic.*aggregate_id"):
        validate_realtime_outbox_batch([event])


def test_rechaza_un_payload_que_no_coincide_con_el_agregado() -> None:
    event = _event(
        payload={
            "type": "ride_closed",
            "data": {"ride_id": str(uuid.uuid4())},
        }
    )

    with pytest.raises(InvalidRealtimeOutboxBatchError, match="payload.*aggregate_id"):
        validate_realtime_outbox_batch([event])


def test_rechaza_un_pool_que_no_coincide_con_el_servicio() -> None:
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
