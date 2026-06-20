"""Caso de uso: el conductor avanza el estado del viaje."""

from __future__ import annotations

import uuid

from app.domain.entities import RideRequest, RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import RideRequestRepository

# Transiciones que puede ejecutar el conductor asignado.
_ALLOWED_TRANSITIONS: dict[RideStatus, set[RideStatus]] = {
    RideStatus.ACCEPTED: {RideStatus.ARRIVING},
    RideStatus.ARRIVING: {RideStatus.IN_PROGRESS},
    RideStatus.IN_PROGRESS: {RideStatus.COMPLETED},
}


class UpdateRideStatus:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(
        self, driver: User, ride_id: uuid.UUID, new_status: RideStatus
    ) -> RideRequest:
        if not driver.is_driver:
            raise NotAuthorizedActionError("Solo los conductores pueden avanzar el viaje.")

        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.driver_id != driver.id:
            raise NotAuthorizedActionError("No eres el conductor asignado a este viaje.")

        allowed = _ALLOWED_TRANSITIONS.get(ride.status, set())
        if new_status not in allowed:
            raise InvalidRideTransitionError(
                f"No se puede pasar de {ride.status.value} a {new_status.value}."
            )

        ride.status = new_status
        return await self._rides.update(ride)
