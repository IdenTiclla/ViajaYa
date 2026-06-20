"""Caso de uso: historial de viajes del usuario (pasajero o conductor)."""

from __future__ import annotations

from app.application.dto import RideHistoryItem
from app.domain.entities import RideStatus, User
from app.domain.repositories import (
    OfferRepository,
    RatingRepository,
    RideRequestRepository,
    UserRepository,
)

# Estados terminales que aparecen en el historial.
_TERMINAL = {RideStatus.COMPLETED, RideStatus.CANCELLED}


class ListRideHistory:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        users: UserRepository,
        ratings: RatingRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users
        self._ratings = ratings

    async def execute(
        self, user: User, status: RideStatus | None = None
    ) -> list[RideHistoryItem]:
        statuses = {status} if status in _TERMINAL else set(_TERMINAL)
        rides = await self._rides.list_history(user.id, user.role, statuses)

        items: list[RideHistoryItem] = []
        for ride in rides:
            # Precio acordado: oferta aceptada o, en su defecto, el fare ofertado.
            price = ride.fare
            if ride.accepted_offer_id is not None:
                offer = await self._offers.get_by_id(ride.accepted_offer_id)
                if offer is not None:
                    price = offer.price

            # La contraparte: conductor (vista pasajero) o pasajero (vista conductor).
            if user.is_driver:
                counterpart = await self._users.get_by_id(ride.rider_id)
            else:
                counterpart = (
                    await self._users.get_by_id(ride.driver_id) if ride.driver_id else None
                )

            rating = await self._ratings.get_by_ride_and_rater(ride.id, user.id)
            items.append(
                RideHistoryItem(
                    ride=ride,
                    counterpart=counterpart,
                    price=price,
                    my_rating=rating.score if rating else None,
                )
            )
        return items
