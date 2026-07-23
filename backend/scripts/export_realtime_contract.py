"""Genera y verifica ejemplos versionados del contrato realtime backend → mobile.

Uso::

    python -m scripts.export_realtime_contract
    python -m scripts.export_realtime_contract --check

Los ejemplos se construyen con los schemas y serializadores productivos. El
modo ``--check`` solo compara el contrato actual con el snapshot; nunca escribe.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Literal, TypeAlias

from app.api.v1.realtime_outbox import serialize_realtime_outbox_batch_v2
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
    RideClosedData,
    RideClosedMessage,
    RideCreatedMessage,
    RidePausedData,
    RidePausedMessage,
    RideSnapshotDataV2,
    RideSnapshotMessageV2,
    RideStatusMessage,
    StreamWatermark,
    WithdrawnOfferReferenceData,
    dump_negotiation_message,
)
from app.api.v1.schemas.rides import (
    OpenRidePageResponse,
    OpenRideResponse,
    RideResponse,
)
from app.application.dto import RealtimeOutboxEvent

REALTIME_CONTRACT_SNAPSHOT = (
    Path(__file__).resolve().parents[1] / "realtime_contract.json"
)

Audience: TypeAlias = Literal["passenger", "driver"]
Protocol: TypeAlias = Literal["legacy", "v2_event", "v2_snapshot"]

_NOW = datetime(2026, 7, 18, 12, 0, tzinfo=UTC)
_SEARCHING_RIDE_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
_RIDER_ID = uuid.UUID("00000000-0000-4000-8000-000000000002")
_DRIVER_ID = uuid.UUID("00000000-0000-4000-8000-000000000003")
_OFFER_ID = uuid.UUID("00000000-0000-4000-8000-000000000004")
_ACTIVE_RIDE_ID = uuid.UUID("00000000-0000-4000-8000-000000000005")


@dataclass(frozen=True, slots=True)
class _ContractCase:
    name: str
    protocol: Protocol
    audiences: tuple[Audience, ...]
    message: dict[str, object]

    def as_json(self) -> dict[str, object]:
        return {
            "name": self.name,
            "protocol": self.protocol,
            "audiences": list(self.audiences),
            "message": self.message,
        }


@dataclass(frozen=True, slots=True)
class _EventRoute:
    name: str
    audiences: tuple[Audience, ...]
    message: NegotiationMessage
    stream: str
    aggregate_type: Literal["ride", "driver"]
    aggregate_id: uuid.UUID


def _uuid(sequence: int) -> uuid.UUID:
    return uuid.UUID(f"00000000-0000-4000-8000-{sequence:012d}")


def _point(name: str) -> dict[str, object]:
    return {
        "latitude": -16.5,
        "longitude": -68.15,
        "name": name,
        "address": f"{name}, La Paz",
        "country_code": "BO",
    }


def _open_ride() -> OpenRideResponse:
    return OpenRideResponse.model_validate(
        {
            "id": _SEARCHING_RIDE_ID,
            "service_type": "taxi",
            "fare": Decimal("20.00"),
            "payment_method": "cash",
            "origin": _point("Origen"),
            "destination": _point("Destino"),
            "rider": {
                "id": _RIDER_ID,
                "full_name": "Pasajero Uno",
                "rating": 4.9,
                "trips_completed": 12,
            },
            "pool_version": 2,
            "created_at": _NOW,
        }
    )


def _offer() -> OfferResponse:
    return OfferResponse.model_validate(
        {
            "id": _OFFER_ID,
            "ride_id": _SEARCHING_RIDE_ID,
            "price": Decimal("25.00"),
            "eta_min": 5,
            "status": "pending",
            "driver": {
                "id": _DRIVER_ID,
                "full_name": "Conductor Uno",
                "rating": 4.8,
                "vehicle_type": "taxi",
                "plate": "ABC-123",
                "vehicle_model": "Sedán",
            },
            "created_at": _NOW,
            "expires_at": _NOW + timedelta(seconds=30),
        }
    )


def _ride(*, active: bool) -> RideResponse:
    return RideResponse.model_validate(
        {
            "id": _ACTIVE_RIDE_ID if active else _SEARCHING_RIDE_ID,
            "rider_id": _RIDER_ID,
            "status": "accepted" if active else "searching",
            "service_type": "taxi",
            "fare": Decimal("20.00"),
            "payment_method": "cash",
            "origin": _point("Origen"),
            "destination": _point("Destino"),
            "paused": False,
            "rider": {
                "id": _RIDER_ID,
                "full_name": "Pasajero Uno",
                "phone": "+59170000001",
                "rating": 4.9,
            },
            "driver": (
                {
                    "id": _DRIVER_ID,
                    "full_name": "Conductor Uno",
                    "phone": "+59170000002",
                    "rating": 4.8,
                    "vehicle_type": "taxi",
                    "plate": "ABC-123",
                    "vehicle_model": "Sedán",
                }
                if active
                else None
            ),
            "accepted_price": Decimal("25.00") if active else None,
            "accepted_eta_min": 5 if active else None,
            "created_at": _NOW,
            "completed_at": None,
            "cancelled_at": None,
        }
    )


def _messages() -> dict[str, NegotiationMessage]:
    open_ride = _open_ride()
    offer = _offer()
    active_ride = _ride(active=True)
    expired = OfferExpiredData(
        ride_id=_SEARCHING_RIDE_ID,
        offer_id=_OFFER_ID,
        driver_id=_DRIVER_ID,
        reason="expired",
    )
    return {
        "offers_snapshot": OffersSnapshotMessage(data=[offer]),
        "open_rides_snapshot": OpenRidesSnapshotMessage(
            data=OpenRidePageResponse(items=[open_ride], next_cursor=None)
        ),
        "paused_rides_snapshot": PausedRidesSnapshotMessage(data=[open_ride]),
        "driver_offers_snapshot": DriverOffersSnapshotMessage(data=[offer]),
        "driver_active_ride": DriverActiveRideMessage(data=active_ride),
        "ride_created": RideCreatedMessage(data=open_ride),
        "ride_closed": RideClosedMessage(
            data=RideClosedData(
                ride_id=_SEARCHING_RIDE_ID,
                pool_version=2,
                reason="terminal",
            )
        ),
        "ride_paused": RidePausedMessage(
            data=RidePausedData.from_open_ride(open_ride, _OFFER_ID)
        ),
        "offer_created": OfferCreatedMessage(data=offer),
        "offer_rejected": OfferRejectedMessage(
            data=OfferRejectedData(
                ride_id=_SEARCHING_RIDE_ID,
                offer_id=_OFFER_ID,
                reason="declined",
            )
        ),
        "offer_withdrawn": OfferWithdrawnMessage(
            data=OfferWithdrawnData(
                driver_id=_DRIVER_ID,
                offer_id=_OFFER_ID,
                reason="superseded",
            )
        ),
        "offer_accepted": OfferAcceptedMessage(data=active_ride),
        "offers_withdrawn": OffersWithdrawnMessage(
            data=OffersWithdrawnData(
                ride_ids=[_SEARCHING_RIDE_ID],
                offers=[
                    WithdrawnOfferReferenceData(
                        ride_id=_SEARCHING_RIDE_ID,
                        offer_id=_OFFER_ID,
                    )
                ],
                reason="driver_offline",
            )
        ),
        "offer_expired": OfferExpiredMessage(data=expired),
        "ride_status": RideStatusMessage(data=active_ride),
    }


def _legacy_cases(messages: dict[str, NegotiationMessage]) -> list[_ContractCase]:
    cases = [
        ("offers_snapshot", ("passenger",)),
        ("open_rides_snapshot", ("driver",)),
        ("paused_rides_snapshot", ("driver",)),
        ("driver_offers_snapshot", ("driver",)),
        ("driver_active_ride", ("driver",)),
        ("ride_created", ("driver",)),
        ("ride_closed", ("driver",)),
        ("ride_paused", ("driver",)),
        ("offer_created", ("passenger",)),
        ("offer_rejected", ("driver",)),
        ("offer_withdrawn", ("passenger",)),
        ("offer_accepted", ("driver",)),
        ("offers_withdrawn", ("driver",)),
        ("offer_expired", ("passenger", "driver")),
        ("ride_status", ("passenger", "driver")),
    ]
    return [
        _ContractCase(
            name=f"legacy.{message_type}",
            protocol="legacy",
            audiences=audiences,
            message=dump_negotiation_message(messages[message_type]),
        )
        for message_type, audiences in cases
    ]


def _event_routes(messages: dict[str, NegotiationMessage]) -> list[_EventRoute]:
    driver_stream = f"driver:{_DRIVER_ID}"
    searching_ride_stream = f"ride:{_SEARCHING_RIDE_ID}"
    active_ride_stream = f"ride:{_ACTIVE_RIDE_ID}"
    return [
        _EventRoute(
            "ride_created.pool",
            ("driver",),
            messages["ride_created"],
            "pool:taxi",
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "ride_closed.pool",
            ("driver",),
            messages["ride_closed"],
            "pool:taxi",
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "ride_paused.driver",
            ("driver",),
            messages["ride_paused"],
            driver_stream,
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "offer_created.ride",
            ("passenger",),
            messages["offer_created"],
            searching_ride_stream,
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "offer_rejected.driver",
            ("driver",),
            messages["offer_rejected"],
            driver_stream,
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "offer_withdrawn.ride",
            ("passenger",),
            messages["offer_withdrawn"],
            searching_ride_stream,
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "offer_accepted.driver",
            ("driver",),
            messages["offer_accepted"],
            driver_stream,
            "ride",
            _ACTIVE_RIDE_ID,
        ),
        _EventRoute(
            "offers_withdrawn.driver",
            ("driver",),
            messages["offers_withdrawn"],
            driver_stream,
            "driver",
            _DRIVER_ID,
        ),
        _EventRoute(
            "offer_expired.ride",
            ("passenger",),
            messages["offer_expired"],
            searching_ride_stream,
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "offer_expired.driver",
            ("driver",),
            messages["offer_expired"],
            driver_stream,
            "ride",
            _SEARCHING_RIDE_ID,
        ),
        _EventRoute(
            "ride_status.ride",
            ("passenger",),
            messages["ride_status"],
            active_ride_stream,
            "ride",
            _ACTIVE_RIDE_ID,
        ),
        _EventRoute(
            "ride_status.driver",
            ("driver",),
            messages["ride_status"],
            driver_stream,
            "ride",
            _ACTIVE_RIDE_ID,
        ),
    ]


def _v2_event_cases(messages: dict[str, NegotiationMessage]) -> list[_ContractCase]:
    cases: list[_ContractCase] = []
    for index, route in enumerate(_event_routes(messages), start=1):
        event = RealtimeOutboxEvent(
            id=_uuid(100 + index),
            batch_id=_uuid(200 + index),
            correlation_id=_uuid(300 + index),
            sequence=0,
            batch_size=1,
            event_type=route.message.type,
            topic=route.stream,
            aggregate_type=route.aggregate_type,
            aggregate_id=route.aggregate_id,
            aggregate_version=index,
            stream_version=index,
            payload=dump_negotiation_message(route.message),
            created_at=_NOW,
            next_attempt_at=_NOW,
            published_at=None,
            attempts=0,
            last_error=None,
        )
        [serialized] = serialize_realtime_outbox_batch_v2([event])
        cases.append(
            _ContractCase(
                name=f"v2_event.{route.name}",
                protocol="v2_event",
                audiences=route.audiences,
                message=serialized,
            )
        )
    return cases


def _v2_snapshot_cases() -> list[_ContractCase]:
    passenger_snapshot = RideSnapshotMessageV2(
        schema_version=2,
        kind="snapshot",
        snapshot_id=_uuid(301),
        captured_at=_NOW,
        type="ride_snapshot",
        data=RideSnapshotDataV2(ride=_ride(active=False), offers=[_offer()]),
        watermarks=[
            StreamWatermark(
                stream=f"ride:{_SEARCHING_RIDE_ID}",
                stream_version=20,
            )
        ],
    )
    driver_snapshot = DriverSnapshotMessageV2(
        schema_version=2,
        kind="snapshot",
        snapshot_id=_uuid(302),
        captured_at=_NOW,
        type="driver_snapshot",
        data=DriverSnapshotDataV2(
            open_rides=OpenRidePageResponse(items=[_open_ride()], next_cursor=None),
            paused_rides=[],
            offers=[],
            active_ride=_ride(active=True),
        ),
        watermarks=[
            StreamWatermark(stream="pool:taxi", stream_version=30),
            StreamWatermark(stream="pool:delivery", stream_version=31),
            StreamWatermark(
                stream=f"driver:{_DRIVER_ID}",
                stream_version=32,
            ),
        ],
    )
    return [
        _ContractCase(
            name="v2_snapshot.ride_snapshot",
            protocol="v2_snapshot",
            audiences=("passenger",),
            message=passenger_snapshot.model_dump(mode="json"),
        ),
        _ContractCase(
            name="v2_snapshot.driver_snapshot",
            protocol="v2_snapshot",
            audiences=("driver",),
            message=driver_snapshot.model_dump(mode="json"),
        ),
    ]


def construir_contrato_realtime() -> dict[str, object]:
    """Construye la matriz canónica con serializadores productivos."""
    messages = _messages()
    cases = [
        *_legacy_cases(messages),
        *_v2_event_cases(messages),
        *_v2_snapshot_cases(),
    ]
    return {
        "fixture_version": 1,
        "cases": [case.as_json() for case in cases],
    }


def serializar_contrato_realtime() -> str:
    """Devuelve el contrato como JSON estable terminado en salto de línea."""
    return json.dumps(
        construir_contrato_realtime(),
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
        sort_keys=True,
    ) + "\n"


def snapshot_esta_actualizado(
    destino: Path = REALTIME_CONTRACT_SNAPSHOT,
    *,
    esperado: str | None = None,
) -> bool:
    """Compara el snapshot sin escribir en disco."""
    if esperado is None:
        esperado = serializar_contrato_realtime()
    try:
        actual = destino.read_text(encoding="utf-8")
    except FileNotFoundError:
        return False
    return actual == esperado


def escribir_snapshot(
    destino: Path = REALTIME_CONTRACT_SNAPSHOT,
    *,
    contenido: str | None = None,
) -> None:
    """Escribe el contrato realtime serializado de forma determinista."""
    if contenido is None:
        contenido = serializar_contrato_realtime()
    destino.write_text(contenido, encoding="utf-8")


def _crear_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera o verifica el snapshot realtime backend → mobile."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="falla si el snapshot difiere, sin modificarlo",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    destino: Path = REALTIME_CONTRACT_SNAPSHOT,
) -> int:
    """Ejecuta la exportación o comprobación solicitada."""
    args = _crear_parser().parse_args(argv)
    esperado = serializar_contrato_realtime()

    if args.check:
        if snapshot_esta_actualizado(destino, esperado=esperado):
            print(f"Contrato realtime actualizado: {destino}")
            return 0
        print(
            "El snapshot realtime está desactualizado. Ejecuta "
            "`python -m scripts.export_realtime_contract` y versiona el resultado.",
            file=sys.stderr,
        )
        return 1

    escribir_snapshot(destino, contenido=esperado)
    print(f"Contrato realtime exportado: {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
