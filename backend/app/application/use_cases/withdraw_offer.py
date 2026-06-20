"""Caso de uso: el conductor retira su propia oferta.

Cubre dos gestos de la app del conductor: "retirar propuesta" mientras espera
(``PENDING``) y "rechazar" una aceptación del pasajero que no quiere confirmar
(``RIDER_ACCEPTED``). En ambos casos la oferta muere y el pasajero deja de verla.
"""

from __future__ import annotations

import uuid

from app.domain.entities import ACTIVE_OFFER_STATUSES, Offer, OfferStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    OfferNotFoundError,
)
from app.domain.repositories import OfferRepository


class WithdrawOffer:
    def __init__(self, offers: OfferRepository) -> None:
        self._offers = offers

    async def execute(self, driver: User, offer_id: uuid.UUID) -> Offer:
        offer = await self._offers.get_by_id(offer_id)
        if offer is None:
            raise OfferNotFoundError("La oferta no existe.")
        if offer.driver_id != driver.id:
            raise NotAuthorizedActionError("Solo puedes retirar tus propias ofertas.")
        if offer.status not in ACTIVE_OFFER_STATUSES:
            raise InvalidRideTransitionError("La oferta ya no está activa.")

        offer.status = OfferStatus.REJECTED
        return await self._offers.update(offer)
