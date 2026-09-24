"""Use case: the driver withdraws their own pending offer.

The driver gives up a ``PENDING`` offer (they no longer want that ride, or they
wanted to improve it with another one). The offer dies (it becomes ``REJECTED``) and the passenger
stops seeing it live over WebSocket.
"""

from __future__ import annotations

import uuid

from app.application.interfaces import UnitOfWork, WithdrawOfferEventRecorder
from app.domain.entities import ACTIVE_OFFER_STATUSES, Offer, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    OfferNotFoundError,
)
from app.domain.repositories import OfferRepository


class WithdrawOffer:
    def __init__(
        self,
        offers: OfferRepository,
        unit_of_work: UnitOfWork,
        event_recorder: WithdrawOfferEventRecorder,
    ) -> None:
        self._offers = offers
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, driver: User, offer_id: uuid.UUID) -> Offer:
        try:
            offer = await self._withdraw(driver, offer_id)
            await self._event_recorder.record(offer)
            await self._unit_of_work.commit()
            return offer
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _withdraw(self, driver: User, offer_id: uuid.UUID) -> Offer:
        offer = await self._offers.get_by_id(offer_id)
        if offer is None:
            raise OfferNotFoundError("La oferta no existe.")
        if offer.driver_id != driver.id:
            raise NotAuthorizedActionError("Solo puedes retirar tus propias ofertas.")
        if offer.status not in ACTIVE_OFFER_STATUSES:
            raise InvalidRideTransitionError("La oferta ya no está activa.")

        withdrawn = await self._offers.reject_if_pending(offer.id)
        if withdrawn is None:
            raise InvalidRideTransitionError("La oferta ya no está activa.")
        return withdrawn
