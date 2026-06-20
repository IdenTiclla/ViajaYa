"""Caso de uso: listar solicitudes abiertas para un conductor."""

from __future__ import annotations

from app.domain.entities import RideRequest, User
from app.domain.exceptions import NotAuthorizedActionError
from app.domain.repositories import RideRequestRepository


class ListOpenRides:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(self, driver: User) -> list[RideRequest]:
        if not driver.is_driver or driver.vehicle_type is None:
            raise NotAuthorizedActionError(
                "Solo los conductores con vehículo pueden ver las solicitudes abiertas."
            )
        # Las solicitudes no caducan por tiempo: se listan todas las que siguen
        # buscando conductor para el servicio del conductor.
        return await self._rides.list_open_for_service(driver.vehicle_type)
