"""Caso de uso: el pasajero guarda los cambios de una solicitud pausada (Modificar).

Sobrescribe origen, destino, servicio, monto y método de pago de una solicitud que
estaba ``paused`` y la vuelve a publicar (``paused=False``) para que reaparezca en
el pool de conductores. Re-valida coordenadas y monto (reglas de dominio).
"""

from __future__ import annotations

import uuid

from app.application.dto import CreateRideRequestInput
from app.domain.entities import Location, RideRequest, RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import RideRequestRepository
from app.domain.value_objects import FareOffer, GeoPoint


class EditRide:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(
        self,
        rider: User,
        ride_id: uuid.UUID,
        data: CreateRideRequestInput,
    ) -> RideRequest:
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

        # Re-valida reglas de dominio (rango de coordenadas y monto positivo).
        origin_point = GeoPoint(data.origin.latitude, data.origin.longitude)
        destination_point = GeoPoint(data.destination.latitude, data.destination.longitude)
        fare = FareOffer(data.fare)

        ride.origin = Location(
            latitude=origin_point.latitude,
            longitude=origin_point.longitude,
            name=data.origin.name.strip(),
            address=data.origin.address.strip(),
        )
        ride.destination = Location(
            latitude=destination_point.latitude,
            longitude=destination_point.longitude,
            name=data.destination.name.strip(),
            address=data.destination.address.strip(),
        )
        ride.service_type = data.service_type
        ride.fare = fare.amount
        ride.payment_method = data.payment_method
        ride.paused = False
        return await self._rides.update(ride)
