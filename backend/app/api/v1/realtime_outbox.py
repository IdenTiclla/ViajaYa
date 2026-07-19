"""Adaptadores API que traducen resultados a publicaciones realtime durables."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.api.v1.events import (
    build_accept_offer_events,
    build_cancel_ride_events,
    build_create_offer_events,
    build_pause_ride_events,
    build_republish_ride_events,
)
from app.api.v1.schemas.realtime import (
    RealtimeEventEnvelopeV2,
    parse_negotiation_message,
    validate_realtime_event_semantics,
)
from app.application.dto import (
    AcceptOfferResult,
    CancelRideResult,
    CreateOfferResult,
    RealtimeOutboxEvent,
    RealtimeOutboxQuarantineCode,
    RidePausedResult,
    RideRepublishedResult,
)
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    AcceptOfferEventRecorder,
    CancelRideEventRecorder,
    CreateOfferEventRecorder,
    PauseRideEventRecorder,
    RealtimeOutbox,
    RealtimeOutboxBatchValidator,
    RepublishRideEventRecorder,
)

_POOL_TOPICS = frozenset({"pool:taxi", "pool:moto", "pool:delivery"})
_MAX_SAFE_JSON_INTEGER = 2**53 - 1


def _has_allowed_topic(topic: str) -> bool:
    if topic in _POOL_TOPICS:
        return True

    prefix, separator, raw_id = topic.partition(":")
    if separator != ":" or prefix not in {"ride", "driver"}:
        return False
    try:
        topic_id = uuid.UUID(raw_id)
    except (ValueError, AttributeError):
        return False
    return raw_id.lower() == str(topic_id)


def _invalid_batch(
    code: RealtimeOutboxQuarantineCode,
    reason: str,
) -> InvalidRealtimeOutboxBatchError:
    return InvalidRealtimeOutboxBatchError(
        code,
        f"Lote realtime inválido: {reason}.",
    )


def validate_realtime_outbox_batch(events: Sequence[RealtimeOutboxEvent]) -> None:
    """Valida un lote reclamado sin exponer su payload en los errores."""
    if not events:
        raise _invalid_batch("empty_batch", "está vacío")

    batch_ids = {event.batch_id for event in events}
    if len(batch_ids) != 1:
        raise _invalid_batch("mixed_batch", "contiene más de un batch_id")

    expected_sequences = list(range(len(events)))
    sequences = [event.sequence for event in events]
    if sequences != expected_sequences:
        raise _invalid_batch(
            "invalid_sequence",
            "la secuencia no es contigua desde cero",
        )

    event_ids = [event.id for event in events]
    if len(set(event_ids)) != len(event_ids):
        raise _invalid_batch("duplicate_event_id", "contiene event_id duplicado")

    last_stream_version: dict[str, int] = {}
    for event in events:
        if not 1 <= event.aggregate_version <= _MAX_SAFE_JSON_INTEGER:
            raise _invalid_batch(
                "unsafe_version",
                "contiene aggregate_version fuera del rango JSON seguro",
            )
        if not 1 <= event.stream_version <= _MAX_SAFE_JSON_INTEGER:
            raise _invalid_batch(
                "unsafe_version",
                "contiene stream_version fuera del rango JSON seguro",
            )
        if not _has_allowed_topic(event.topic):
            raise _invalid_batch("invalid_topic", "contiene un topic no permitido")

        previous_stream_version = last_stream_version.get(event.topic)
        if (
            previous_stream_version is not None
            and event.stream_version != previous_stream_version + 1
        ):
            raise _invalid_batch(
                "stream_gap",
                "la secuencia del stream no es contigua en el lote",
            )
        last_stream_version[event.topic] = event.stream_version

        payload_type = event.payload.get("type")
        if event.event_type != payload_type:
            raise _invalid_batch(
                "event_type_mismatch",
                "event_type no coincide con payload.type",
            )
        try:
            message = parse_negotiation_message(event.payload)
        except (TypeError, ValueError):
            raise _invalid_batch(
                "invalid_payload",
                "contiene un payload fuera del contrato",
            ) from None
        try:
            validate_realtime_event_semantics(
                event_type=event.event_type,
                stream=event.topic,
                aggregate_type=event.aggregate_type,
                aggregate_id=event.aggregate_id,
                message=message,
            )
        except ValueError as error:
            # La razón solo contiene nombres de campos/reglas, nunca el payload.
            raise _invalid_batch("invalid_routing", str(error)) from None


def _serialize_realtime_outbox_event_v2(
    event: RealtimeOutboxEvent,
) -> dict[str, object]:
    payload_data = event.payload.get("data")
    if not isinstance(payload_data, dict):
        raise _invalid_batch("invalid_payload", "payload.data no es un objeto")

    envelope = RealtimeEventEnvelopeV2(
        schema_version=2,
        kind="event",
        event_id=event.id,
        batch_id=event.batch_id,
        sequence=event.sequence,
        aggregate_type=event.aggregate_type,
        aggregate_id=event.aggregate_id,
        aggregate_version=event.aggregate_version,
        stream=event.topic,
        stream_version=event.stream_version,
        occurred_at=event.created_at,
        type=event.event_type,
        data=payload_data,
    )
    return envelope.model_dump(mode="json")


def serialize_realtime_outbox_batch_v2(
    events: Sequence[RealtimeOutboxEvent],
) -> list[dict[str, object]]:
    """Valida un lote canónico y lo traduce a envelopes v2 listos para JSON."""
    validate_realtime_outbox_batch(events)
    return [_serialize_realtime_outbox_event_v2(event) for event in events]


class CanonicalRealtimeOutboxBatchValidator(RealtimeOutboxBatchValidator):
    """Adaptador que aplica el contrato canónico a cada lote reclamado."""

    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        validate_realtime_outbox_batch(events)


class OutboxCreateOfferEventRecorder(CreateOfferEventRecorder):
    """Registra el batch de CreateOffer en la misma transacción que la oferta."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: CreateOfferResult) -> None:
        await self._outbox.add_batch(build_create_offer_events(result))


class DisabledCreateOfferEventRecorder(CreateOfferEventRecorder):
    """Recorder nulo mientras el productor de outbox está deshabilitado."""

    async def record(self, result: CreateOfferResult) -> None:
        del result


class OutboxAcceptOfferEventRecorder(AcceptOfferEventRecorder):
    """Registra el fanout de aceptación dentro de su transacción de negocio."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: AcceptOfferResult) -> None:
        await self._outbox.add_batch(build_accept_offer_events(result))


class DisabledAcceptOfferEventRecorder(AcceptOfferEventRecorder):
    """Recorder nulo mientras el productor de aceptación está deshabilitado."""

    async def record(self, result: AcceptOfferResult) -> None:
        del result


class OutboxPauseRideEventRecorder(PauseRideEventRecorder):
    """Registra el fanout de pausa dentro de la transacción de negocio."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: RidePausedResult) -> None:
        await self._outbox.add_batch(build_pause_ride_events(result))


class DisabledPauseRideEventRecorder(PauseRideEventRecorder):
    """Recorder nulo mientras el productor de pausa está deshabilitado."""

    async def record(self, result: RidePausedResult) -> None:
        del result


class OutboxCancelRideEventRecorder(CancelRideEventRecorder):
    """Registra el fanout de cancelación dentro de su transacción de negocio."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: CancelRideResult) -> None:
        await self._outbox.add_batch(build_cancel_ride_events(result))


class DisabledCancelRideEventRecorder(CancelRideEventRecorder):
    """Recorder nulo mientras el productor de cancelación está deshabilitado."""

    async def record(self, result: CancelRideResult) -> None:
        del result


class OutboxRepublishRideEventRecorder(RepublishRideEventRecorder):
    """Registra una renovación del pool dentro de su transacción de negocio."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: RideRepublishedResult) -> None:
        await self._outbox.add_batch(build_republish_ride_events(result))


class DisabledRepublishRideEventRecorder(RepublishRideEventRecorder):
    """Recorder nulo mientras la renovación durable está deshabilitada."""

    async def record(self, result: RideRepublishedResult) -> None:
        del result
