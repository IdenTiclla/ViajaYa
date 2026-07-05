"""Caso de uso: vencer una oferta cuyo TTL (30 s) expiró.

Sirve para que el backend avise al conductor en tiempo real cuando su oferta muere
por tiempo (la tarea diferida de ``create_offer`` y el barrido del snapshot del
conductor lo invocan). Es race-safe: solo vence si la oferta seguía ``PENDING`` y
ya pasó su deadline (un accept/reject/withdraw/supersede simultáneo la saca de
``PENDING`` y aquí no se toca).
"""

from __future__ import annotations

import uuid

from app.domain.entities import Offer
from app.domain.repositories import OfferRepository


class ExpireOffer:
    def __init__(self, offers: OfferRepository) -> None:
        self._offers = offers

    async def execute(self, offer_id: uuid.UUID) -> Offer | None:
        """Marca la oferta ``EXPIRED`` si seguía ``PENDING`` y venció; devuelve la
        oferta actualizada o ``None`` si ya estaba resuelta por otra vía."""
        return await self._offers.mark_expired_if_pending(offer_id)
