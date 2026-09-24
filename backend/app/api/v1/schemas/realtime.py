"""Validated contract of negotiation WebSocket messages."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal, TypeAlias

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.rides import OpenRidePageResponse, OpenRideResponse, RideResponse


class _StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


RideClosedReason: TypeAlias = Literal["paused", "terminal"]


class RideClosedData(_StrictPayload):
    ride_id: uuid.UUID
    # Optional only to read legacy frames and historical outbox rows.
    # Every current producer fills them and the v2 envelope requires them.
    pool_version: int | None = Field(default=None, strict=True, ge=1)
    reason: RideClosedReason | None = None

    @model_validator(mode="after")
    def validate_versioned_fields_together(self) -> RideClosedData:
        if (self.pool_version is None) != (self.reason is None):
            raise ValueError(
                "ride_closed requiere pool_version y reason juntos."
            )
        return self


class RidePausedData(OpenRideResponse):
    model_config = ConfigDict(extra="forbid")

    offer_id: uuid.UUID

    @classmethod
    def from_open_ride(cls, ride: OpenRideResponse, offer_id: uuid.UUID) -> RidePausedData:
        return cls(**ride.model_dump(), offer_id=offer_id)


OfferRejectedReason: TypeAlias = Literal[
    "declined",
    "ride_taken",
    "ride_cancelled",
]
OfferWithdrawnReason: TypeAlias = Literal["superseded", "driver_offline"]
OffersWithdrawnReason: TypeAlias = Literal["driver_offline"]


class OfferRejectedData(_StrictPayload):
    ride_id: uuid.UUID
    offer_id: uuid.UUID | None
    reason: OfferRejectedReason


class OfferWithdrawnData(_StrictPayload):
    driver_id: uuid.UUID
    offer_id: uuid.UUID | None = None
    reason: OfferWithdrawnReason | None = None


class WithdrawnOfferReferenceData(_StrictPayload):
    ride_id: uuid.UUID
    offer_id: uuid.UUID


class OffersWithdrawnData(_StrictPayload):
    ride_ids: list[uuid.UUID]
    # Optional only to read legacy frames and historical outbox rows. Current
    # producers fill it and the v2 envelope requires it.
    offers: list[WithdrawnOfferReferenceData] | None = None
    reason: OffersWithdrawnReason | None = None

    @model_validator(mode="after")
    def validate_legacy_summary_matches_offers(self) -> OffersWithdrawnData:
        if self.offers is not None and self.ride_ids != [
            offer.ride_id for offer in self.offers
        ]:
            raise ValueError(
                "ride_ids debe coincidir en orden con offers[*].ride_id."
            )
        return self


class OfferExpiredData(_StrictPayload):
    ride_id: uuid.UUID
    offer_id: uuid.UUID
    driver_id: uuid.UUID
    reason: Literal["expired"]


class _Message(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OffersSnapshotMessage(_Message):
    type: Literal["offers_snapshot"] = "offers_snapshot"
    data: list[OfferResponse]


class OpenRidesSnapshotMessage(_Message):
    type: Literal["open_rides_snapshot"] = "open_rides_snapshot"
    data: OpenRidePageResponse


class PausedRidesSnapshotMessage(_Message):
    type: Literal["paused_rides_snapshot"] = "paused_rides_snapshot"
    data: list[OpenRideResponse]


class DriverOffersSnapshotMessage(_Message):
    type: Literal["driver_offers_snapshot"] = "driver_offers_snapshot"
    data: list[OfferResponse]


class DriverActiveRideMessage(_Message):
    type: Literal["driver_active_ride"] = "driver_active_ride"
    data: RideResponse


class RideCreatedMessage(_Message):
    type: Literal["ride_created"] = "ride_created"
    data: OpenRideResponse


class RideClosedMessage(_Message):
    type: Literal["ride_closed"] = "ride_closed"
    data: RideClosedData


class RidePausedMessage(_Message):
    type: Literal["ride_paused"] = "ride_paused"
    data: RidePausedData


class OfferCreatedMessage(_Message):
    type: Literal["offer_created"] = "offer_created"
    data: OfferResponse


class OfferRejectedMessage(_Message):
    type: Literal["offer_rejected"] = "offer_rejected"
    data: OfferRejectedData


class OfferWithdrawnMessage(_Message):
    type: Literal["offer_withdrawn"] = "offer_withdrawn"
    data: OfferWithdrawnData


class OfferAcceptedMessage(_Message):
    type: Literal["offer_accepted"] = "offer_accepted"
    data: RideResponse


class OffersWithdrawnMessage(_Message):
    type: Literal["offers_withdrawn"] = "offers_withdrawn"
    data: OffersWithdrawnData


class OfferExpiredMessage(_Message):
    type: Literal["offer_expired"] = "offer_expired"
    data: OfferExpiredData


class RideStatusMessage(_Message):
    type: Literal["ride_status"] = "ride_status"
    data: RideResponse


NegotiationMessage: TypeAlias = Annotated[
    OffersSnapshotMessage
    | OpenRidesSnapshotMessage
    | PausedRidesSnapshotMessage
    | DriverOffersSnapshotMessage
    | DriverActiveRideMessage
    | RideCreatedMessage
    | RideClosedMessage
    | RidePausedMessage
    | OfferCreatedMessage
    | OfferRejectedMessage
    | OfferWithdrawnMessage
    | OfferAcceptedMessage
    | OffersWithdrawnMessage
    | OfferExpiredMessage
    | RideStatusMessage,
    Field(discriminator="type"),
]

negotiation_message_adapter = TypeAdapter(NegotiationMessage)


def parse_negotiation_message(value: object) -> NegotiationMessage:
    """Validate an external value against the protocol's discriminated union."""
    return negotiation_message_adapter.validate_python(value)


def dump_negotiation_message(message: NegotiationMessage) -> dict[str, object]:
    """Serialize an already typed message without adding absent optional fields."""
    validated = negotiation_message_adapter.validate_python(message)
    payload = validated.model_dump(mode="json", exclude_unset=True)
    # ``type`` has a Literal default so messages are ergonomic to build;
    # it is always set on output even though ``exclude_unset`` omits that default.
    payload["type"] = validated.type
    return payload


RealtimeEventType: TypeAlias = Literal[
    "ride_created",
    "ride_closed",
    "ride_paused",
    "offer_created",
    "offer_rejected",
    "offer_withdrawn",
    "offer_accepted",
    "offers_withdrawn",
    "offer_expired",
    "ride_status",
]


_POOL_STREAMS = frozenset({"pool:taxi", "pool:moto", "pool:delivery"})
_MAX_SAFE_JSON_INTEGER = 2**53 - 1
_EVENT_STREAM_PREFIXES = {
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


def _validate_canonical_stream(value: str) -> str:
    if value in _POOL_STREAMS:
        return value

    prefix, separator, raw_id = value.partition(":")
    if separator != ":" or prefix not in {"ride", "driver"}:
        raise ValueError("El stream realtime no es canónico.")
    try:
        stream_id = uuid.UUID(raw_id)
    except (ValueError, AttributeError) as error:
        raise ValueError("El stream realtime no es canónico.") from error
    if raw_id.lower() != str(stream_id):
        raise ValueError("El stream realtime no es canónico.")
    return value


def validate_realtime_event_semantics(
    *,
    event_type: RealtimeEventType,
    stream: str,
    aggregate_type: Literal["ride", "driver"],
    aggregate_id: uuid.UUID,
    message: NegotiationMessage,
) -> None:
    """Correlate routing and aggregate with the already validated payload."""
    stream_prefix, _, raw_stream_id = stream.partition(":")
    if stream_prefix not in _EVENT_STREAM_PREFIXES[event_type]:
        raise ValueError("event_type no admite el stream indicado")

    expected_aggregate_type = "driver" if event_type == "offers_withdrawn" else "ride"
    if aggregate_type != expected_aggregate_type:
        raise ValueError("aggregate_type no coincide con event_type")

    if stream_prefix == aggregate_type and uuid.UUID(raw_stream_id) != aggregate_id:
        raise ValueError("el stream no coincide con aggregate_id")

    ride_id_field = _RIDE_ID_FIELD_BY_EVENT.get(event_type)
    if aggregate_type == "ride" and ride_id_field is not None:
        if getattr(message.data, ride_id_field) != aggregate_id:
            raise ValueError("el payload no coincide con aggregate_id")

    if event_type == "ride_created":
        expected_pool = f"pool:{message.data.service_type.value}"
        if stream != expected_pool:
            raise ValueError("el servicio del payload no coincide con el pool")


class StreamWatermark(_Message):
    """Last position included in a snapshot for a given stream."""

    stream: str = Field(min_length=1, max_length=255)
    stream_version: int = Field(strict=True, ge=0, le=_MAX_SAFE_JSON_INTEGER)

    @field_validator("stream")
    @classmethod
    def validate_stream(cls, value: str) -> str:
        return _validate_canonical_stream(value)


def _validate_unique_watermarks(
    watermarks: list[StreamWatermark],
) -> None:
    streams = [watermark.stream for watermark in watermarks]
    if len(streams) != len(set(streams)):
        raise ValueError("Los watermarks no pueden repetir un stream.")


class _RealtimeEventEnvelopeV2Base(_Message):
    """v2 fields that stay stable before and after adding correlation."""

    schema_version: Literal[2]
    kind: Literal["event"]
    event_id: uuid.UUID
    batch_id: uuid.UUID
    sequence: int = Field(strict=True, ge=0, le=_MAX_SAFE_JSON_INTEGER)
    aggregate_type: Literal["ride", "driver"]
    aggregate_id: uuid.UUID
    aggregate_version: int = Field(strict=True, ge=1, le=_MAX_SAFE_JSON_INTEGER)
    stream: str = Field(min_length=1, max_length=255)
    stream_version: int = Field(strict=True, ge=1, le=_MAX_SAFE_JSON_INTEGER)
    occurred_at: AwareDatetime
    type: RealtimeEventType
    data: dict[str, object]

    @field_validator("stream")
    @classmethod
    def validate_stream(cls, value: str) -> str:
        return _validate_canonical_stream(value)

    @model_validator(mode="after")
    def validate_type_and_data(self) -> _RealtimeEventEnvelopeV2Base:
        """Keep the discriminator and its canonical payload correlated."""
        try:
            message = parse_negotiation_message({"type": self.type, "data": self.data})
        except (TypeError, ValueError) as error:
            raise ValueError("type y data no cumplen el contrato de negociación.") from error

        if self.type == "ride_closed" and (
            message.data.pool_version is None or message.data.reason is None
        ):
            raise ValueError(
                "ride_closed v2 requiere pool_version y reason."
            )
        if self.type == "offers_withdrawn" and message.data.offers is None:
            raise ValueError("offers_withdrawn v2 requiere offers.")

        validate_realtime_event_semantics(
            event_type=self.type,
            stream=self.stream,
            aggregate_type=self.aggregate_type,
            aggregate_id=self.aggregate_id,
            message=message,
        )

        normalized = dump_negotiation_message(message)["data"]
        if not isinstance(normalized, dict):  # pragma: no cover - deltas are objects
            raise ValueError("data debe ser un objeto para los eventos realtime.")
        self.data = normalized
        return self


class LegacyRealtimeEventEnvelopeV2(_RealtimeEventEnvelopeV2Base):
    """Exact envelope accepted by older replicas during the rollout."""


class RealtimeEventEnvelopeV2(_RealtimeEventEnvelopeV2Base):
    """v2 envelope with correlation and compatible reading of the previous format.

    The new producer always sends ``correlation_id``. During a rolling
    deploy, a new consumer may receive an older copy without the field;
    ``batch_id`` is then the stable fallback shared by the whole batch.
    """

    correlation_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def fill_legacy_correlation(self) -> RealtimeEventEnvelopeV2:
        if self.correlation_id is None:
            self.correlation_id = self.batch_id
        return self


class RideSnapshotDataV2(_StrictPayload):
    ride: RideResponse
    offers: list[OfferResponse]

    @model_validator(mode="after")
    def validate_offer_ride(self) -> RideSnapshotDataV2:
        if any(offer.ride_id != self.ride.id for offer in self.offers):
            raise ValueError("Todas las ofertas deben pertenecer al ride del snapshot.")
        return self


class RideSnapshotMessageV2(_Message):
    """Estado completo del pasajero junto a posiciones de stream observadas."""

    schema_version: Literal[2]
    kind: Literal["snapshot"]
    snapshot_id: uuid.UUID
    captured_at: AwareDatetime
    type: Literal["ride_snapshot"]
    data: RideSnapshotDataV2
    watermarks: list[StreamWatermark] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_ride_watermark(self) -> RideSnapshotMessageV2:
        _validate_unique_watermarks(self.watermarks)
        expected_stream = f"ride:{self.data.ride.id}"
        if len(self.watermarks) != 1 or self.watermarks[0].stream != expected_stream:
            raise ValueError("El snapshot requiere exactamente el watermark del ride.")
        return self


class DriverSnapshotDataV2(_StrictPayload):
    open_rides: OpenRidePageResponse
    paused_rides: list[OpenRideResponse]
    offers: list[OfferResponse]
    active_ride: RideResponse | None


class DriverSnapshotMessageV2(_Message):
    """The driver's unified state and vector of observed positions."""

    schema_version: Literal[2]
    kind: Literal["snapshot"]
    snapshot_id: uuid.UUID
    captured_at: AwareDatetime
    type: Literal["driver_snapshot"]
    data: DriverSnapshotDataV2
    watermarks: list[StreamWatermark] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_watermarks(self) -> DriverSnapshotMessageV2:
        _validate_unique_watermarks(self.watermarks)
        streams = {watermark.stream for watermark in self.watermarks}
        driver_streams = {stream for stream in streams if stream.startswith("driver:")}
        vehicle_pools = streams & {"pool:taxi", "pool:moto"}
        if (
            len(streams) != 3
            or len(driver_streams) != 1
            or len(vehicle_pools) != 1
            or "pool:delivery" not in streams
        ):
            raise ValueError(
                "El snapshot del conductor requiere su stream, delivery y un pool de vehículo."
            )

        vehicle_service = next(iter(vehicle_pools)).partition(":")[2]
        allowed_services = {vehicle_service, "delivery"}
        visible_rides = [
            *self.data.open_rides.items,
            *self.data.paused_rides,
        ]
        if self.data.active_ride is not None:
            visible_rides.append(self.data.active_ride)
        if any(ride.service_type.value not in allowed_services for ride in visible_rides):
            raise ValueError("Los rides del snapshot no pertenecen a los pools declarados.")

        driver_id = uuid.UUID(next(iter(driver_streams)).partition(":")[2])
        if any(offer.driver.id != driver_id for offer in self.data.offers):
            raise ValueError("Las ofertas no pertenecen al conductor del snapshot.")
        active_driver = self.data.active_ride.driver if self.data.active_ride is not None else None
        if self.data.active_ride is not None and (
            active_driver is None or active_driver.id != driver_id
        ):
            raise ValueError("El ride activo no pertenece al conductor del snapshot.")
        return self
