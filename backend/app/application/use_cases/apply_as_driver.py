"""Use case: a passenger registers (or updates) their driver application."""

from __future__ import annotations

import re

from app.application.dto import DriverApplicationInput
from app.domain.entities import DriverStatus, User, UserRole, services_for_vehicle
from app.domain.exceptions import InvalidDriverApplicationError, NotAuthorizedActionError
from app.domain.repositories import UserRepository

_PLATE_PATTERN = re.compile(r"^[A-Z0-9-]{3,20}$")
_MODEL_MIN_LENGTH = 2
_MODEL_MAX_LENGTH = 120


class ApplyAsDriver:
    """Stores the vehicle and the services the account wants to serve.

    The application starts ``PENDING`` and an operator approves it (F04-A);
    ``auto_approve`` is a development shortcut that approves it at once. The
    account keeps riding as a passenger until it explicitly switches mode.
    """

    def __init__(self, users: UserRepository, *, auto_approve: bool) -> None:
        self._users = users
        self._auto_approve = auto_approve

    async def execute(self, user: User, data: DriverApplicationInput) -> User:
        if not user.is_active:
            raise NotAuthorizedActionError("La cuenta no está activa.")
        if user.role is not UserRole.PASSENGER:
            raise NotAuthorizedActionError(
                "Cambia a modo pasajero para modificar tu registro de conductor."
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

        user.vehicle_type = data.vehicle_type
        user.plate = plate
        user.vehicle_model = vehicle_model
        user.driver_services = chosen
        # Changing the vehicle or services re-enters review outside development.
        user.driver_status = DriverStatus.APPROVED if self._auto_approve else DriverStatus.PENDING
        user.is_online = False
        return await self._users.update(user)
