"""Use case: an approved driver switches between passenger and driver mode."""

from __future__ import annotations

from app.domain.entities import RideStatus, User, UserRole, VehicleType
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
)
from app.domain.repositories import DriverVehicleRepository, RideRequestRepository, UserRepository

_DRIVING_STATUSES = {RideStatus.ACCEPTED, RideStatus.ARRIVING, RideStatus.IN_PROGRESS}


class SwitchAccountMode:
    """``role`` is the active mode; an account is never passenger and driver at once.

    Entering driver mode picks the vehicle to work with: the one requested, or
    the only approved one, or the currently active one if still approved.
    """

    def __init__(
        self,
        users: UserRepository,
        rides: RideRequestRepository,
        vehicles: DriverVehicleRepository,
    ) -> None:
        self._users = users
        self._rides = rides
        self._vehicles = vehicles

    async def execute(
        self,
        user: User,
        mode: UserRole,
        vehicle_type: VehicleType | None = None,
    ) -> User:
        if mode not in (UserRole.PASSENGER, UserRole.DRIVER):
            raise NotAuthorizedActionError("Modo de cuenta no disponible.")

        if mode is UserRole.DRIVER:
            approved = [v for v in await self._vehicles.list_by_user(user.id) if v.is_approved]
            if not approved:
                raise NotAuthorizedActionError("Tu registro de conductor aún no está aprobado.")
            wanted = vehicle_type or (
                approved[0].vehicle_type if len(approved) == 1 else user.vehicle_type
            )
            vehicle = next((v for v in approved if v.vehicle_type is wanted), None)
            if vehicle is None:
                raise NotAuthorizedActionError("Elige un vehículo aprobado para conducir.")
            if user.is_driver and user.vehicle_type is vehicle.vehicle_type:
                return user
            if user.is_driver and user.is_online:
                raise DriverUnavailableError("Desconéctate antes de cambiar de vehículo.")
            if await self._rides.get_active_by_rider(user.id) is not None:
                raise InvalidRideTransitionError(
                    "Termina o cancela tu viaje activo antes de cambiar a modo conductor."
                )
            if await self._has_ride_in_progress(user):
                raise InvalidRideTransitionError(
                    "Termina tu viaje en curso antes de cambiar de vehículo."
                )
            user.activate_vehicle(vehicle)
        else:
            if user.role is mode:
                return user
            if user.is_online:
                raise DriverUnavailableError("Desconéctate antes de cambiar a modo pasajero.")
            if await self._has_ride_in_progress(user):
                raise InvalidRideTransitionError(
                    "Termina tu viaje en curso antes de cambiar a modo pasajero."
                )

        user.role = mode
        return await self._users.update(user)

    async def _has_ride_in_progress(self, user: User) -> bool:
        driving = await self._rides.list_by_driver(user.id)
        return any(ride.status in _DRIVING_STATUSES for ride in driving)
