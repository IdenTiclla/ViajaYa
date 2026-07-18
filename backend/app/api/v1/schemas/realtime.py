"""Contrato validado de mensajes WebSocket de negociación."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.rides import OpenRidePageResponse, OpenRideResponse, RideResponse


class _StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RideClosedData(_StrictPayload):
    ride_id: uuid.UUID


class RidePausedData(OpenRideResponse):
    model_config = ConfigDict(extra="forbid")

    offer_id: uuid.UUID

    @classmethod
    def from_open_ride(
        cls, ride: OpenRideResponse, offer_id: uuid.UUID
    ) -> RidePausedData:
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


class OffersWithdrawnData(_StrictPayload):
    ride_ids: list[uuid.UUID]
    reason: OffersWithdrawnReason | None = None


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
    """Valida un valor externo contra la unión discriminada del protocolo."""
    return negotiation_message_adapter.validate_python(value)


def dump_negotiation_message(message: NegotiationMessage) -> dict[str, object]:
    """Serializa un mensaje ya tipado sin añadir campos opcionales ausentes."""
    validated = negotiation_message_adapter.validate_python(message)
    payload = validated.model_dump(mode="json", exclude_unset=True)
    # ``type`` tiene un default Literal para construir mensajes con ergonomía;
    # se fija siempre en la salida aunque ``exclude_unset`` omita ese default.
    payload["type"] = validated.type
    return payload
