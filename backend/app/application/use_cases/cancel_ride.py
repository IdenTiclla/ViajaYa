"""Caso de uso: cancelar un viaje (pasajero o conductor asignado)."""

from __future__ import annotations

import uuid

from app.domain.entities import RideRequest, RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository

# Estados desde los que aún se puede cancelar (antes de iniciar el viaje).
_CANCELLABLE = {RideStatus.SEARCHING, RideStatus.ACCEPTED, RideStatus.ARRIVING}


class CancelRide:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(self, user: User, ride_id: uuid.UUID) -> RideRequest:
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
        # La solicitud murió: sus ofertas pendientes mueren con ella.
        await self._offers.reject_pending(ride_id)
        return updated
