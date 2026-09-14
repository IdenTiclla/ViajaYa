"""Use case: a user registers (or updates) one of their driver vehicles."""

from __future__ import annotations

import re

from app.application.dto import DriverVehicleInput, DriverVehicleRegistration
from app.domain.entities import (
    DriverStatus,
    DriverVehicle,
    User,
    aggregate_driver_status,
    services_for_vehicle,
)
from app.domain.exceptions import InvalidDriverApplicationError, NotAuthorizedActionError
from app.domain.repositories import DriverVehicleRepository, UserRepository

_PLATE_PATTERN = re.compile(r"^[A-Z0-9-]{3,20}$")
_MODEL_MIN_LENGTH = 2
_MODEL_MAX_LENGTH = 120


class RegisterDriverVehicle:
    """Stores one vehicle (at most one per type) and the services served with it.

    Each vehicle starts ``PENDING`` and an operator approves it (F04-A);
    ``auto_approve`` is a development shortcut that approves it at once. The
    account keeps its current mode; ``User.driver_status`` aggregates the
    vehicles and the first registered vehicle becomes the active one.
    """

    def __init__(
        self,
        users: UserRepository,
        vehicles: DriverVehicleRepository,
        *,
        auto_approve: bool,
    ) -> None:
        self._users = users
        self._vehicles = vehicles
        self._auto_approve = auto_approve

    async def execute(self, user: User, data: DriverVehicleInput) -> DriverVehicleRegistration:
        if not user.is_active:
            raise NotAuthorizedActionError("La cuenta no está activa.")
        if user.is_driver and user.vehicle_type is data.vehicle_type:
            raise NotAuthorizedActionError(
                "Cambia a modo pasajero para modificar el vehículo con el que estás trabajando."
            )

        plate = data.plate.strip().upper().replace(" ", "")
        if not _PLATE_PATTERN.fullmatch(plate):
            raise InvalidDriverApplicationError(
                "La placa debe tener entre 3 y 20 letras o números."
            )
        vehicle_model = " ".join(data.vehicle_model.split())
        if not _MODEL_MIN_LENGTH <= len(vehicle_model) <= _MODEL_MAX_LENGTH:
            raise InvalidDriverApplicationError("Indica el modelo del vehículo.")

        allowed = services_for_vehicle(data.vehicle_type)
        chosen = tuple(service for service in allowed if service in data.services)
        if not chosen:
            raise InvalidDriverApplicationError("Elige al menos un servicio para tu vehículo.")
        if len(chosen) != len(set(data.services)):
            raise InvalidDriverApplicationError("Tu vehículo no puede ofrecer ese servicio.")

        vehicle = await self._vehicles.get(user.id, data.vehicle_type) or DriverVehicle(
            user_id=user.id,
            vehicle_type=data.vehicle_type,
            plate=plate,
            vehicle_model=vehicle_model,
            services=chosen,
        )
        vehicle.plate = plate
        vehicle.vehicle_model = vehicle_model
        vehicle.services = chosen
        # Changing the vehicle or services re-enters review outside development.
        vehicle.status = DriverStatus.APPROVED if self._auto_approve else DriverStatus.PENDING
        saved = await self._vehicles.save(vehicle)

        all_vehicles = await self._vehicles.list_by_user(user.id)
        user.driver_status = aggregate_driver_status(all_vehicles)
        if user.vehicle_type is None or user.vehicle_type is saved.vehicle_type:
            user.activate_vehicle(saved)
        updated = await self._users.update(user)
        return DriverVehicleRegistration(user=updated, vehicle=saved)
