"""Adaptadores API que traducen resultados a publicaciones realtime durables."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.api.v1.events import (
    build_accept_offer_events,
    build_announce_open_ride_events,
    build_cancel_ride_events,
    build_create_offer_events,
    build_driver_availability_events,
    build_expire_offer_events,
    build_pause_ride_events,
    build_reject_offer_events,
    build_republish_ride_events,
    build_update_ride_status_events,
    build_withdraw_offer_events,
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
    DriverAvailabilityResult,
    RealtimeOutboxEvent,
    RealtimeOutboxQuarantineCode,
    RideDetail,
    RidePausedResult,
    RideRepublishedResult,
)
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    AcceptOfferEventRecorder,
    AnnounceOpenRideEventRecorder,
    CancelRideEventRecorder,
    CreateOfferEventRecorder,
    DriverAvailabilityEventRecorder,
    ExpireOfferEventRecorder,
    PauseRideEventRecorder,
    RealtimeOutbox,
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
    RejectOfferEventRecorder,
    RepublishRideEventRecorder,
    UpdateRideStatusEventRecorder,
    WithdrawOfferEventRecorder,
)
from app.domain.entities import Offer
from app.domain.repositories import OpenRideDetail
from app.infrastructure.realtime.hub import hub

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
        f"Invalid realtime batch: {reason}.",
    )


def validate_realtime_outbox_batch(events: Sequence[RealtimeOutboxEvent]) -> None:
    """Validate a claimed batch without exposing its payload in the errors."""
    if not events:
        raise _invalid_batch("empty_batch", "it is empty")

    batch_ids = {event.batch_id for event in events}
    if len(batch_ids) != 1:
        raise _invalid_batch("mixed_batch", "contains more than one batch_id")

    batch_sizes = {event.batch_size for event in events}
    if len(batch_sizes) != 1 or next(iter(batch_sizes)) != len(events):
        raise _invalid_batch(
            "invalid_sequence",
            "the durable cardinality does not match its members",
        )

    expected_sequences = list(range(len(events)))
    sequences = [event.sequence for event in events]
    if sequences != expected_sequences:
        raise _invalid_batch(
            "invalid_sequence",
            "the sequence is not contiguous from zero",
        )

    event_ids = [event.id for event in events]
    if len(set(event_ids)) != len(event_ids):
        raise _invalid_batch("duplicate_event_id", "contiene event_id duplicado")

    last_stream_version: dict[str, int] = {}
    for event in events:
        if not 1 <= event.aggregate_version <= _MAX_SAFE_JSON_INTEGER:
            raise _invalid_batch(
                "unsafe_version",
                "contains aggregate_version outside the safe JSON range",
            )
        if not 1 <= event.stream_version <= _MAX_SAFE_JSON_INTEGER:
            raise _invalid_batch(
                "unsafe_version",
                "contains stream_version outside the safe JSON range",
            )
        if not _has_allowed_topic(event.topic):
            raise _invalid_batch("invalid_topic", "contains a topic that is not allowed")

        previous_stream_version = last_stream_version.get(event.topic)
        if (
            previous_stream_version is not None
            and event.stream_version != previous_stream_version + 1
        ):
            raise _invalid_batch(
                "stream_gap",
                "the stream sequence is not contiguous in the batch",
            )
        last_stream_version[event.topic] = event.stream_version

        payload_type = event.payload.get("type")
        if event.event_type != payload_type:
            raise _invalid_batch(
                "event_type_mismatch",
                "event_type does not match payload.type",
            )
        try:
            message = parse_negotiation_message(event.payload)
        except (TypeError, ValueError):
            raise _invalid_batch(
                "invalid_payload",
                "contains a payload outside the contract",
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
            # The reason only contains field/rule names, never the payload.
            raise _invalid_batch("invalid_routing", str(error)) from None


def _serialize_realtime_outbox_event_v2(
    event: RealtimeOutboxEvent,
) -> dict[str, object]:
    payload_data = event.payload.get("data")
    if not isinstance(payload_data, dict):
        raise _invalid_batch("invalid_payload", "payload.data is not an object")

    envelope = RealtimeEventEnvelopeV2(
        schema_version=2,
        kind="event",
        event_id=event.id,
        batch_id=event.batch_id,
        correlation_id=event.correlation_id,
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
    """Validate a canonical batch and translate it into JSON-ready v2 envelopes."""
    validate_realtime_outbox_batch(events)
    return [_serialize_realtime_outbox_event_v2(event) for event in events]


class LocalHubRealtimeOutboxBatchPublisher(RealtimeOutboxBatchPublisher):
    """Deliver v2 envelopes to the hub of the single active API process.

    It first serializes the whole batch so that a deterministic error never
    produces a partial delivery. Failures of an individual socket are absorbed by
    the hub; an operational transport failure is propagated to apply backoff.
    """

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        try:
            envelopes = serialize_realtime_outbox_batch_v2(events)
        except InvalidRealtimeOutboxBatchError:
            raise
        except (TypeError, ValueError) as error:
            raise _invalid_batch(
                "invalid_payload",
                "does not meet the v2 contract",
            ) from error

        for event, envelope in zip(events, envelopes, strict=True):
            await hub.broadcast_versioned(event.topic, envelope)

    async def force_resync(self, streams: Sequence[str]) -> None:
        await hub.force_resync(streams)


class CanonicalRealtimeOutboxBatchValidator(RealtimeOutboxBatchValidator):
    """Adapter that applies the canonical contract to every claimed batch."""

    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        validate_realtime_outbox_batch(events)


class OutboxCreateOfferEventRecorder(CreateOfferEventRecorder):
    """Record the CreateOffer batch in the same transaction as the offer."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: CreateOfferResult) -> None:
        await self._outbox.add_batch(build_create_offer_events(result))


class DisabledCreateOfferEventRecorder(CreateOfferEventRecorder):
    """Null recorder while the outbox producer is disabled."""

    async def record(self, result: CreateOfferResult) -> None:
        del result


class OutboxAcceptOfferEventRecorder(AcceptOfferEventRecorder):
    """Record the acceptance fan-out inside its business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: AcceptOfferResult) -> None:
        await self._outbox.add_batch(build_accept_offer_events(result))


class DisabledAcceptOfferEventRecorder(AcceptOfferEventRecorder):
    """Null recorder while the acceptance producer is disabled."""

    async def record(self, result: AcceptOfferResult) -> None:
        del result


class OutboxPauseRideEventRecorder(PauseRideEventRecorder):
    """Record the pause fan-out inside the business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: RidePausedResult) -> None:
        await self._outbox.add_batch(build_pause_ride_events(result))


class DisabledPauseRideEventRecorder(PauseRideEventRecorder):
    """Null recorder while the pause producer is disabled."""

    async def record(self, result: RidePausedResult) -> None:
        del result


class OutboxCancelRideEventRecorder(CancelRideEventRecorder):
    """Record the cancellation fan-out inside its business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: CancelRideResult) -> None:
        await self._outbox.add_batch(build_cancel_ride_events(result))


class DisabledCancelRideEventRecorder(CancelRideEventRecorder):
    """Null recorder while the cancellation producer is disabled."""

    async def record(self, result: CancelRideResult) -> None:
        del result


class OutboxRepublishRideEventRecorder(RepublishRideEventRecorder):
    """Record a pool renewal inside its business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: RideRepublishedResult) -> None:
        await self._outbox.add_batch(build_republish_ride_events(result))


class DisabledRepublishRideEventRecorder(RepublishRideEventRecorder):
    """Null recorder while the durable renewal is disabled."""

    async def record(self, result: RideRepublishedResult) -> None:
        del result


class OutboxAnnounceOpenRideEventRecorder(AnnounceOpenRideEventRecorder):
    """Record the presence announcement inside its read transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, detail: OpenRideDetail) -> None:
        await self._outbox.add_batch(build_announce_open_ride_events(detail))


class DisabledAnnounceOpenRideEventRecorder(AnnounceOpenRideEventRecorder):
    """Null recorder while the durable announcement is disabled."""

    async def record(self, detail: OpenRideDetail) -> None:
        del detail


class OutboxWithdrawOfferEventRecorder(WithdrawOfferEventRecorder):
    """Record the voluntary withdrawal inside its business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, offer: Offer) -> None:
        await self._outbox.add_batch(build_withdraw_offer_events(offer))


class DisabledWithdrawOfferEventRecorder(WithdrawOfferEventRecorder):
    """Null recorder while the durable withdrawal is disabled."""

    async def record(self, offer: Offer) -> None:
        del offer


class OutboxRejectOfferEventRecorder(RejectOfferEventRecorder):
    """Record the explicit rejection inside its business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, offer: Offer) -> None:
        await self._outbox.add_batch(build_reject_offer_events(offer))


class DisabledRejectOfferEventRecorder(RejectOfferEventRecorder):
    """Null recorder while the durable rejection is disabled."""

    async def record(self, offer: Offer) -> None:
        del offer


class OutboxExpireOfferEventRecorder(ExpireOfferEventRecorder):
    """Record the expiry inside its business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, offer: Offer) -> None:
        await self._outbox.add_batch(build_expire_offer_events(offer))


class DisabledExpireOfferEventRecorder(ExpireOfferEventRecorder):
    """Null recorder while the durable expiry is disabled."""

    async def record(self, offer: Offer) -> None:
        del offer


class OutboxUpdateRideStatusEventRecorder(UpdateRideStatusEventRecorder):
    """Record the ride's progress inside its business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, detail: RideDetail) -> None:
        await self._outbox.add_batch(build_update_ride_status_events(detail))


class DisabledUpdateRideStatusEventRecorder(UpdateRideStatusEventRecorder):
    """Null recorder while the durable progress is disabled."""

    async def record(self, detail: RideDetail) -> None:
        del detail


class OutboxDriverAvailabilityEventRecorder(DriverAvailabilityEventRecorder):
    """Record the offline withdrawals inside their business transaction."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: DriverAvailabilityResult) -> None:
        events = build_driver_availability_events(result)
        if events:
            await self._outbox.add_batch(events)


class DisabledDriverAvailabilityEventRecorder(DriverAvailabilityEventRecorder):
    """Null recorder while the durable availability is disabled."""

    async def record(self, result: DriverAvailabilityResult) -> None:
        del result
