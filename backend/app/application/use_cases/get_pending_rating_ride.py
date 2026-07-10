"""Caso de uso: recuperar el último viaje completado pendiente de calificar."""

from __future__ import annotations

from app.application.dto import RideDetail
from app.domain.entities import User
from app.domain.repositories import (
    OfferRepository,
    PendingRatingRepository,
    UserRepository,
)


class GetPendingRatingRide:
    def __init__(
        self,
        pending_ratings: PendingRatingRepository,
        offers: OfferRepository,
        users: UserRepository,
    ) -> None:
        self._pending_ratings = pending_ratings
        self._offers = offers
        self._users = users

    async def execute(self, user: User) -> RideDetail | None:
        pending = await self._pending_ratings.get_latest_for(user.id, user.role)
        if pending is None:
            return None

        rider = (
            user
            if pending.rider_id == user.id
            else await self._users.get_by_id(pending.rider_id)
        )
        driver = None
        if pending.driver_id is not None:
            driver = (
                user
                if pending.driver_id == user.id
                else await self._users.get_by_id(pending.driver_id)
            )
        accepted_offer = (
            await self._offers.get_by_id(pending.accepted_offer_id)
            if pending.accepted_offer_id
            else None
        )
        return RideDetail(
            ride=pending,
            rider=rider,
            driver=driver,
            accepted_offer=accepted_offer,
        )
