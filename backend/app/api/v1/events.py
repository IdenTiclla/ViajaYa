"""Publicación de eventos de la negociación por WebSocket.

Vive en la capa API (no en los casos de uso) porque publicar es un detalle de
transporte: traduce los DTOs/entidades que ya devuelven los casos de uso a
mensajes ``{type, data}`` y los difunde por el :data:`hub`. Los routers HTTP
llaman a estas funciones tras un caso de uso exitoso.
"""

from __future__ import annotations

import uuid

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.realtime import (
    NegotiationMessage,
    OfferAcceptedMessage,
    OfferCreatedMessage,
    OfferExpiredData,
    OfferExpiredMessage,
    OfferRejectedData,
    OfferRejectedMessage,
    OfferRejectedReason,
    OffersWithdrawnData,
    OffersWithdrawnMessage,
    OfferWithdrawnData,
    OfferWithdrawnMessage,
    OfferWithdrawnReason,
    RideClosedData,
    RideClosedMessage,
    RideClosedReason,
    RideCreatedMessage,
    RidePausedData,
    RidePausedMessage,
    RideStatusMessage,
    WithdrawnOfferReferenceData,
    dump_negotiation_message,
)
from app.api.v1.schemas.rides import OpenRideResponse, RideResponse
from app.application.dto import (
    AcceptOfferResult,
    CancelRideResult,
    CreateOfferResult,
    DriverAvailabilityResult,
    OfferDetail,
    PendingRealtimeEvent,
    RideDetail,
    RidePausedResult,
    RideRepublishedResult,
)
from app.domain.entities import Offer, ServiceType
from app.domain.repositories import OpenRideDetail
from app.infrastructure.realtime.hub import (
    driver_topic,
    hub,
    pool_topic,
    ride_topic,
)


async def _broadcast(topic: str, message: NegotiationMessage) -> None:
    await hub.broadcast(topic, dump_negotiation_message(message))


async def _broadcast_pending(events: list[PendingRealtimeEvent]) -> None:
    """Entrega directa de un batch ya serializado con el contrato canónico.

    Mientras la outbox opera en sombra, esta sigue siendo la ruta que llega a los
    sockets. Reutilizar el mismo batch evita que ambos caminos deriven en payload
    u orden distintos.
    """
    for event in events:
        await hub.broadcast(event.topic, event.payload)


def _pending_offer_event(
    ride_id: uuid.UUID, message: NegotiationMessage
) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type=message.type,
        topic=ride_topic(ride_id),
        aggregate_type="ride",
        aggregate_id=ride_id,
        payload=dump_negotiation_message(message),
    )


def _pending_realtime_event(
    *,
    topic: str,
    aggregate_type: str,
    aggregate_id: uuid.UUID,
    message: NegotiationMessage,
) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type=message.type,
        topic=topic,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload=dump_negotiation_message(message),
    )


def build_create_offer_events(result: CreateOfferResult) -> list[PendingRealtimeEvent]:
    """Construye el batch durable/directo de crear o reemplazar una oferta."""
    detail = result.detail
    ride_id = detail.offer.ride_id
    pending: list[PendingRealtimeEvent] = []
    if result.superseded_offer_id is not None:
        pending.append(
            _pending_offer_event(
                ride_id,
                OfferWithdrawnMessage(
                    data=OfferWithdrawnData(
                        driver_id=detail.driver.id,
                        offer_id=result.superseded_offer_id,
                        reason="superseded",
                    )
                ),
            )
        )
    pending.append(
        _pending_offer_event(
            ride_id,
            OfferCreatedMessage(data=OfferResponse.from_detail(detail)),
        )
    )
    return pending


def build_accept_offer_events(result: AcceptOfferResult) -> list[PendingRealtimeEvent]:
    """Construye el fanout durable/directo de una aceptación atómica."""
    ride = result.detail.ride
    driver = result.detail.driver
    if driver is None:
        raise ValueError("Una aceptación exitosa debe incluir al conductor elegido.")
    ride_response = RideResponse.from_detail(result.detail)
    withdrawn_offers = sorted(
        result.withdrawn_offers,
        key=lambda item: (item.ride_id.hex, item.offer_id.hex),
    )
    pending = [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideStatusMessage(data=ride_response),
        ),
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideClosedMessage(
                data=RideClosedData(
                    ride_id=ride.id,
                    pool_version=ride.pool_version,
                    reason="terminal",
                )
            ),
        ),
    ]
    pending.extend(
        [
            _pending_realtime_event(
                topic=driver_topic(driver.id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=OfferAcceptedMessage(data=ride_response),
            ),
            _pending_realtime_event(
                topic=driver_topic(driver.id),
                aggregate_type="driver",
                aggregate_id=driver.id,
                message=OffersWithdrawnMessage(
                    data=OffersWithdrawnData(
                        ride_ids=[offer.ride_id for offer in withdrawn_offers],
                        offers=[
                            WithdrawnOfferReferenceData(
                                ride_id=offer.ride_id,
                                offer_id=offer.offer_id,
                            )
                            for offer in withdrawn_offers
                        ],
                    )
                ),
            ),
        ]
    )
    for withdrawn_offer in withdrawn_offers:
        pending.append(
            _pending_realtime_event(
                topic=ride_topic(withdrawn_offer.ride_id),
                aggregate_type="ride",
                aggregate_id=withdrawn_offer.ride_id,
                message=OfferWithdrawnMessage(
                    data=OfferWithdrawnData(
                        driver_id=driver.id,
                        offer_id=withdrawn_offer.offer_id,
                    )
                )
            )
        )

    for loser_id in sorted(result.losing_driver_ids, key=lambda item: item.hex):
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(loser_id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=OfferRejectedMessage(
                    data=OfferRejectedData(
                        ride_id=ride.id,
                        offer_id=None,
                        reason="ride_taken",
                    )
                ),
            )
        )
    return pending


def build_pause_ride_events(result: RidePausedResult) -> list[PendingRealtimeEvent]:
    """Construye el fanout durable/directo de pausar una solicitud."""
    ride = result.ride
    open_ride = OpenRideResponse.from_open_ride(result.open_detail)
    pending = [
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideClosedMessage(
                data=RideClosedData(
                    ride_id=ride.id,
                    pool_version=ride.pool_version,
                    reason="paused",
                )
            ),
        )
    ]
    for offer in sorted(result.paused_offers, key=lambda item: item.id.hex):
        pending.extend(
            [
                _pending_realtime_event(
                    topic=ride_topic(ride.id),
                    aggregate_type="ride",
                    aggregate_id=ride.id,
                    message=OfferWithdrawnMessage(
                        data=OfferWithdrawnData(
                            driver_id=offer.driver_id,
                            offer_id=offer.id,
                        )
                    ),
                ),
                _pending_realtime_event(
                    topic=driver_topic(offer.driver_id),
                    aggregate_type="ride",
                    aggregate_id=ride.id,
                    message=RidePausedMessage(
                        data=RidePausedData.from_open_ride(open_ride, offer.id)
                    ),
                ),
            ]
        )
    return pending


def build_cancel_ride_events(result: CancelRideResult) -> list[PendingRealtimeEvent]:
    """Construye el fanout durable/directo de una cancelación."""
    ride = result.detail.ride
    message = RideStatusMessage(data=RideResponse.from_detail(result.detail))
    pending = [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=message,
        )
    ]
    if result.detail.driver is not None:
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(result.detail.driver.id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=message,
            )
        )
    pending.append(
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideClosedMessage(
                data=RideClosedData(
                    ride_id=ride.id,
                    pool_version=ride.pool_version,
                    reason="terminal",
                )
            ),
        )
    )
    for offer in sorted(result.cancelled_offers, key=lambda item: item.id.hex):
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(offer.driver_id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=OfferRejectedMessage(
                    data=OfferRejectedData(
                        ride_id=ride.id,
                        offer_id=offer.id,
                        reason="ride_cancelled",
                    )
                ),
            )
        )
    return pending


def build_republish_ride_events(
    result: RideRepublishedResult,
) -> list[PendingRealtimeEvent]:
    """Construye el batch durable/directo de una renovación del pool."""
    ride = result.ride
    return [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideStatusMessage(data=RideResponse.from_detail(result.detail)),
        ),
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideCreatedMessage(
                data=OpenRideResponse.from_open_ride(result.open_detail)
            ),
        ),
    ]


def build_announce_open_ride_events(
    detail: OpenRideDetail,
) -> list[PendingRealtimeEvent]:
    """Construye el anuncio durable/directo al confirmar presencia."""
    return [
        _pending_realtime_event(
            topic=pool_topic(detail.ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=detail.ride.id,
            message=RideCreatedMessage(
                data=OpenRideResponse.from_open_ride(detail)
            ),
        )
    ]


def build_withdraw_offer_events(
    offer: Offer,
    *,
    reason: OfferWithdrawnReason | None = None,
) -> list[PendingRealtimeEvent]:
    """Construye el retiro durable/directo de una oferta del conductor."""
    data = OfferWithdrawnData(driver_id=offer.driver_id, offer_id=offer.id)
    if reason is not None:
        data = OfferWithdrawnData(
            driver_id=offer.driver_id,
            offer_id=offer.id,
            reason=reason,
        )
    return [
        _pending_realtime_event(
            topic=ride_topic(offer.ride_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=OfferWithdrawnMessage(data=data),
        )
    ]


def build_reject_offer_events(
    offer: Offer,
    *,
    reason: OfferRejectedReason = "declined",
) -> list[PendingRealtimeEvent]:
    """Construye el rechazo durable/directo de una oferta por el pasajero."""
    return [
        _pending_realtime_event(
            topic=driver_topic(offer.driver_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=OfferRejectedMessage(
                data=OfferRejectedData(
                    ride_id=offer.ride_id,
                    offer_id=offer.id,
                    reason=reason,
                )
            ),
        )
    ]


def build_expire_offer_events(offer: Offer) -> list[PendingRealtimeEvent]:
    """Construye el fanout durable/directo de una oferta vencida."""
    message = OfferExpiredMessage(
        data=OfferExpiredData(
            ride_id=offer.ride_id,
            offer_id=offer.id,
            driver_id=offer.driver_id,
            reason="expired",
        )
    )
    return [
        _pending_realtime_event(
            topic=driver_topic(offer.driver_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=message,
        ),
        _pending_realtime_event(
            topic=ride_topic(offer.ride_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=message,
        ),
    ]


def build_update_ride_status_events(
    detail: RideDetail,
) -> list[PendingRealtimeEvent]:
    """Construye el fanout durable/directo de un avance del viaje."""
    ride = detail.ride
    message = RideStatusMessage(data=RideResponse.from_detail(detail))
    pending = [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=message,
        )
    ]
    if detail.driver is not None:
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(detail.driver.id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=message,
            )
        )
    return pending


def build_driver_availability_events(
    result: DriverAvailabilityResult,
) -> list[PendingRealtimeEvent]:
    """Construye el fanout durable/directo de quedar offline."""
    offers = result.withdrawn_offers
    if not offers:
        return []
    pending: list[PendingRealtimeEvent] = []
    for offer in offers:
        pending.extend(
            build_withdraw_offer_events(offer, reason="driver_offline")
        )
    pending.append(
        _pending_realtime_event(
            topic=driver_topic(result.driver.id),
            aggregate_type="driver",
            aggregate_id=result.driver.id,
            message=OffersWithdrawnMessage(
                data=OffersWithdrawnData(
                    ride_ids=[offer.ride_id for offer in offers],
                    offers=[
                        WithdrawnOfferReferenceData(
                            ride_id=offer.ride_id,
                            offer_id=offer.id,
                        )
                        for offer in offers
                    ],
                    reason="driver_offline",
                )
            ),
        )
    )
    return pending


async def publish_ride_created(detail: OpenRideDetail) -> None:
    """Una solicitud nueva (o renovada) aparece para los conductores del pool.

    Llega ya enriquecida con los datos del pasajero: el conductor los ve en la
    tarjeta desde el primer ``ride_created`` (no solo en el snapshot).
    """
    await _broadcast_pending(build_announce_open_ride_events(detail))


async def publish_ride_closed(
    ride_id: uuid.UUID,
    service_type: ServiceType,
    pool_version: int,
    reason: RideClosedReason,
) -> None:
    """La solicitud deja de estar abierta (asignada/cancelada): sale del pool."""
    await _broadcast(
        pool_topic(service_type.value),
        RideClosedMessage(
            data=RideClosedData(
                ride_id=ride_id,
                pool_version=pool_version,
                reason=reason,
            )
        ),
    )


async def publish_ride_paused(result: RidePausedResult) -> None:
    """El pasajero pausó la solicitud para editarla: sale del pool y se retiran sus
    ofertas vivas.

    - Al pool: ``RIDE_CLOSED`` (los conductores **sin** oferta dejan de verla; no
      pueden ofertar sobre una solicitud que va a mutar).
    - A cada conductor **con** oferta viva: ``RIDE_PAUSED`` con el payload completo
      del ride, para que el cliente lo mantenga en su lista marcado como pausado
      (banner "El pasajero está modificando su solicitud" + solo Quitar) **mientras
      dure la edición**. Reemplaza al viejo ``OFFER_REJECTED {ride_paused}`` que no
      transportaba los datos del ride y, sumado al ``RIDE_CLOSED``, hacía desaparecer
      la tarjeta durante la edición (bug de timing).
    - Al pasajero: ``OFFER_WITHDRAWN`` para que quite las tarjetas de ofertas.
    """
    await _broadcast_pending(build_pause_ride_events(result))


async def publish_ride_cancelled(result: CancelRideResult) -> None:
    """Difunde una cancelación usando exactamente el batch de la outbox."""
    await _broadcast_pending(build_cancel_ride_events(result))


async def publish_ride_republished(result: RideRepublishedResult) -> None:
    """Difunde una renovación usando exactamente el batch de la outbox."""
    await _broadcast_pending(build_republish_ride_events(result))


async def publish_offer_created(detail: OfferDetail) -> None:
    """Una oferta nueva llega al pasajero dueño del viaje."""
    await _broadcast_pending(
        build_create_offer_events(
            CreateOfferResult(detail=detail, superseded_offer_id=None)
        )
    )


async def publish_offer_rejected(
    offer: Offer, reason: OfferRejectedReason = "declined"
) -> None:
    """La oferta murió para el conductor: rechazada por el pasajero (``declined``),
    el viaje fue tomado por otro conductor (``ride_taken``) o lo canceló
    (``ride_cancelled``)."""
    await _broadcast_pending(build_reject_offer_events(offer, reason=reason))


async def publish_offer_expired(offer: Offer) -> None:
    """La oferta del conductor venció (30 s) sin respuesta del pasajero.

    Se avisa en tiempo real a ambos lados: el conductor deja de ver "esperando" y
    puede reofertar; el pasajero recibe el evento para retirar la tarjeta de su
    lista en vivo (sin depender de volver a pollear ``/offers``). Se incluye el
    ``driver_id`` para que el cliente pueda leer el nombre del conductor de su
    caché antes de remover la tarjeta.
    """
    await _broadcast_pending(build_expire_offer_events(offer))


async def publish_offer_withdrawn_by_driver(
    offer: Offer, *, reason: OfferWithdrawnReason | None = None
) -> None:
    """El conductor retiró (o se negó a confirmar) su oferta: el pasajero deja de verla."""
    await _broadcast_pending(build_withdraw_offer_events(offer, reason=reason))


async def publish_driver_offline_offers(result: DriverAvailabilityResult) -> None:
    """Retira las ofertas del conductor offline en las pantallas de ambos roles."""
    await _broadcast_pending(build_driver_availability_events(result))


async def publish_offer_superseded(superseded_offer_id: uuid.UUID, detail: OfferDetail) -> None:
    """El conductor mejoró su oferta: se retira la vieja y se anuncia la nueva.

    El ``reason: "superseded"`` distingue este retiro de uno real: el cliente
    quita la tarjeta vieja sin avisar "retiró su oferta" (el ``offer_created``
    inmediato ya anuncia el monto nuevo).
    """
    await _broadcast_pending(
        build_create_offer_events(
            CreateOfferResult(
                detail=detail,
                superseded_offer_id=superseded_offer_id,
            )
        )
    )


async def publish_ride_status(detail: RideDetail) -> None:
    """Cambio de estado del viaje: al pasajero dueño y al conductor asignado.

    El conductor también lo recibe por su canal personal para enterarse en vivo
    de cambios que no inició él (p. ej. el pasajero canceló el viaje).
    """
    await _broadcast_pending(build_update_ride_status_events(detail))


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
    await _broadcast_pending(build_accept_offer_events(result))
