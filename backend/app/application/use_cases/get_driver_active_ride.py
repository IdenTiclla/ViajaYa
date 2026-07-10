"""Caso de uso: viaje activo del conductor (para saber si ya fue elegido)."""

from __future__ import annotations

from app.application.dto import RideDetail
from app.domain.entities import RideStatus, User
from app.domain.exceptions import NotAuthorizedActionError
from app.domain.repositories import OfferRepository, RideRequestRepository, UserRepository

# Estados en los que el conductor tiene un viaje "en curso" que atender.
_ACTIVE = {RideStatus.ACCEPTED, RideStatus.ARRIVING, RideStatus.IN_PROGRESS}


class GetDriverActiveRide:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        users: UserRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users

    async def execute(self, driver: User) -> RideDetail | None:
        if not driver.is_driver:
            raise NotAuthorizedActionError("Solo los conductores tienen viajes asignados.")

        rides = await self._rides.list_by_driver(driver.id)
        active = next((r for r in rides if r.status in _ACTIVE), None)
        if active is None:
            return None

        accepted_offer = (
            await self._offers.get_by_id(active.accepted_offer_id)
            if active.accepted_offer_id
            else None
        )
        rider = await self._users.get_by_id(active.rider_id)
        return RideDetail(
            ride=active,
            rider=rider,
            driver=driver,
            accepted_offer=accepted_offer,
        )
