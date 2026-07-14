"""Caso de uso: recuperar el viaje vigente del pasajero."""

from __future__ import annotations

from app.application.dto import RideDetail
from app.domain.entities import User, UserRole
from app.domain.exceptions import NotAuthorizedActionError
from app.domain.repositories import OfferRepository, RideRequestRepository, UserRepository


class GetPassengerActiveRide:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        users: UserRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users

    async def execute(self, passenger: User) -> RideDetail | None:
        if passenger.role is not UserRole.PASSENGER:
            raise NotAuthorizedActionError("Solo los pasajeros tienen solicitudes activas.")

        ride = await self._rides.get_active_by_rider(passenger.id)
        if ride is None:
            return None

        driver = await self._users.get_by_id(ride.driver_id) if ride.driver_id else None
        accepted_offer = (
            await self._offers.get_by_id(ride.accepted_offer_id)
            if ride.accepted_offer_id
            else None
        )
        return RideDetail(
            ride=ride,
            rider=passenger,
            driver=driver,
            accepted_offer=accepted_offer,
        )
