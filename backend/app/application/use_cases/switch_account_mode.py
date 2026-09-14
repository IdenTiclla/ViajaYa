"""Use case: an approved driver switches between passenger and driver mode."""

from __future__ import annotations

from app.domain.entities import RideStatus, User, UserRole
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
)
from app.domain.repositories import RideRequestRepository, UserRepository

_DRIVING_STATUSES = {RideStatus.ACCEPTED, RideStatus.ARRIVING, RideStatus.IN_PROGRESS}


class SwitchAccountMode:
    """``role`` is the active mode; an account is never passenger and driver at once."""

    def __init__(self, users: UserRepository, rides: RideRequestRepository) -> None:
        self._users = users
        self._rides = rides

    async def execute(self, user: User, mode: UserRole) -> User:
        if mode not in (UserRole.PASSENGER, UserRole.DRIVER):
            raise NotAuthorizedActionError("Modo de cuenta no disponible.")
        if user.role is mode:
            return user

        if mode is UserRole.DRIVER:
            if not user.is_approved_driver:
                raise NotAuthorizedActionError("Tu registro de conductor aún no está aprobado.")
            if await self._rides.get_active_by_rider(user.id) is not None:
                raise InvalidRideTransitionError(
                    "Termina o cancela tu viaje activo antes de cambiar a modo conductor."
                )
        else:
            if user.is_online:
                raise DriverUnavailableError("Desconéctate antes de cambiar a modo pasajero.")
            driving = await self._rides.list_by_driver(user.id)
            if any(ride.status in _DRIVING_STATUSES for ride in driving):
                raise InvalidRideTransitionError(
                    "Termina tu viaje en curso antes de cambiar a modo pasajero."
                )

        user.role = mode
        return await self._users.update(user)
