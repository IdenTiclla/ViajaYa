"""Caso de uso: cancelar una búsqueda abandonada tras la gracia de presencia."""

from __future__ import annotations

import uuid

from app.application.dto import CancelRideResult
from app.domain.repositories import OfferRepository


class CancelRideOnDisconnect:
    def __init__(self, offers: OfferRepository) -> None:
        self._offers = offers

    async def execute(self, ride_id: uuid.UUID) -> CancelRideResult | None:
        result = await self._offers.cancel_ride_on_disconnect_atomically(ride_id)
        if result is None:
            return None
        return CancelRideResult(
            ride=result.ride,
            cancelled_offers=result.cancelled_offers,
        )
