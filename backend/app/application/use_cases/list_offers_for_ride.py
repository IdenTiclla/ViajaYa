"""Caso de uso: el pasajero lista las ofertas vivas de su viaje.

Incluye las ofertas ``PENDING`` (esperando decisión del pasajero) cuya ventana
de tiempo (30 s) siga vigente.
"""

from __future__ import annotations

import uuid

from app.application.dto import OfferDetail
from app.domain.entities import User
from app.domain.exceptions import NotAuthorizedActionError, RideNotFoundError
from app.domain.repositories import OfferRepository, RideRequestRepository, UserRepository
from app.domain.ride_policy import is_offer_active


class ListOffersForRide:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        users: UserRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users

    async def execute(self, rider: User, ride_id: uuid.UUID) -> list[OfferDetail]:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No puedes ver las ofertas de este viaje.")

        offers = await self._offers.list_by_ride(ride_id)
        details: list[OfferDetail] = []
        for offer in offers:
            # Solo ofertas vivas: PENDING y sin vencer.
            if not is_offer_active(offer):
                continue
            driver = await self._users.get_by_id(offer.driver_id)
            if driver is None:  # pragma: no cover - integridad referencial
                continue
            details.append(OfferDetail(offer=offer, driver=driver))
        return details
