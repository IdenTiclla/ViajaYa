"""Caso de uso: listar solicitudes abiertas para un conductor."""

from __future__ import annotations

from app.domain.entities import User
from app.domain.exceptions import DriverUnavailableError, NotAuthorizedActionError
from app.domain.repositories import OpenRideDetail, RideRequestRepository


class ListOpenRides:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(self, driver: User) -> list[OpenRideDetail]:
        if not driver.is_driver or driver.vehicle_type is None:
            raise NotAuthorizedActionError(
                "Solo los conductores con vehículo pueden ver las solicitudes abiertas."
            )
        if not driver.is_online:
            raise DriverUnavailableError("Debes estar en línea para ver solicitudes abiertas.")
        # Las solicitudes no caducan por tiempo: se listan todas las que siguen
        # buscando conductor para el servicio del conductor, ya enriquecidas con
        # los datos del pasajero (una sola query en el repositorio).
        return await self._rides.list_open_with_rider(driver.vehicle_type)
