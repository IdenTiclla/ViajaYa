"""Adaptadores API que traducen resultados a publicaciones realtime durables."""

from __future__ import annotations

from app.api.v1.events import build_create_offer_events
from app.application.dto import CreateOfferResult
from app.application.interfaces import CreateOfferEventRecorder, RealtimeOutbox


class OutboxCreateOfferEventRecorder(CreateOfferEventRecorder):
    """Registra el batch de CreateOffer en la misma transacción que la oferta."""

    def __init__(self, outbox: RealtimeOutbox) -> None:
        self._outbox = outbox

    async def record(self, result: CreateOfferResult) -> None:
        await self._outbox.add_batch(build_create_offer_events(result))


class DisabledCreateOfferEventRecorder(CreateOfferEventRecorder):
    """Recorder nulo mientras el productor de outbox está deshabilitado."""

    async def record(self, result: CreateOfferResult) -> None:
        del result
