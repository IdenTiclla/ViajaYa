"""Use case: a user removes one of their driver vehicles."""

from __future__ import annotations

from app.domain.entities import User, VehicleType, aggregate_driver_status
from app.domain.exceptions import DriverVehicleNotFoundError, NotAuthorizedActionError
from app.domain.repositories import DriverVehicleRepository, UserRepository


class RemoveDriverVehicle:
    def __init__(self, users: UserRepository, vehicles: DriverVehicleRepository) -> None:
        self._users = users
        self._vehicles = vehicles

    async def execute(self, user: User, vehicle_type: VehicleType) -> User:
        if user.is_driver and user.vehicle_type is vehicle_type:
            raise NotAuthorizedActionError(
                "Cambia a modo pasajero para quitar el vehículo con el que estás trabajando."
            )
        vehicle = await self._vehicles.get(user.id, vehicle_type)
        if vehicle is None:
            raise DriverVehicleNotFoundError("No tienes un vehículo de ese tipo.")
        await self._vehicles.delete(vehicle)

        remaining = await self._vehicles.list_by_user(user.id)
        user.driver_status = aggregate_driver_status(remaining)
        if user.vehicle_type is vehicle_type:
            # The active vehicle is gone: fall back to another one (approved first).
            replacement = next((v for v in remaining if v.is_approved), None) or (
                remaining[0] if remaining else None
            )
            user.activate_vehicle(replacement)
        return await self._users.update(user)
