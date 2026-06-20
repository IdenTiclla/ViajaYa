"""Publicación de eventos de la negociación por WebSocket.

Vive en la capa API (no en los casos de uso) porque publicar es un detalle de
transporte: traduce los DTOs/entidades que ya devuelven los casos de uso a
mensajes ``{type, data}`` y los difunde por el :data:`hub`. Los routers HTTP
llaman a estas funciones tras un caso de uso exitoso.
"""

from __future__ import annotations

import uuid

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.rides import OpenRideResponse, RideResponse
from app.application.dto import (
    AcceptOfferResult,
    OfferDetail,
    RideDetail,
    RidePausedResult,
)
from app.domain.entities import Offer, RideRequest, ServiceType
from app.infrastructure.realtime.hub import (
    driver_topic,
    hub,
    pool_topic,
    ride_topic,
)

# Tipos de evento (deben coincidir con el cliente móvil).
RIDE_CREATED = "ride_created"
RIDE_CLOSED = "ride_closed"
OFFER_CREATED = "offer_created"
OFFER_REJECTED = "offer_rejected"
OFFER_WITHDRAWN = "offer_withdrawn"
OFFER_ACCEPTED = "offer_accepted"
OFFERS_WITHDRAWN = "offers_withdrawn"
RIDE_STATUS = "ride_status"


def _envelope(event_type: str, data: object) -> dict:
    return {"type": event_type, "data": data}


async def publish_ride_created(ride: RideRequest) -> None:
    """Una solicitud nueva (o renovada) aparece para los conductores del pool."""
    payload = OpenRideResponse.from_entity(ride).model_dump(mode="json")
    await hub.broadcast(
        pool_topic(ride.service_type.value), _envelope(RIDE_CREATED, payload)
    )


async def publish_ride_closed(ride_id: uuid.UUID, service_type: ServiceType) -> None:
    """La solicitud deja de estar abierta (asignada/cancelada): sale del pool."""
    await hub.broadcast(
        pool_topic(service_type.value),
        _envelope(RIDE_CLOSED, {"ride_id": str(ride_id)}),
    )


async def publish_ride_paused(result: RidePausedResult) -> None:
    """El pasajero pausó la solicitud para editarla: sale del pool y se retiran sus
    ofertas vivas (el pasajero quita las tarjetas; los conductores ven morir su
    oferta por ``ride_paused``)."""
    ride = result.ride
    await publish_ride_closed(ride.id, ride.service_type)
    for offer in result.paused_offers:
        await hub.broadcast(
            ride_topic(ride.id),
            _envelope(
                OFFER_WITHDRAWN,
                {"driver_id": str(offer.driver_id), "offer_id": str(offer.id)},
            ),
        )
        await hub.broadcast(
            driver_topic(offer.driver_id),
            _envelope(
                OFFER_REJECTED,
                {"ride_id": str(ride.id), "offer_id": str(offer.id), "reason": "ride_paused"},
            ),
        )


async def publish_offer_created(detail: OfferDetail) -> None:
    """Una oferta nueva llega al pasajero dueño del viaje."""
    payload = OfferResponse.from_detail(detail).model_dump(mode="json")
    await hub.broadcast(
        ride_topic(detail.offer.ride_id), _envelope(OFFER_CREATED, payload)
    )


async def publish_offer_rejected(offer: Offer, reason: str = "declined") -> None:
    """La oferta murió para el conductor: rechazada por el pasajero (``declined``)
    o el viaje fue tomado por otro conductor (``ride_taken``)."""
    await hub.broadcast(
        driver_topic(offer.driver_id),
        _envelope(
            OFFER_REJECTED,
            {
                "ride_id": str(offer.ride_id),
                "offer_id": str(offer.id),
                "reason": reason,
            },
        ),
    )


async def publish_offer_withdrawn_by_driver(offer: Offer) -> None:
    """El conductor retiró (o se negó a confirmar) su oferta: el pasajero deja de verla."""
    await hub.broadcast(
        ride_topic(offer.ride_id),
        _envelope(
            OFFER_WITHDRAWN,
            {"driver_id": str(offer.driver_id), "offer_id": str(offer.id)},
        ),
    )


async def publish_offer_superseded(superseded_offer_id: uuid.UUID, detail: OfferDetail) -> None:
    """El conductor mejoró su oferta: se retira la vieja y se anuncia la nueva."""
    await hub.broadcast(
        ride_topic(detail.offer.ride_id),
        _envelope(
            OFFER_WITHDRAWN,
            {
                "driver_id": str(detail.driver.id),
                "offer_id": str(superseded_offer_id),
            },
        ),
    )
    await publish_offer_created(detail)


async def publish_ride_status(detail: RideDetail) -> None:
    """Cambio de estado del viaje: al pasajero dueño y al conductor asignado.

    El conductor también lo recibe por su canal personal para enterarse en vivo
    de cambios que no inició él (p. ej. el pasajero canceló el viaje).
    """
    payload = RideResponse.from_detail(detail).model_dump(mode="json")
    await hub.broadcast(
        ride_topic(detail.ride.id), _envelope(RIDE_STATUS, payload)
    )
    if detail.driver is not None:
        await hub.broadcast(
            driver_topic(detail.driver.id), _envelope(RIDE_STATUS, payload)
        )


async def publish_offer_accepted(result: AcceptOfferResult) -> None:
    """Difunde el desenlace de la aceptación del pasajero (la "regla de oro").

    - Al pasajero dueño: el viaje pasa a ``accepted``.
    - Al conductor elegido: ``offer_accepted`` (va a su pantalla de navegación) y
      ``offers_withdrawn`` (sus otras ofertas se retiraron).
    - A los **otros** conductores de este viaje: ``offer_rejected`` con razón
      ``ride_taken`` (el pasajero eligió a otro).
    - A los **otros** pasajeros del conductor: ``offer_withdrawn`` (que quiten al
      conductor de su pantalla).
    - Al pool: la solicitud se cierra.
    """
    ride = result.detail.ride
    driver = result.detail.driver
    ride_payload = RideResponse.from_detail(result.detail).model_dump(mode="json")

    await hub.broadcast(ride_topic(ride.id), _envelope(RIDE_STATUS, ride_payload))
    await publish_ride_closed(ride.id, ride.service_type)

    if driver is not None:
        await hub.broadcast(
            driver_topic(driver.id), _envelope(OFFER_ACCEPTED, ride_payload)
        )
        await hub.broadcast(
            driver_topic(driver.id),
            _envelope(
                OFFERS_WITHDRAWN,
                {"ride_ids": [str(rid) for rid in result.withdrawn_ride_ids]},
            ),
        )
        for other_ride_id in result.withdrawn_ride_ids:
            await hub.broadcast(
                ride_topic(other_ride_id),
                _envelope(OFFER_WITHDRAWN, {"driver_id": str(driver.id)}),
            )

    for loser_id in result.losing_driver_ids:
        await hub.broadcast(
            driver_topic(loser_id),
            _envelope(
                OFFER_REJECTED,
                {"ride_id": str(ride.id), "offer_id": None, "reason": "ride_taken"},
            ),
        )
