"""Caso de uso: el pasajero pausa su solicitud para editarla (Modificar solicitud).

Pone ``paused=True`` (la solicitud sigue ``SEARCHING`` pero se oculta del pool de
conductores) y retira las ofertas vivas que tuviera, para que no queden apuntando
a una solicitud que va a mutar. Al guardar la edición (:class:`EditRide`) la
solicitud vuelve a estar disponible.
"""

from __future__ import annotations

import uuid

from app.application.dto import RidePausedResult
from app.domain.entities import Offer, RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository
from app.domain.ride_policy import is_offer_active


class PauseRideForEdit:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(self, rider: User, ride_id: uuid.UUID) -> RidePausedResult:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No eres el dueño de esta solicitud.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError(
                "Solo puedes modificar la solicitud mientras se buscan conductores."
            )
        if ride.paused:
            raise InvalidRideTransitionError("La solicitud ya se está modificando.")

        # Capturamos las ofertas vivas antes de retirarlas, para avisar a esos
        # conductores y al pasajero que quite las tarjetas de su pantalla.
        active: list[Offer] = [
            o for o in await self._offers.list_by_ride(ride_id) if is_offer_active(o)
        ]
        await self._offers.reject_pending(ride_id)

        ride.paused = True
        updated = await self._rides.update(ride)
        return RidePausedResult(ride=updated, paused_offers=active)
