"""Caso de uso: el pasajero aumenta la oferta de su solicitud en curso.

Mientras la solicitud sigue ``SEARCHING`` (buscando conductores indefinidamente),
el pasajero puede subir su oferta para recibir ofertas más rápido. Solo se permite
**aumentar** el monto, nunca bajarlo.
"""

from __future__ import annotations

import uuid
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

        # Valida positividad (regla de dominio) y que sea un aumento real.
        fare = FareOffer(new_fare)
        if fare.amount <= ride.fare:
            raise InvalidFareError("La nueva oferta debe ser mayor que la actual.")

        ride.fare = fare.amount
        return await self._rides.update(ride)
