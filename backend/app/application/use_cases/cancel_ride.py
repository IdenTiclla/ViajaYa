"""Caso de uso: cancelar un viaje (pasajero o conductor asignado)."""

from __future__ import annotations

import uuid

from app.application.dto import CancelRideResult
from app.domain.entities import OfferStatus, RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository
from app.domain.ride_policy import is_offer_expired

# Estados desde los que aún se puede cancelar (antes de iniciar el viaje).
_CANCELLABLE = {RideStatus.SEARCHING, RideStatus.ACCEPTED, RideStatus.ARRIVING}


class CancelRide:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(self, user: User, ride_id: uuid.UUID) -> CancelRideResult:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")

        is_rider = ride.rider_id == user.id
        is_driver = ride.driver_id is not None and ride.driver_id == user.id
        if not (is_rider or is_driver):
            raise NotAuthorizedActionError("No puedes cancelar este viaje.")

        if ride.status not in _CANCELLABLE:
            raise InvalidRideTransitionError("El viaje ya no se puede cancelar.")

        ride.status = RideStatus.CANCELLED
        updated = await self._rides.update(ride)
        # Ofertas vivas que mueren con la solicitud (para avisar a sus conductores).
        cancelled = [
            o
            for o in await self._offers.list_by_ride(ride_id)
            if o.status is OfferStatus.PENDING and not is_offer_expired(o)
        ]
        await self._offers.reject_pending(ride_id)
        return CancelRideResult(ride=updated, cancelled_offers=cancelled)
