"""Pruebas del contrato discriminado de mensajes de negociación."""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.realtime import (
    DriverActiveRideMessage,
    DriverOffersSnapshotMessage,
    NegotiationMessage,
    OfferAcceptedMessage,
    OfferCreatedMessage,
    OfferExpiredData,
    OfferExpiredMessage,
    OfferRejectedData,
    OfferRejectedMessage,
    OffersSnapshotMessage,
    OffersWithdrawnData,
    OffersWithdrawnMessage,
    OfferWithdrawnData,
    OfferWithdrawnMessage,
    OpenRidesSnapshotMessage,
    PausedRidesSnapshotMessage,
    RideClosedData,
    RideClosedMessage,
    RideCreatedMessage,
    RidePausedData,
    RidePausedMessage,
    RideStatusMessage,
    dump_negotiation_message,
    parse_negotiation_message,
)
from app.api.v1.schemas.rides import OpenRidePageResponse, OpenRideResponse, RideResponse


def _point(name: str) -> dict[str, object]:
    return {
        "latitude": -16.5,
        "longitude": -68.13,
        "name": name,
        "address": f"{name} 123",
        "country_code": "BO",
    }


def _open_ride() -> OpenRideResponse:
    return OpenRideResponse.model_validate(
        {
            "id": uuid.uuid4(),
            "service_type": "taxi",
            "fare": "25.00",
            "payment_method": "cash",
            "origin": _point("Origen"),
            "destination": _point("Destino"),
            "rider": {
                "id": uuid.uuid4(),
                "full_name": "Pasajero",
                "rating": 4.5,
                "trips_completed": 3,
            },
            "pool_version": 1,
            "created_at": None,
        }
    )


def _offer() -> OfferResponse:
    return OfferResponse.model_validate(
        {
            "id": uuid.uuid4(),
            "ride_id": uuid.uuid4(),
            "price": "28.00",
            "eta_min": 5,
            "status": "pending",
            "driver": {
                "id": uuid.uuid4(),
                "full_name": "Conductor",
                "rating": 4.8,
                "vehicle_type": "taxi",
                "plate": "ABC-123",
                "vehicle_model": "Sedán",
            },
            "created_at": None,
            "expires_at": None,
        }
    )


def _ride() -> RideResponse:
    rider_id = uuid.uuid4()
    return RideResponse.model_validate(
        {
            "id": uuid.uuid4(),
            "rider_id": rider_id,
            "status": "accepted",
            "service_type": "taxi",
            "fare": "25.00",
            "payment_method": "cash",
            "origin": _point("Origen"),
            "destination": _point("Destino"),
            "paused": False,
            "rider": {
                "id": rider_id,
                "full_name": "Pasajero",
                "phone": None,
                "rating": 4.5,
            },
            "driver": None,
            "accepted_price": None,
            "accepted_eta_min": None,
            "created_at": None,
            "completed_at": None,
            "cancelled_at": None,
        }
    )


def _all_messages() -> list[NegotiationMessage]:
    open_ride = _open_ride()
    offer = _offer()
    ride = _ride()
    ride_id = uuid.uuid4()
    offer_id = uuid.uuid4()
    driver_id = uuid.uuid4()
    return [
        OffersSnapshotMessage(data=[offer]),
        OpenRidesSnapshotMessage(
            data=OpenRidePageResponse(items=[open_ride], next_cursor=None)
        ),
        PausedRidesSnapshotMessage(data=[open_ride]),
        DriverOffersSnapshotMessage(data=[offer]),
        DriverActiveRideMessage(data=ride),
        RideCreatedMessage(data=open_ride),
        RideClosedMessage(data=RideClosedData(ride_id=ride_id)),
        RidePausedMessage(
            data=RidePausedData.from_open_ride(open_ride, offer_id)
        ),
        OfferCreatedMessage(data=offer),
        OfferRejectedMessage(
            data=OfferRejectedData(
                ride_id=ride_id,
                offer_id=None,
                reason="ride_taken",
            )
        ),
        OfferWithdrawnMessage(
            data=OfferWithdrawnData(driver_id=driver_id, offer_id=offer_id)
        ),
        OfferAcceptedMessage(data=ride),
        OffersWithdrawnMessage(data=OffersWithdrawnData(ride_ids=[ride_id])),
        OfferExpiredMessage(
            data=OfferExpiredData(
                ride_id=ride_id,
                offer_id=offer_id,
                driver_id=driver_id,
                reason="expired",
            )
        ),
        RideStatusMessage(data=ride),
    ]


@pytest.mark.parametrize("message", _all_messages(), ids=lambda message: message.type)
def test_union_discriminates_every_current_message(message: NegotiationMessage):
    dumped = dump_negotiation_message(message)

    parsed = parse_negotiation_message(dumped)

    assert parsed.type == message.type
    assert dump_negotiation_message(parsed) == dumped


def test_union_rejects_unknown_message_type():
    with pytest.raises(ValidationError):
        parse_negotiation_message({"type": "unknown", "data": {}})


def test_union_rejects_invalid_payload():
    with pytest.raises(ValidationError):
        parse_negotiation_message({"type": "ride_closed", "data": {}})


@pytest.mark.parametrize(
    ("message_type", "data"),
    [
        (
            "offer_rejected",
            {
                "ride_id": str(uuid.uuid4()),
                "offer_id": None,
                "reason": "unknown",
            },
        ),
        (
            "offer_withdrawn",
            {
                "driver_id": str(uuid.uuid4()),
                "reason": "unknown",
            },
        ),
        (
            "offers_withdrawn",
            {
                "ride_ids": [str(uuid.uuid4())],
                "reason": "unknown",
            },
        ),
    ],
)
def test_union_rejects_invalid_reason(
    message_type: str, data: dict[str, object]
):
    with pytest.raises(ValidationError):
        parse_negotiation_message({"type": message_type, "data": data})


def test_dump_preserves_absent_optional_fields_and_explicit_null():
    driver_id = uuid.uuid4()
    ride_id = uuid.uuid4()

    withdrawn = dump_negotiation_message(
        OfferWithdrawnMessage(data=OfferWithdrawnData(driver_id=driver_id))
    )
    rejected = dump_negotiation_message(
        OfferRejectedMessage(
            data=OfferRejectedData(
                ride_id=ride_id,
                offer_id=None,
                reason="ride_taken",
            )
        )
    )

    assert withdrawn == {
        "type": "offer_withdrawn",
        "data": {"driver_id": str(driver_id)},
    }
    assert rejected["data"]["offer_id"] is None
