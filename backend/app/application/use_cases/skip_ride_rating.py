"""Caso de uso: cerrar un viaje completado sin emitir calificación."""

from __future__ import annotations

import uuid

from app.domain.entities import RideRatingSkip, RideStatus, User
from app.domain.exceptions import (
    NotAuthorizedActionError,
    RideNotCompletedError,
    RideNotFoundError,
)
from app.domain.repositories import RatingSkipRepository, RideRequestRepository


class SkipRideRating:
    def __init__(
        self,
        rides: RideRequestRepository,
        skips: RatingSkipRepository,
    ) -> None:
        self._rides = rides
        self._skips = skips

    async def execute(self, user: User, ride_id: uuid.UUID) -> RideRatingSkip:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.status is not RideStatus.COMPLETED:
            raise RideNotCompletedError("Solo se puede omitir un viaje completado.")

        is_rider = ride.rider_id == user.id
        is_driver = ride.driver_id is not None and ride.driver_id == user.id
        if not (is_rider or is_driver):
            raise NotAuthorizedActionError("No participaste en este viaje.")

        return await self._skips.add_if_absent(
            RideRatingSkip(ride_id=ride.id, rater_id=user.id)
        )
