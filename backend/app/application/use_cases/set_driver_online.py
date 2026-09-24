"""Use case: the driver toggles their availability (online/offline)."""

from __future__ import annotations

from app.application.dto import DriverAvailabilityResult
from app.application.interfaces import DriverAvailabilityEventRecorder, UnitOfWork
from app.domain.entities import User
from app.domain.exceptions import DriverUnavailableError, NotAuthorizedActionError
from app.domain.repositories import OfferRepository, UserRepository


class SetDriverOnline:
    def __init__(
        self,
        users: UserRepository,
        offers: OfferRepository,
        unit_of_work: UnitOfWork,
        event_recorder: DriverAvailabilityEventRecorder,
    ) -> None:
        self._users = users
        self._offers = offers
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, driver: User, is_online: bool) -> DriverAvailabilityResult:
        try:
            result = await self._set(driver, is_online)
            await self._event_recorder.record(result)
            await self._unit_of_work.commit()
            return result
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _set(
        self, driver: User, is_online: bool
    ) -> DriverAvailabilityResult:
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
