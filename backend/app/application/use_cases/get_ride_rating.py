"""Read the current participant's persisted rating for one completed ride."""

from __future__ import annotations

import uuid

from app.domain.entities import RideRating, RideStatus, User
from app.domain.exceptions import (
    NotAuthorizedActionError,
    RideNotCompletedError,
    RideNotFoundError,
)
from app.domain.repositories import RatingRepository, RideRequestRepository


class GetRideRating:
    def __init__(self, rides: RideRequestRepository, ratings: RatingRepository) -> None:
        self._rides = rides
        self._ratings = ratings

    async def execute(self, user: User, ride_id: uuid.UUID) -> RideRating | None:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if user.id not in (ride.rider_id, ride.driver_id):
            raise NotAuthorizedActionError("No participaste en este viaje.")
        if ride.status is not RideStatus.COMPLETED:
            raise RideNotCompletedError("Solo se puede calificar un viaje completado.")
        return await self._ratings.get_by_ride_and_rater(ride_id, user.id)
