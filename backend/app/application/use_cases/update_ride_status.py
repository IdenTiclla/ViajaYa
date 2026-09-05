"""Caso de uso: el conductor avanza el estado del viaje."""

from __future__ import annotations

import uuid
from dataclasses import replace

from app.application.dto import RideDetail
from app.application.interfaces import UnitOfWork, UpdateRideStatusEventRecorder
from app.domain.entities import RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository, UserRepository

# Transiciones que puede ejecutar el conductor asignado.
_ALLOWED_TRANSITIONS: dict[RideStatus, set[RideStatus]] = {
    RideStatus.ACCEPTED: {RideStatus.ARRIVING},
    RideStatus.ARRIVING: {RideStatus.IN_PROGRESS},
    RideStatus.IN_PROGRESS: {RideStatus.COMPLETED},
}


class UpdateRideStatus:
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

    async def execute(
        self, driver: User, ride_id: uuid.UUID, new_status: RideStatus
    ) -> RideDetail:
        try:
            detail = await self._advance(driver, ride_id, new_status)
            await self._event_recorder.record(detail)
            await self._unit_of_work.commit()
            return detail
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _advance(
        self, driver: User, ride_id: uuid.UUID, new_status: RideStatus
    ) -> RideDetail:
        if not driver.is_driver:
            raise NotAuthorizedActionError("Solo los conductores pueden avanzar el viaje.")

        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.driver_id != driver.id:
            raise NotAuthorizedActionError("No eres el conductor asignado a este viaje.")

        allowed = _ALLOWED_TRANSITIONS.get(ride.status, set())
        if new_status not in allowed:
            raise InvalidRideTransitionError(
                f"No se puede pasar de {ride.status.value} a {new_status.value}."
            )

        updated = await self._rides.update_if_state(
            replace(ride, status=new_status),
            ride.status,
            expected_paused=ride.paused,
        )
        if updated is None:
            raise InvalidRideTransitionError(
                "El viaje cambió de estado; actualiza la pantalla e inténtalo de nuevo."
            )
        rider = await self._users.get_by_id(updated.rider_id)
        if rider is None:
            raise RideNotFoundError("No se pudo enriquecer el pasajero del viaje.")
        accepted_offer = (
            await self._offers.get_by_id(updated.accepted_offer_id)
            if updated.accepted_offer_id is not None
            else None
        )
        if updated.accepted_offer_id is not None and accepted_offer is None:
            raise RideNotFoundError("No se pudo enriquecer la oferta aceptada.")
        return RideDetail(
            ride=updated,
            rider=rider,
            driver=driver,
            accepted_offer=accepted_offer,
        )
