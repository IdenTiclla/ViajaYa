"""Caso de uso: obtener el detalle de un viaje (polling de estado)."""

from __future__ import annotations

import uuid

from app.application.dto import RideDetail
from app.domain.entities import User
from app.domain.exceptions import NotAuthorizedActionError, RideNotFoundError
from app.domain.repositories import OfferRepository, RideRequestRepository, UserRepository


class GetRide:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        users: UserRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users

    async def execute(self, user: User, ride_id: uuid.UUID) -> RideDetail:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")

        is_rider = ride.rider_id == user.id
        is_driver = ride.driver_id is not None and ride.driver_id == user.id
        if not (is_rider or is_driver):
            raise NotAuthorizedActionError("No tienes acceso a este viaje.")

        driver = await self._users.get_by_id(ride.driver_id) if ride.driver_id else None
        accepted_offer = (
            await self._offers.get_by_id(ride.accepted_offer_id)
            if ride.accepted_offer_id
            else None
        )
        return RideDetail(ride=ride, driver=driver, accepted_offer=accepted_offer)
