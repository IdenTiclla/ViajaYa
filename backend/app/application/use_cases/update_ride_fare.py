"""Caso de uso: el pasajero aumenta la oferta de su solicitud en curso.

Mientras la solicitud sigue ``SEARCHING`` (buscando conductores indefinidamente),
el pasajero puede subir su oferta para recibir ofertas más rápido. Solo se permite
**aumentar** el monto, nunca bajarlo.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from decimal import Decimal

from app.domain.entities import RideRequest, RideStatus, User
from app.domain.exceptions import (
    InvalidFareError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import RideRequestRepository
from app.domain.value_objects import FareOffer


class UpdateRideFare:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(self, user: User, ride_id: uuid.UUID, new_fare: Decimal) -> RideRequest:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != user.id:
            raise NotAuthorizedActionError("No eres el dueño de esta solicitud.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError(
                "Solo puedes aumentar la oferta mientras se buscan conductores."
            )
        if ride.paused:
            raise InvalidRideTransitionError(
                "No puedes aumentar la oferta mientras modificas la solicitud."
            )

        # Valida positividad (regla de dominio) y que sea un aumento real.
        fare = FareOffer(new_fare)
        if fare.amount <= ride.fare:
            raise InvalidFareError("La nueva oferta debe ser mayor que la actual.")

        updated = await self._rides.update_if_state(
            replace(ride, fare=fare.amount),
            RideStatus.SEARCHING,
            expected_paused=False,
            expected_fare=ride.fare,
        )
        if updated is None:
            raise InvalidRideTransitionError(
                "La oferta cambió; actualiza la pantalla antes de aumentarla de nuevo."
            )
        return updated
