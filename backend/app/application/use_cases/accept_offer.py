"""Caso de uso: el pasajero acepta una oferta (asignación directa del viaje).

El pasajero tiene la decisión final: aceptar una oferta ``PENDING`` asigna el
viaje a ese conductor en una transacción atómica
(:meth:`OfferRepository.accept_atomically`). Las demás ofertas vivas del viaje
quedan ``REJECTED`` y las demás ofertas vivas del conductor en otros viajes se
retiran.
"""

from __future__ import annotations

import uuid

from app.application.dto import AcceptOfferResult, RideDetail
from app.domain.entities import OfferStatus, RideStatus, User
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    OfferNotFoundError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository
from app.domain.ride_policy import is_offer_expired


class AcceptOffer:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(self, rider: User, offer_id: uuid.UUID) -> AcceptOfferResult:
        offer = await self._offers.get_by_id(offer_id)
        if offer is None:
            raise OfferNotFoundError("La oferta no existe.")

        ride = await self._rides.get_by_id(offer.ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No puedes aceptar ofertas de este viaje.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError("El viaje ya no está buscando conductor.")
        if offer.status is not OfferStatus.PENDING:
            raise InvalidRideTransitionError("La oferta ya no está disponible.")
        if is_offer_expired(offer):
            raise InvalidRideTransitionError("La oferta expiró; elige otra.")

        # Asignación atómica: re-verifica bajo lock que la oferta siga PENDING,
        # el viaje SEARCHING y el conductor libre. Si algo cambió (race con
        # cancel, oferta retirada o un accept previo), devuelve None → 409.
        acceptance = await self._offers.accept_atomically(offer_id)
        if acceptance is None:
            raise DriverUnavailableError("El viaje ya no está disponible.")

        return AcceptOfferResult(
            detail=RideDetail(
                ride=acceptance.ride,
                driver=acceptance.driver,
                accepted_offer=acceptance.accepted_offer,
            ),
            withdrawn_ride_ids=acceptance.withdrawn_ride_ids,
            losing_driver_ids=acceptance.losing_driver_ids,
        )
