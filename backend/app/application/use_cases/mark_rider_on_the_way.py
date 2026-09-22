"""Notify the assigned driver that the passenger is walking to the pickup point."""

from __future__ import annotations

import uuid

from app.application.dto import RideDetail
from app.application.interfaces import UnitOfWork, UpdateRideStatusEventRecorder
from app.domain.entities import ServiceType, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository, UserRepository


class MarkRiderOnTheWay:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        users: UserRepository,
        unit_of_work: UnitOfWork,
        event_recorder: UpdateRideStatusEventRecorder,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, rider: User, ride_id: uuid.UUID) -> RideDetail:
        try:
            ride = await self._rides.get_by_id(ride_id)
            if ride is None:
                raise RideNotFoundError("La solicitud de viaje no existe.")
            if ride.rider_id != rider.id:
                raise NotAuthorizedActionError("Solo el pasajero puede enviar este aviso.")
            if ride.service_type not in (ServiceType.TAXI, ServiceType.MOTO):
                raise InvalidRideTransitionError("Este aviso es para viajes de taxi o mototaxi.")
            result = await self._rides.mark_rider_on_the_way_if_arriving(ride_id, rider.id)
            if result is None:
                raise InvalidRideTransitionError(
                    "Puedes avisar que saliste cuando tu conductor haya llegado. "
                    "Actualiza el estado del viaje."
                )
            updated, changed = result
            driver = await self._users.get_by_id(updated.driver_id) if updated.driver_id else None
            offer = (
                await self._offers.get_by_id(updated.accepted_offer_id)
                if updated.accepted_offer_id
                else None
            )
            if driver is None or offer is None:
                raise RideNotFoundError("No se pudo recuperar el conductor asignado.")
            detail = RideDetail(ride=updated, rider=rider, driver=driver, accepted_offer=offer)
            if changed:
                await self._event_recorder.record(detail)
            await self._unit_of_work.commit()
            return detail
        except BaseException:
            await self._unit_of_work.rollback()
            raise
