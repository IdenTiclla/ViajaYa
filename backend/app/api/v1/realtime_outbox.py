"""Adaptadores API que traducen resultados a publicaciones realtime durables."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.api.v1.events import build_create_offer_events
from app.api.v1.schemas.realtime import parse_negotiation_message
from app.application.dto import CreateOfferResult, RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    CreateOfferEventRecorder,
    RealtimeOutbox,
    RealtimeOutboxBatchValidator,
)

_POOL_TOPICS = frozenset({"pool:taxi", "pool:moto", "pool:delivery"})
_EVENT_TOPIC_PREFIXES = {
    "ride_created": frozenset({"pool"}),
    "ride_closed": frozenset({"pool"}),
    "ride_paused": frozenset({"driver"}),
    "offer_created": frozenset({"ride"}),
    "offer_rejected": frozenset({"driver"}),
    "offer_withdrawn": frozenset({"ride"}),
    "offer_accepted": frozenset({"driver"}),
    "offers_withdrawn": frozenset({"driver"}),
    "offer_expired": frozenset({"ride", "driver"}),
    "ride_status": frozenset({"ride", "driver"}),
}
_RIDE_ID_FIELD_BY_EVENT = {
    "ride_created": "id",
    "ride_closed": "ride_id",
    "ride_paused": "id",
    "offer_created": "ride_id",
    "offer_rejected": "ride_id",
    "offer_accepted": "id",
    "offer_expired": "ride_id",
    "ride_status": "id",
}


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


def _invalid_batch(reason: str) -> InvalidRealtimeOutboxBatchError:
    return InvalidRealtimeOutboxBatchError(f"Lote realtime inválido: {reason}.")


def _topic_prefix(topic: str) -> str:
    return topic.partition(":")[0]


def _topic_uuid(topic: str) -> uuid.UUID | None:
    prefix, _, raw_id = topic.partition(":")
    if prefix not in {"ride", "driver"}:
        return None
    return uuid.UUID(raw_id)


def validate_realtime_outbox_batch(events: Sequence[RealtimeOutboxEvent]) -> None:
    """Valida un lote reclamado sin exponer su payload en los errores."""
    if not events:
        raise _invalid_batch("está vacío")

    batch_ids = {event.batch_id for event in events}
    if len(batch_ids) != 1:
        raise _invalid_batch("contiene más de un batch_id")

    expected_sequences = list(range(len(events)))
    sequences = [event.sequence for event in events]
    if sequences != expected_sequences:
        raise _invalid_batch("la secuencia no es contigua desde cero")

    event_ids = [event.id for event in events]
    if len(set(event_ids)) != len(event_ids):
        raise _invalid_batch("contiene event_id duplicado")

    for event in events:
        if event.aggregate_version < 1:
            raise _invalid_batch("contiene aggregate_version no positiva")
        if not _has_allowed_topic(event.topic):
            raise _invalid_batch("contiene un topic no permitido")

        payload_type = event.payload.get("type")
        if event.event_type != payload_type:
            raise _invalid_batch("event_type no coincide con payload.type")
        try:
            message = parse_negotiation_message(event.payload)
        except (TypeError, ValueError):
            raise _invalid_batch("contiene un payload fuera del contrato") from None

        topic_prefix = _topic_prefix(event.topic)
        if topic_prefix not in _EVENT_TOPIC_PREFIXES.get(event.event_type, frozenset()):
            raise _invalid_batch("event_type no admite el topic indicado")

        expected_aggregate_type = (
            "driver" if event.event_type == "offers_withdrawn" else "ride"
        )
        if event.aggregate_type != expected_aggregate_type:
            raise _invalid_batch("aggregate_type no coincide con event_type")

        topic_id = _topic_uuid(event.topic)
        if topic_prefix == event.aggregate_type and topic_id != event.aggregate_id:
            raise _invalid_batch("el topic no coincide con aggregate_id")

        ride_id_field = _RIDE_ID_FIELD_BY_EVENT.get(event.event_type)
        if event.aggregate_type == "ride" and ride_id_field is not None:
            ride_id = getattr(message.data, ride_id_field)
            if ride_id != event.aggregate_id:
                raise _invalid_batch("el payload no coincide con aggregate_id")

        if event.event_type == "ride_created":
            expected_pool = f"pool:{message.data.service_type.value}"
            if event.topic != expected_pool:
                raise _invalid_batch("el servicio del payload no coincide con el pool")


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
