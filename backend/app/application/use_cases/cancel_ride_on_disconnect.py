"""Use case: cancel an abandoned search after the presence grace period."""

from __future__ import annotations

import uuid

from app.application.dto import CancelRideResult, RideDetail
from app.application.interfaces import CancelRideEventRecorder, UnitOfWork
from app.domain.exceptions import RideNotFoundError
from app.domain.repositories import OfferRepository, UserRepository


class CancelRideOnDisconnect:
    def __init__(
        self,
        offers: OfferRepository,
        users: UserRepository,
        unit_of_work: UnitOfWork,
        event_recorder: CancelRideEventRecorder,
    ) -> None:
        self._offers = offers
        self._users = users
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, ride_id: uuid.UUID) -> CancelRideResult | None:
        try:
            result = await self._mutate(ride_id)
            if result is None:
                await self._unit_of_work.rollback()
                return None
            await self._event_recorder.record(result)
            await self._unit_of_work.commit()
            return result
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _mutate(self, ride_id: uuid.UUID) -> CancelRideResult | None:
        transition = await self._offers.cancel_ride_on_disconnect_atomically(ride_id)
        if transition is None:
            return None
        rider = await self._users.get_by_id(transition.ride.rider_id)
        if rider is None:
            raise RideNotFoundError("No se pudo enriquecer el pasajero del viaje.")
        return CancelRideResult(
            detail=RideDetail(ride=transition.ride, rider=rider),
            cancelled_offers=transition.cancelled_offers,
        )
