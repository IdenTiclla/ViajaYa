"""Caso de uso: el pasajero guarda los cambios de una solicitud pausada (Modificar).

Sobrescribe origen, destino, servicio, monto y método de pago de una solicitud que
estaba ``paused`` y la vuelve a publicar (``paused=False``) para que reaparezca en
el pool de conductores. Re-valida coordenadas y monto (reglas de dominio).
"""

from __future__ import annotations

import uuid
from dataclasses import replace

from app.application.dto import (
    CreateRideRequestInput,
    RideDetail,
    RideRepublishedResult,
)
from app.application.interfaces import RepublishRideEventRecorder, UnitOfWork
from app.domain.entities import Location, RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OpenRideDetail, RideRequestRepository
from app.domain.value_objects import FareOffer, ServiceAreaPoint


class EditRide:
    def __init__(
        self,
        rides: RideRequestRepository,
        unit_of_work: UnitOfWork,
        event_recorder: RepublishRideEventRecorder,
    ) -> None:
        self._rides = rides
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(
        self,
        rider: User,
        ride_id: uuid.UUID,
        data: CreateRideRequestInput,
    ) -> RideRepublishedResult:
        try:
            result = await self._mutate(rider, ride_id, data)
            await self._event_recorder.record(result)
            await self._unit_of_work.commit()
            return result
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _mutate(
        self,
        rider: User,
        ride_id: uuid.UUID,
        data: CreateRideRequestInput,
    ) -> RideRepublishedResult:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No eres el dueño de esta solicitud.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError(
                "Solo puedes modificar la solicitud mientras se buscan conductores."
            )
        if not ride.paused:
            raise InvalidRideTransitionError(
                "Debes pausar la solicitud antes de editarla."
            )

        # Re-valida país operativo, coordenadas y monto positivo.
        origin_point = ServiceAreaPoint(
            data.origin.latitude, data.origin.longitude, data.origin.country_code
        )
        destination_point = ServiceAreaPoint(
            data.destination.latitude,
            data.destination.longitude,
            data.destination.country_code,
        )
        fare = FareOffer(data.fare)

        origin = Location(
            latitude=origin_point.latitude,
            longitude=origin_point.longitude,
            name=data.origin.name.strip(),
            address=data.origin.address.strip(),
        )
        destination = Location(
            latitude=destination_point.latitude,
            longitude=destination_point.longitude,
            name=data.destination.name.strip(),
            address=data.destination.address.strip(),
        )
        updated = await self._rides.update_if_state(
            replace(
                ride,
                origin=origin,
                destination=destination,
                service_type=data.service_type,
                fare=fare.amount,
                payment_method=data.payment_method,
                paused=False,
                # Cada reapertura es una publicación nueva, aunque el pasajero
                # guarde sin cambiar campos visibles. El cierre anterior y el
                # nuevo anuncio deben ser comparables incluso si cruzan pools.
                pool_version=ride.pool_version + 1,
            ),
            RideStatus.SEARCHING,
            expected_paused=True,
        )
        if updated is None:
            raise InvalidRideTransitionError(
                "La solicitud cambió de estado y ya no se puede guardar."
            )
        open_detail = await self._rides.open_ride_with_rider(ride_id)
        if open_detail is None:
            raise RideNotFoundError("No se pudo enriquecer la solicitud actualizada.")
        return RideRepublishedResult(
            detail=RideDetail(ride=updated, rider=rider),
            open_detail=OpenRideDetail(
                ride=updated,
                rider=open_detail.rider,
            ),
        )
