"""Pruebas del contrato discriminado de mensajes de negociación."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.realtime import (
    DriverActiveRideMessage,
    DriverOffersSnapshotMessage,
    DriverSnapshotDataV2,
    DriverSnapshotMessageV2,
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
    RealtimeEventEnvelopeV2,
    RideClosedData,
    RideClosedMessage,
    RideCreatedMessage,
    RidePausedData,
    RidePausedMessage,
    RideSnapshotDataV2,
    RideSnapshotMessageV2,
    RideStatusMessage,
    StreamWatermark,
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


def _offer(*, ride_id: uuid.UUID | None = None) -> OfferResponse:
    return OfferResponse.model_validate(
        {
            "id": uuid.uuid4(),
            "ride_id": ride_id or uuid.uuid4(),
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
        OpenRidesSnapshotMessage(data=OpenRidePageResponse(items=[open_ride], next_cursor=None)),
        PausedRidesSnapshotMessage(data=[open_ride]),
        DriverOffersSnapshotMessage(data=[offer]),
        DriverActiveRideMessage(data=ride),
        RideCreatedMessage(data=open_ride),
        RideClosedMessage(data=RideClosedData(ride_id=ride_id)),
        RidePausedMessage(data=RidePausedData.from_open_ride(open_ride, offer_id)),
        OfferCreatedMessage(data=offer),
        OfferRejectedMessage(
            data=OfferRejectedData(
                ride_id=ride_id,
                offer_id=None,
                reason="ride_taken",
            )
        ),
        OfferWithdrawnMessage(data=OfferWithdrawnData(driver_id=driver_id, offer_id=offer_id)),
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
def test_union_rejects_invalid_reason(message_type: str, data: dict[str, object]):
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


def test_event_envelope_v2_is_strict_and_validates_type_data() -> None:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC)
    envelope = RealtimeEventEnvelopeV2(
        schema_version=2,
        kind="event",
        event_id=uuid.uuid4(),
        batch_id=uuid.uuid4(),
        sequence=0,
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=3,
        stream="pool:taxi",
        stream_version=8,
        occurred_at=now,
        type="ride_closed",
        data={"ride_id": str(ride_id)},
    )

    dumped = envelope.model_dump(mode="json")
    assert dumped["schema_version"] == 2
    assert dumped["kind"] == "event"
    assert dumped["occurred_at"] == now.isoformat().replace("+00:00", "Z")

    invalid = dumped | {"data": {}, "extra": True}
    with pytest.raises(ValidationError):
        RealtimeEventEnvelopeV2.model_validate(invalid)
    with pytest.raises(ValidationError):
        RealtimeEventEnvelopeV2.model_validate(
            {key: value for key, value in dumped.items() if key != "schema_version"}
        )
    with pytest.raises(ValidationError):
        RealtimeEventEnvelopeV2.model_validate(
            dumped | {"occurred_at": datetime.now(), "stream": "pool:bicicleta"}
        )


def test_event_envelope_v2_correlates_aggregate_stream_and_payload() -> None:
    ride_id = uuid.uuid4()
    envelope = RealtimeEventEnvelopeV2(
        schema_version=2,
        kind="event",
        event_id=uuid.uuid4(),
        batch_id=uuid.uuid4(),
        sequence=0,
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=3,
        stream=f"ride:{ride_id}",
        stream_version=8,
        occurred_at=datetime.now(UTC),
        type="offer_created",
        data=_offer(ride_id=ride_id).model_dump(mode="json"),
    )
    dumped = envelope.model_dump(mode="json")

    for invalid in (
        dumped | {"aggregate_type": "driver"},
        dumped | {"aggregate_id": str(uuid.uuid4())},
        dumped | {"stream": "pool:taxi"},
    ):
        with pytest.raises(ValidationError):
            RealtimeEventEnvelopeV2.model_validate(invalid)


@pytest.mark.parametrize(
    "stream",
    ["pool:taxi", "pool:moto", "pool:delivery", f"ride:{uuid.uuid4()}", f"driver:{uuid.uuid4()}"],
)
def test_stream_watermark_accepts_only_canonical_streams(stream: str) -> None:
    assert StreamWatermark(stream=stream, stream_version=0).stream == stream


def test_versiones_realtime_caben_en_un_entero_seguro_de_json() -> None:
    with pytest.raises(ValidationError):
        StreamWatermark(
            stream="pool:taxi",
            stream_version=2**53,
        )


def test_unified_ride_snapshot_validates_ride_watermark_and_offers() -> None:
    ride = _ride()
    now = datetime.now(UTC)
    snapshot = RideSnapshotMessageV2(
        schema_version=2,
        kind="snapshot",
        snapshot_id=uuid.uuid4(),
        captured_at=now,
        type="ride_snapshot",
        data=RideSnapshotDataV2(ride=ride, offers=[_offer(ride_id=ride.id)]),
        watermarks=[StreamWatermark(stream=f"ride:{ride.id}", stream_version=4)],
    )

    assert snapshot.type == "ride_snapshot"
    with pytest.raises(ValidationError, match="watermark"):
        RideSnapshotMessageV2.model_validate(
            snapshot.model_dump()
            | {"watermarks": [{"stream": f"ride:{uuid.uuid4()}", "stream_version": 4}]}
        )


def test_unified_driver_snapshot_requires_full_unique_watermark_vector() -> None:
    driver_id = uuid.uuid4()
    snapshot = DriverSnapshotMessageV2(
        schema_version=2,
        kind="snapshot",
        snapshot_id=uuid.uuid4(),
        captured_at=datetime.now(UTC),
        type="driver_snapshot",
        data=DriverSnapshotDataV2(
            open_rides=OpenRidePageResponse(items=[_open_ride()], next_cursor=None),
            paused_rides=[],
            offers=[],
            active_ride=None,
        ),
        watermarks=[
            StreamWatermark(stream=f"driver:{driver_id}", stream_version=2),
            StreamWatermark(stream="pool:taxi", stream_version=7),
            StreamWatermark(stream="pool:delivery", stream_version=0),
        ],
    )

    assert snapshot.data.active_ride is None
    with pytest.raises(ValidationError, match="delivery"):
        DriverSnapshotMessageV2.model_validate(
            snapshot.model_dump() | {"watermarks": snapshot.model_dump()["watermarks"][:2]}
        )
    wrong_pool = snapshot.model_dump()
    wrong_pool["data"]["open_rides"]["items"][0]["service_type"] = "moto"
    with pytest.raises(ValidationError, match="pools"):
        DriverSnapshotMessageV2.model_validate(wrong_pool)
