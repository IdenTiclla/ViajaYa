"""Caso de uso: vencer una oferta cuyo TTL (30 s) expiró.

Sirve para que el backend avise al conductor en tiempo real cuando su oferta muere
por tiempo (la tarea diferida de ``create_offer`` y el barrido del snapshot del
conductor lo invocan). Es race-safe: solo vence si la oferta seguía ``PENDING`` y
ya pasó su deadline (un accept/reject/withdraw/supersede simultáneo la saca de
``PENDING`` y aquí no se toca).
"""

from __future__ import annotations

import uuid

from app.application.interfaces import ExpireOfferEventRecorder, UnitOfWork
from app.domain.entities import Offer
from app.domain.repositories import OfferRepository


class ExpireOffer:
    def __init__(
        self,
        offers: OfferRepository,
        unit_of_work: UnitOfWork,
        event_recorder: ExpireOfferEventRecorder,
    ) -> None:
        self._offers = offers
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, offer_id: uuid.UUID) -> Offer | None:
        """Marca la oferta ``EXPIRED`` si seguía ``PENDING`` y venció; devuelve la
        oferta actualizada o ``None`` si ya estaba resuelta por otra vía."""
        try:
            offer = await self._offers.mark_expired_if_pending(offer_id)
            if offer is None:
                await self._unit_of_work.rollback()
                return None
            await self._event_recorder.record(offer)
            await self._unit_of_work.commit()
            return offer
        except BaseException:
            await self._unit_of_work.rollback()
            raise
