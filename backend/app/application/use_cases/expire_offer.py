"""Use case: expire an offer whose TTL (30 s) has run out.

It lets the backend notify the driver in real time when their offer dies
of old age (the deferred ``create_offer`` task and the driver snapshot sweep
invoke it). It is race-safe: it only expires the offer if it was still ``PENDING`` and
past its deadline (a simultaneous accept/reject/withdraw/supersede takes it out of
``PENDING`` and it is not touched here).
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
        """Mark the offer ``EXPIRED`` if it was still ``PENDING`` and past due; return the
        updated offer, or ``None`` if it was already resolved another way.
        """
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
