"""Caso de uso: el conductor alterna su disponibilidad (en línea/desconectado)."""

from __future__ import annotations

from app.application.dto import DriverAvailabilityResult
from app.domain.entities import User
from app.domain.exceptions import DriverUnavailableError, NotAuthorizedActionError
from app.domain.repositories import OfferRepository, UserRepository


class SetDriverOnline:
    def __init__(self, users: UserRepository, offers: OfferRepository) -> None:
        self._users = users
        self._offers = offers

    async def execute(self, driver: User, is_online: bool) -> DriverAvailabilityResult:
        if not driver.is_driver:
            raise NotAuthorizedActionError(
                "Solo los conductores pueden cambiar su disponibilidad."
            )
        if is_online:
            updated = await self._users.set_online(driver.id, True)
            return DriverAvailabilityResult(driver=updated, withdrawn_offers=[])

        transition = await self._offers.set_driver_offline_atomically(driver.id)
        if transition is None:
            raise DriverUnavailableError(
                "No puedes desconectarte mientras tienes un viaje activo."
            )
        return DriverAvailabilityResult(
            driver=transition.driver,
            withdrawn_offers=transition.withdrawn_offers,
        )
