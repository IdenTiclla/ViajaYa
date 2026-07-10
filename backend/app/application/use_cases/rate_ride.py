"""Caso de uso: calificar al otro participante tras completarse el viaje."""

from __future__ import annotations

import uuid

from app.domain.entities import RideRating, RideStatus, User
from app.domain.exceptions import (
    AlreadyRatedError,
    InvalidRatingError,
    NotAuthorizedActionError,
    RideNotCompletedError,
    RideNotFoundError,
)
from app.domain.repositories import (
    RatingRepository,
    RideRequestRepository,
)


class RateRide:
    def __init__(
        self,
        rides: RideRequestRepository,
        ratings: RatingRepository,
    ) -> None:
        self._rides = rides
        self._ratings = ratings

    async def execute(
        self, user: User, ride_id: uuid.UUID, score: int, comment: str | None = None
    ) -> RideRating:
        if not 1 <= score <= 5:
            raise InvalidRatingError("La calificación debe estar entre 1 y 5.")

        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.status is not RideStatus.COMPLETED:
            raise RideNotCompletedError("Solo se puede calificar un viaje completado.")

        is_rider = ride.rider_id == user.id
        is_driver = ride.driver_id is not None and ride.driver_id == user.id
        if not (is_rider or is_driver):
            raise NotAuthorizedActionError("No participaste en este viaje.")

        # El pasajero califica al conductor; el conductor al pasajero.
        ratee_id = ride.driver_id if is_rider else ride.rider_id
        if ratee_id is None:  # pragma: no cover - un viaje completado siempre tiene conductor
            raise RideNotCompletedError("El viaje no tiene conductor asignado.")

        rating = RideRating(
            ride_id=ride_id,
            rater_id=user.id,
            ratee_id=ratee_id,
            score=score,
            comment=comment,
        )
        saved = await self._ratings.add_and_recompute(rating)
        if saved is None:
            raise AlreadyRatedError("Ya calificaste este viaje.")

        return saved
