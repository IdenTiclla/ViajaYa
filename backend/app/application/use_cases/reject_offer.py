"""Caso de uso: el pasajero rechaza una oferta concreta de su viaje.

A diferencia de aceptar, rechazar NO asigna conductor: solo descarta esa oferta
(p. ej. el pasajero no quiere a ese conductor). El conductor recibe el aviso por
WebSocket y su pantalla de espera deja de mostrarse como vigente.
"""

from __future__ import annotations

import uuid

from app.domain.entities import ACTIVE_OFFER_STATUSES, Offer, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    OfferNotFoundError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository


class RejectOffer:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(self, rider: User, offer_id: uuid.UUID) -> Offer:
        offer = await self._offers.get_by_id(offer_id)
        if offer is None:
            raise OfferNotFoundError("La oferta no existe.")

        ride = await self._rides.get_by_id(offer.ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No puedes rechazar ofertas de este viaje.")
        # Solo se puede rechazar una oferta pendiente (active). El conductor recibe
        # el aviso por WebSocket y su pantalla de espera deja de mostrarse vigente.
        if offer.status not in ACTIVE_OFFER_STATUSES:
            raise InvalidRideTransitionError("La oferta ya no está disponible.")

        rejected = await self._offers.reject_if_pending(offer.id)
        if rejected is None:
            raise InvalidRideTransitionError("La oferta ya no está disponible.")
        return rejected
