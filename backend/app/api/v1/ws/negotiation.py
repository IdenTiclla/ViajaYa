"""Endpoints WebSocket de la negociación de ofertas (solo bajada).

Las acciones (crear solicitud/oferta, aceptar, avanzar estado) siguen siendo HTTP
POST; estos sockets solo **empujan eventos** a quien corresponde. Al conectar se
envía un *snapshot* del estado actual para que no haya ventana ciega.

Auth: access token por query param ``?token=…`` (RN no permite cabeceras en
``WebSocket``). Token inválido o usuario no autorizado → cierre con código 1008.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.api.deps import get_session_factory
from app.api.v1 import presence
from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.rides import OpenRideResponse
from app.application.use_cases.list_offers_for_ride import ListOffersForRide
from app.application.use_cases.list_open_rides import ListOpenRides
from app.domain.entities import UserRole
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
from app.infrastructure.realtime.ws_auth import authenticate_ws
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
    token: str | None = None,
) -> None:
    """El pasajero dueño del viaje recibe ofertas y cambios de estado en vivo."""
    await websocket.accept()
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

        # Detalle enriquecido con el pasajero: al conectar publicamos el ride al
        # pool con sus datos (ride_created), no solo en el snapshot del conductor.
        open_detail = await rides.open_ride_with_rider(ride_id)
        details = await ListOffersForRide(rides, offers, users).execute(user, ride_id)
        snapshot = [OfferResponse.from_detail(d).model_dump(mode="json") for d in details]

    await websocket.send_json({"type": "offers_snapshot", "data": snapshot})

    topic = ride_topic(ride_id)
    hub.subscribe(topic, websocket)
    # Presencia: la solicitud aparece en el pool mientras el pasajero esté
    # presente (conectado o dentro de la ventana de gracia). Minimizar/cambiar de
    # pantalla no la saca; solo cerrar la app (no reconectar tras la gracia).
    if open_detail is not None:
        await presence.on_passenger_connect(open_detail)
    try:
        await _drain(websocket)
    finally:
        hub.unsubscribe(topic, websocket)
        presence.on_passenger_disconnect(ride)


@router.websocket("/ws/driver")
async def driver_ws(
    websocket: WebSocket,
    session_factory: SessionFactoryDep,
    token: str | None = None,
) -> None:
    """El conductor en línea recibe solicitudes nuevas y el aviso de ser elegido."""
    await websocket.accept()
    async with session_factory() as session:
        users = SqlAlchemyUserRepository(session)
        rides = SqlAlchemyRideRequestRepository(session)
        tokens = JwtTokenService(get_settings())

        user = await authenticate_ws(token, users, tokens)
        if user is None or user.role is not UserRole.DRIVER or user.vehicle_type is None:
            await websocket.close(code=_POLICY_VIOLATION)
            return

        open_rides = presence.present_rides(await ListOpenRides(rides).execute(user))
        snapshot = [OpenRideResponse.from_open_ride(d).model_dump(mode="json") for d in open_rides]

    await websocket.send_json({"type": "open_rides_snapshot", "data": snapshot})

    topics = [pool_topic(user.vehicle_type.value), driver_topic(user.id)]
    for topic in topics:
        hub.subscribe(topic, websocket)
    try:
        await _drain(websocket)
    finally:
        for topic in topics:
            hub.unsubscribe(topic, websocket)
