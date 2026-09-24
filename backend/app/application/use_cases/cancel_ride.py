"""Caso de uso: cancelar un viaje (pasajero o conductor asignado)."""

from __future__ import annotations

import uuid

from app.application.dto import CancelRideResult, RideDetail
from app.application.interfaces import CancelRideEventRecorder, UnitOfWork
from app.domain.entities import RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository, UserRepository

# Statuses from which a ride can still be cancelled (before it starts).
_CANCELLABLE = {RideStatus.SEARCHING, RideStatus.ACCEPTED, RideStatus.ARRIVING}


class CancelRide:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        users: UserRepository,
        unit_of_work: UnitOfWork,
        event_recorder: CancelRideEventRecorder,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, user: User, ride_id: uuid.UUID) -> CancelRideResult:
        try:
            result = await self._mutate(user, ride_id)
            await self._event_recorder.record(result)
            await self._unit_of_work.commit()
            return result
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _mutate(self, user: User, ride_id: uuid.UUID) -> CancelRideResult:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")

        is_rider = ride.rider_id == user.id
        is_driver = ride.driver_id is not None and ride.driver_id == user.id
        if not (is_rider or is_driver):
            raise NotAuthorizedActionError("No puedes cancelar este viaje.")

        if ride.status not in _CANCELLABLE:
            raise InvalidRideTransitionError("El viaje ya no se puede cancelar.")

        transition = await self._offers.cancel_ride_atomically(
            ride_id,
            expected_status=ride.status,
            expected_paused=ride.paused,
        )
        if transition is None:
            raise InvalidRideTransitionError(
                "El viaje cambió de estado y ya no se puede cancelar."
            )
        rider = await self._users.get_by_id(transition.ride.rider_id)
        if rider is None:
            raise RideNotFoundError("No se pudo enriquecer el pasajero del viaje.")
        driver = (
            await self._users.get_by_id(transition.ride.driver_id)
            if transition.ride.driver_id is not None
            else None
        )
        if transition.ride.driver_id is not None and driver is None:
            raise RideNotFoundError("No se pudo enriquecer el conductor del viaje.")
        accepted_offer = (
            await self._offers.get_by_id(transition.ride.accepted_offer_id)
            if transition.ride.accepted_offer_id is not None
            else None
        )
        if transition.ride.accepted_offer_id is not None and accepted_offer is None:
            raise RideNotFoundError("No se pudo enriquecer la oferta aceptada.")
        return CancelRideResult(
            detail=RideDetail(
                ride=transition.ride,
                rider=rider,
                driver=driver,
                accepted_offer=accepted_offer,
            ),
            cancelled_offers=transition.affected_offers,
        )
