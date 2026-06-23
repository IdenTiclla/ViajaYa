"""Endpoints de viajes: solicitud, ofertas, asignación y ciclo de vida."""

from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import (
    CurrentUserDep,
    RideRequestRepositoryDep,
    get_accept_offer,
    get_cancel_ride,
    get_create_offer,
    get_create_ride_request,
    get_edit_ride,
    get_get_ride,
    get_list_offers_for_ride,
    get_list_open_rides,
    get_list_recent_destinations,
    get_list_ride_history,
    get_pause_ride_for_edit,
    get_rate_ride,
    get_reject_offer,
    get_update_ride_fare,
    get_update_ride_status,
    get_withdraw_offer,
)
from app.api.v1 import events
from app.api.v1.presence import present_rides
from app.api.v1.schemas.offers import OfferCreate, OfferResponse
from app.api.v1.schemas.ratings import RatingCreate, RatingResponse
from app.api.v1.schemas.rides import (
    CreateRideRequestRequest,
    OpenRideResponse,
    RecentDestinationResponse,
    RideEdit,
    RideFareUpdate,
    RideHistoryItemResponse,
    RideRequestResponse,
    RideResponse,
    RideStatusUpdate,
)
from app.application.dto import (
    CreateOfferInput,
    CreateRideRequestInput,
    LocationInput,
    RideDetail,
)
from app.application.use_cases.accept_offer import AcceptOffer
from app.application.use_cases.cancel_ride import CancelRide
from app.application.use_cases.create_offer import CreateOffer
from app.application.use_cases.create_ride_request import CreateRideRequest
from app.application.use_cases.edit_ride import EditRide
from app.application.use_cases.expire_offer import ExpireOffer
from app.application.use_cases.get_ride import GetRide
from app.application.use_cases.list_offers_for_ride import ListOffersForRide
from app.application.use_cases.list_open_rides import ListOpenRides
from app.application.use_cases.list_recent_destinations import ListRecentDestinations
from app.application.use_cases.list_ride_history import ListRideHistory
from app.application.use_cases.pause_ride_for_edit import PauseRideForEdit
from app.application.use_cases.rate_ride import RateRide
from app.application.use_cases.reject_offer import RejectOffer
from app.application.use_cases.update_ride_fare import UpdateRideFare
from app.application.use_cases.update_ride_status import UpdateRideStatus
from app.application.use_cases.withdraw_offer import WithdrawOffer
from app.domain.entities import RideStatus
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.db.repositories import SqlAlchemyOfferRepository
from app.infrastructure.db.session import async_session_factory

router = APIRouter(prefix="/rides", tags=["rides"])


def _to_location_input(point) -> LocationInput:
    return LocationInput(
        latitude=point.latitude,
        longitude=point.longitude,
        name=point.name,
        address=point.address,
    )


async def _expire_offer_after(offer_id: uuid.UUID) -> None:
    """Vence la oferta a los 30 s y avisa al conductor en tiempo real por WS.

    Tarea diferida lanzada al crear la oferta, con una sesión nueva (la del
    request ya cerró). Si para entonces la oferta fue aceptada/rechazada/retirada/
    mejorada, el use case no la toca (race-safe). Es best-effort: nunca debe
    romper el worker (si el servidor reinició, la sesión cayó, etc.).
    """
    try:
        await asyncio.sleep(OFFER_TTL.total_seconds())
        async with async_session_factory() as session:
            offers = SqlAlchemyOfferRepository(session)
            offer = await ExpireOffer(offers).execute(offer_id)
        if offer is not None:
            await events.publish_offer_expired(offer)
    except Exception:
        # La expiración es de UX (notificación en vivo): no crítica.
        pass


@router.post("", response_model=RideRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_ride(
    body: CreateRideRequestRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[CreateRideRequest, Depends(get_create_ride_request)],
) -> RideRequestResponse:
    ride = await use_case.execute(
        current_user.id,
        CreateRideRequestInput(
            origin=_to_location_input(body.origin),
            destination=_to_location_input(body.destination),
            service_type=body.service_type,
            fare=body.fare,
            payment_method=body.payment_method,
        ),
    )
    # La solicitud aparece para los conductores cuando el pasajero abre su
    # conexión WebSocket (presencia), no al crearla. Ver ``passenger_ws``.
    return RideRequestResponse.from_entity(ride)


@router.get("/recent-destinations", response_model=list[RecentDestinationResponse])
async def recent_destinations(
    current_user: CurrentUserDep,
    use_case: Annotated[ListRecentDestinations, Depends(get_list_recent_destinations)],
) -> list[RecentDestinationResponse]:
    locations = await use_case.execute(current_user.id)
    return [RecentDestinationResponse.from_location(loc) for loc in locations]


@router.get("/open", response_model=list[OpenRideResponse])
async def open_rides(
    current_user: CurrentUserDep,
    use_case: Annotated[ListOpenRides, Depends(get_list_open_rides)],
) -> list[OpenRideResponse]:
    """Solicitudes abiertas del tipo de vehículo del conductor (en línea).

    Solo las que tienen al pasajero presente (conexión WS viva): las abandonadas
    no se muestran.
    """
    details = await use_case.execute(current_user)
    return [OpenRideResponse.from_open_ride(detail) for detail in present_rides(details)]


@router.post(
    "/offers/{offer_id}/accept",
    response_model=RideResponse,
)
async def accept_offer(
    offer_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[AcceptOffer, Depends(get_accept_offer)],
) -> RideResponse:
    """El pasajero acepta una oferta: le asigna el viaje (decisión final).

    Las demás ofertas vivas del viaje quedan rechazadas en la misma transacción.
    """
    result = await use_case.execute(current_user, offer_id)
    await events.publish_offer_accepted(result)
    return RideResponse.from_detail(result.detail)


@router.post("/offers/{offer_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_offer(
    offer_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[RejectOffer, Depends(get_reject_offer)],
) -> Response:
    """El pasajero rechaza una oferta concreta; el conductor lo ve en vivo."""
    offer = await use_case.execute(current_user, offer_id)
    await events.publish_offer_rejected(offer)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/offers/{offer_id}/withdraw", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_offer(
    offer_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[WithdrawOffer, Depends(get_withdraw_offer)],
) -> Response:
    """El conductor retira su oferta (o se niega a confirmarla); el pasajero deja de verla."""
    offer = await use_case.execute(current_user, offer_id)
    await events.publish_offer_withdrawn_by_driver(offer)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/history", response_model=list[RideHistoryItemResponse])
async def ride_history(
    current_user: CurrentUserDep,
    use_case: Annotated[ListRideHistory, Depends(get_list_ride_history)],
    status: RideStatus | None = None,
) -> list[RideHistoryItemResponse]:
    """Historial de viajes terminales del usuario (pasajero o conductor)."""
    items = await use_case.execute(current_user, status)
    return [RideHistoryItemResponse.from_item(item) for item in items]


@router.get("/{ride_id}", response_model=RideResponse)
async def get_ride(
    ride_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[GetRide, Depends(get_get_ride)],
) -> RideResponse:
    """Detalle del viaje para polling (pasajero o conductor asignado)."""
    detail = await use_case.execute(current_user, ride_id)
    return RideResponse.from_detail(detail)


@router.post(
    "/{ride_id}/rating",
    response_model=RatingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def rate_ride(
    ride_id: uuid.UUID,
    body: RatingCreate,
    current_user: CurrentUserDep,
    use_case: Annotated[RateRide, Depends(get_rate_ride)],
) -> RatingResponse:
    """Califica al otro participante tras completarse el viaje."""
    rating = await use_case.execute(current_user, ride_id, body.score, body.comment)
    return RatingResponse.from_entity(rating)


@router.get("/{ride_id}/offers", response_model=list[OfferResponse])
async def list_offers(
    ride_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[ListOffersForRide, Depends(get_list_offers_for_ride)],
) -> list[OfferResponse]:
    """Ofertas pendientes recibidas por el pasajero para su viaje."""
    offers = await use_case.execute(current_user, ride_id)
    return [OfferResponse.from_detail(detail) for detail in offers]


@router.post(
    "/{ride_id}/offers",
    response_model=OfferResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_offer(
    ride_id: uuid.UUID,
    body: OfferCreate,
    current_user: CurrentUserDep,
    use_case: Annotated[CreateOffer, Depends(get_create_offer)],
) -> OfferResponse:
    """El conductor oferta sobre un viaje (aceptar al precio, contraofertar o mejorar)."""
    result = await use_case.execute(
        current_user,
        ride_id,
        CreateOfferInput(
            accept_at_fare=body.accept_at_fare,
            price=body.price,
            eta_min=body.eta_min,
        ),
    )
    if result.superseded_offer_id is not None:
        # Mejora de oferta: retira la tarjeta vieja y anuncia la nueva.
        await events.publish_offer_superseded(result.superseded_offer_id, result.detail)
    else:
        await events.publish_offer_created(result.detail)
    # Avisa al conductor si su oferta vence a los 30 s sin respuesta (tiempo real).
    asyncio.create_task(_expire_offer_after(result.detail.offer.id))
    return OfferResponse.from_detail(result.detail)


@router.patch("/{ride_id}/status", response_model=RideResponse)
async def update_status(
    ride_id: uuid.UUID,
    body: RideStatusUpdate,
    current_user: CurrentUserDep,
    use_case: Annotated[UpdateRideStatus, Depends(get_update_ride_status)],
    get_ride_use_case: Annotated[GetRide, Depends(get_get_ride)],
) -> RideResponse:
    """El conductor asignado avanza el estado del viaje."""
    await use_case.execute(current_user, ride_id, body.status)
    detail = await get_ride_use_case.execute(current_user, ride_id)
    await events.publish_ride_status(detail)
    return RideResponse.from_detail(detail)


@router.patch("/{ride_id}/fare", response_model=RideResponse)
async def update_fare(
    ride_id: uuid.UUID,
    body: RideFareUpdate,
    current_user: CurrentUserDep,
    use_case: Annotated[UpdateRideFare, Depends(get_update_ride_fare)],
    get_ride_use_case: Annotated[GetRide, Depends(get_get_ride)],
    rides_repo: RideRequestRepositoryDep,
) -> RideResponse:
    """El pasajero aumenta su oferta mientras se buscan conductores."""
    await use_case.execute(current_user, ride_id, body.fare)
    detail = await get_ride_use_case.execute(current_user, ride_id)
    # Al pasajero (su detalle) y al pool de conductores (ven el nuevo monto).
    await events.publish_ride_status(detail)
    open_detail = await rides_repo.open_ride_with_rider(ride_id)
    if open_detail is not None:
        await events.publish_ride_created(open_detail)
    return RideResponse.from_detail(detail)


@router.post("/{ride_id}/cancel", response_model=RideResponse)
async def cancel_ride(
    ride_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[CancelRide, Depends(get_cancel_ride)],
    get_ride_use_case: Annotated[GetRide, Depends(get_get_ride)],
) -> RideResponse:
    """Cancela el viaje (pasajero o conductor asignado), antes de iniciarlo."""
    result = await use_case.execute(current_user, ride_id)
    detail = await get_ride_use_case.execute(current_user, ride_id)
    await events.publish_ride_status(detail)
    # Si estaba en el pool (buscando), que los conductores la quiten de su lista.
    await events.publish_ride_closed(detail.ride.id, detail.ride.service_type)
    # Avisa a los conductores con oferta viva: el viaje se canceló (no "tomada").
    for offer in result.cancelled_offers:
        await events.publish_offer_rejected(offer, reason="ride_cancelled")
    return RideResponse.from_detail(detail)


@router.post("/{ride_id}/pause-edit", response_model=RideResponse)
async def pause_ride_for_edit(
    ride_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[PauseRideForEdit, Depends(get_pause_ride_for_edit)],
) -> RideResponse:
    """Pausa la solicitud para editarla (Modificar): la oculta del pool y retira ofertas."""
    result = await use_case.execute(current_user, ride_id)
    await events.publish_ride_paused(result)
    return RideResponse.from_detail(
        RideDetail(ride=result.ride, driver=None, accepted_offer=None)
    )


@router.patch("/{ride_id}", response_model=RideResponse)
async def edit_ride(
    ride_id: uuid.UUID,
    body: RideEdit,
    current_user: CurrentUserDep,
    use_case: Annotated[EditRide, Depends(get_edit_ride)],
    rides_repo: RideRequestRepositoryDep,
) -> RideResponse:
    """Guarda los cambios de una solicitud pausada y la vuelve a publicar en el pool."""
    ride = await use_case.execute(
        current_user,
        ride_id,
        CreateRideRequestInput(
            origin=_to_location_input(body.origin),
            destination=_to_location_input(body.destination),
            service_type=body.service_type,
            fare=body.fare,
            payment_method=body.payment_method,
        ),
    )
    detail = RideDetail(ride=ride, driver=None, accepted_offer=None)
    open_detail = await rides_repo.open_ride_with_rider(ride_id)
    if open_detail is not None:
        await events.publish_ride_created(open_detail)
    await events.publish_ride_status(detail)
    return RideResponse.from_detail(detail)
