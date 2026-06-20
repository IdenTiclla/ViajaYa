"""Caso de uso: un conductor crea una oferta (aceptar, contraofertar o mejorar).

Si el conductor ya tiene una oferta ``PENDING`` en el viaje, la nueva la
**reemplaza** (mejorar la oferta): la anterior pasa a ``REJECTED`` y se devuelve
su id para que la capa API retire la tarjeta vieja de la pantalla del pasajero.
"""

from __future__ import annotations

import uuid

from app.application.dto import CreateOfferInput, CreateOfferResult, OfferDetail
from app.domain.entities import Offer, OfferStatus, RideStatus, User
from app.domain.exceptions import (
    InvalidFareError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository
from app.domain.value_objects import FareOffer


class CreateOffer:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(
        self, driver: User, ride_id: uuid.UUID, data: CreateOfferInput
    ) -> CreateOfferResult:
        if not driver.is_driver or driver.vehicle_type is None:
            raise NotAuthorizedActionError("Solo los conductores con vehículo pueden ofertar.")

        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError("La solicitud ya no admite ofertas.")
        if ride.service_type is not driver.vehicle_type:
            raise NotAuthorizedActionError(
                "Tu vehículo no coincide con el servicio solicitado."
            )

        if data.accept_at_fare:
            # Aceptar al precio del pasajero.
            price = ride.fare
        else:
            # Contraoferta: precio propio validado (> 0).
            if data.price is None:
                raise InvalidFareError("La contraoferta requiere un precio.")
            price = FareOffer(data.price).amount

        # ¿Mejora? Si ya hay una oferta viva del conductor en este viaje, la nueva
        # la reemplaza: la anterior pasa a REJECTED y se devuelve su id para que la
        # capa API retire la tarjeta vieja de la pantalla del pasajero.
        superseded_offer_id: uuid.UUID | None = None
        previous = await self._offers.get_active_by_driver_and_ride(ride.id, driver.id)
        if previous is not None:
            previous.status = OfferStatus.REJECTED
            await self._offers.update(previous)
            superseded_offer_id = previous.id

        offer = Offer(
            ride_id=ride.id,
            driver_id=driver.id,
            price=price,
            eta_min=data.eta_min,
        )
        created = await self._offers.add(offer)
        return CreateOfferResult(
            detail=OfferDetail(offer=created, driver=driver),
            superseded_offer_id=superseded_offer_id,
        )
