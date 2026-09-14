"""Use case: the vehicles a user registered to drive with."""

from __future__ import annotations

from app.domain.entities import DriverVehicle, User
from app.domain.repositories import DriverVehicleRepository


class ListDriverVehicles:
    def __init__(self, vehicles: DriverVehicleRepository) -> None:
        self._vehicles = vehicles

    async def execute(self, user: User) -> list[DriverVehicle]:
        return await self._vehicles.list_by_user(user.id)
