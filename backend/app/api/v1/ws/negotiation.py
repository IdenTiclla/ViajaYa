"""Endpoints WebSocket de la negociación de ofertas (solo bajada).

Las acciones (crear solicitud/oferta, aceptar, avanzar estado) siguen siendo HTTP
POST; estos sockets solo **empujan eventos** a quien corresponde. Al conectar se
envía un *snapshot* del estado actual para que no haya ventana ciega.

Auth: el access token viaja como subprotocolo, nunca en la URL. Token inválido o
usuario no autorizado → cierre con código 1008.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.api.deps import get_session_factory
from app.api.v1 import events, presence
from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.rides import OpenRideResponse, RideResponse
from app.application.dto import OfferDetail
from app.application.use_cases.expire_offer import ExpireOffer
from app.application.use_cases.get_driver_active_ride import GetDriverActiveRide
from app.application.use_cases.list_offers_for_ride import ListOffersForRide
from app.application.use_cases.list_open_rides import ListOpenRides
from app.domain.entities import UserRole, services_for_vehicle
from app.domain.ride_policy import is_offer_expired
from app.infrastructure.config import get_settings
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.realtime.hub import (
    driver_topic,
    hub,
    pool_topic,
    ride_topic,
)
from app.infrastructure.realtime.ws_auth import (
    AUTH_SUBPROTOCOL,
    authenticate_ws,
    token_from_subprotocol,
)
from app.infrastructure.security.jwt_service import JwtTokenService

router = APIRouter(tags=["ws"])

_POLICY_VIOLATION = 1008

SessionFactoryDep = Annotated[object, Depends(get_session_factory)]


async def _drain(websocket: WebSocket) -> None:
    """Mantiene la conexión abierta hasta que el cliente la cierre.

    El canal es de bajada; cualquier mensaje entrante (p. ej. un ping) se ignora.
    """
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass


@router.websocket("/ws/rides/{ride_id}")
async def passenger_ws(
    websocket: WebSocket,
    ride_id: uuid.UUID,
    session_factory: SessionFactoryDep,
) -> None:
    """El pasajero dueño del viaje recibe ofertas y cambios de estado en vivo."""
    token = token_from_subprotocol(websocket)
    await websocket.accept(subprotocol=AUTH_SUBPROTOCOL if token else None)
    topic = ride_topic(ride_id)
    subscribed = False
    try:
        async with session_factory() as session:
            users = SqlAlchemyUserRepository(session)
            rides = SqlAlchemyRideRequestRepository(session)
            offers = SqlAlchemyOfferRepository(session)
            tokens = JwtTokenService(get_settings())

            user = await authenticate_ws(token, users, tokens)
            if user is None:
                await websocket.close(code=_POLICY_VIOLATION)
                return
            ride = await rides.get_by_id(ride_id)
            if ride is None or ride.rider_id != user.id:
                await websocket.close(code=_POLICY_VIOLATION)
                return

            async with hub.delivery_barrier(websocket):
                hub.subscribe(topic, websocket)
                subscribed = True
                details = await ListOffersForRide(rides, offers, users).execute(
                    user, ride_id
                )
                snapshot = [
                    OfferResponse.from_detail(detail).model_dump(mode="json")
                    for detail in details
                ]
                await websocket.send_json(
                    {"type": "offers_snapshot", "data": snapshot}
                )

        # Presencia: la solicitud aparece en el pool mientras el pasajero esté
        # presente (conectado o dentro de la ventana de gracia). El ``finally``
        # también cubre una desconexión durante esta revalidación.
        await presence.on_passenger_connect(ride_id, session_factory)
        await _drain(websocket)
    finally:
        if subscribed:
            hub.unsubscribe(topic, websocket)
            presence.on_passenger_disconnect(ride_id, session_factory)


@router.websocket("/ws/driver")
async def driver_ws(
    websocket: WebSocket,
    session_factory: SessionFactoryDep,
) -> None:
    """El conductor en línea recibe solicitudes nuevas y el aviso de ser elegido."""
    token = token_from_subprotocol(websocket)
    await websocket.accept(subprotocol=AUTH_SUBPROTOCOL if token else None)
    topics: list[str] = []
    try:
        async with session_factory() as session:
            users = SqlAlchemyUserRepository(session)
            rides = SqlAlchemyRideRequestRepository(session)
            offers = SqlAlchemyOfferRepository(session)
            tokens = JwtTokenService(get_settings())

            user = await authenticate_ws(token, users, tokens)
            if user is None or user.role is not UserRole.DRIVER or user.vehicle_type is None:
                await websocket.close(code=_POLICY_VIOLATION)
                return

            topics = [
                *(pool_topic(service.value) for service in services_for_vehicle(user.vehicle_type)),
                driver_topic(user.id),
            ]
            # Suscribir dentro de la barrera cierra la ventana entre leer el estado
            # y empezar a recibir eventos. Un broadcast concurrente espera hasta
            # que los snapshots completos hayan salido.
            async with hub.delivery_barrier(websocket):
                for topic in topics:
                    hub.subscribe(topic, websocket)

                open_rides = (
                    presence.present_rides(await ListOpenRides(rides).execute(user))
                    if user.is_online
                    else []
                )
                snapshot = [
                    OpenRideResponse.from_open_ride(detail).model_dump(mode="json")
                    for detail in open_rides
                ]
                paused_snapshot = [
                    OpenRideResponse.from_open_ride(detail).model_dump(mode="json")
                    for detail in await rides.list_paused_with_rider_for_driver(user.id)
                ]

                # Recuperación de estado al (re)conectar:
                # 1) vencer ofertas que pasaron su TTL y excluirlas del snapshot.
                expired_offers = []
                active_offers = []
                for offer in await offers.list_active_by_driver(user.id):
                    if is_offer_expired(offer):
                        done = await ExpireOffer(offers).execute(offer.id)
                        if done is not None:
                            expired_offers.append(done)
                    else:
                        active_offers.append(offer)
                offer_snapshot = [
                    OfferResponse.from_detail(
                        OfferDetail(offer=offer, driver=user)
                    ).model_dump(mode="json")
                    for offer in active_offers
                ]
                # 2) viaje activo (recupera un offer_accepted que se perdió).
                active_detail = await GetDriverActiveRide(rides, offers, users).execute(user)

                # Handshake autoritativo, siempre en este orden.
                await websocket.send_json(
                    {"type": "open_rides_snapshot", "data": snapshot}
                )
                await websocket.send_json(
                    {"type": "paused_rides_snapshot", "data": paused_snapshot}
                )
                await websocket.send_json(
                    {"type": "driver_offers_snapshot", "data": offer_snapshot}
                )
                if active_detail is not None:
                    await websocket.send_json(
                        {
                            "type": "driver_active_ride",
                            "data": RideResponse.from_detail(active_detail).model_dump(
                                mode="json"
                            ),
                        }
                    )

        # Se difunde tras el handshake; el mismo socket ya está suscrito.
        for offer in expired_offers:
            await events.publish_offer_expired(offer)
        await _drain(websocket)
    finally:
        for topic in topics:
            hub.unsubscribe(topic, websocket)
