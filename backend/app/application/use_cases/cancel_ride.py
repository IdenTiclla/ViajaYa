"""Caso de uso: cancelar un viaje (pasajero o conductor asignado)."""

from __future__ import annotations

import uuid

from app.application.dto import CancelRideResult
from app.domain.entities import RideStatus, User
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

        transition = await self._offers.cancel_ride_atomically(
            ride_id,
            expected_status=ride.status,
            expected_paused=ride.paused,
        )
        if transition is None:
            raise InvalidRideTransitionError(
                "El viaje cambió de estado y ya no se puede cancelar."
            )
        return CancelRideResult(
            ride=transition.ride,
            cancelled_offers=transition.affected_offers,
        )
