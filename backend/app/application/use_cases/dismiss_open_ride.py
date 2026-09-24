"""Use case: a driver hides a version of a request from the pool."""

from __future__ import annotations

import uuid

from app.domain.entities import RideStatus, User, driver_can_serve
from app.domain.exceptions import NotAuthorizedActionError, RideNotFoundError
from app.domain.repositories import RideRequestRepository


class DismissOpenRide:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(self, driver: User, ride_id: uuid.UUID) -> None:
        if not driver.is_driver or driver.vehicle_type is None:
            raise NotAuthorizedActionError(
                "Solo los conductores con vehículo pueden ocultar solicitudes."
            )

        ride = await self._rides.get_by_id(ride_id)
        if (
            ride is None
            or ride.status is not RideStatus.SEARCHING
            or ride.paused
            or not driver_can_serve(driver, ride.service_type)
        ):
            # We neither reveal nor allow dismissing anything that is not in their pool.
            raise RideNotFoundError("La solicitud abierta no existe.")

        await self._rides.dismiss_open_ride_for_driver(driver.id, ride.id, ride.pool_version)
