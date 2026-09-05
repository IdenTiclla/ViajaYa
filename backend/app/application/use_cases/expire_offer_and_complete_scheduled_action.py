"""Caso de uso: vence una oferta desde la vía legacy y completa su acción."""

from __future__ import annotations

import uuid
from datetime import datetime

from app.application.dto import PendingScheduledAction
from app.application.interfaces import (
    ExpireOfferEventRecorder,
    ScheduledActionQueue,
    UnitOfWork,
)
from app.domain.entities import Offer
from app.domain.repositories import OfferRepository
from app.domain.ride_policy import offer_expires_at


class ExpireOfferAndCompleteScheduledAction:
    """Hace competir timer/barrido y worker sin dejar acciones huérfanas."""

    def __init__(
        self,
        offers: OfferRepository,
        actions: ScheduledActionQueue,
        unit_of_work: UnitOfWork,
        event_recorder: ExpireOfferEventRecorder,
    ) -> None:
        self._offers = offers
        self._actions = actions
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(
        self,
        offer_id: uuid.UUID,
        completed_at: datetime,
    ) -> Offer | None:
        try:
            offer = await self._offers.mark_expired_if_pending(offer_id)
            if offer is not None:
                # Durante un rolling deploy, la versión anterior puede crear la
                # oferta después del backfill 0022. El timer/barrido nuevo repara
                # esa fila antes de aplicar el CAS terminal.
                execute_at = offer_expires_at(offer)
                if execute_at is None:  # pragma: no cover - la BD exige created_at
                    raise RuntimeError("La oferta persistida no tiene fecha de creación.")
                await self._actions.schedule(
                    PendingScheduledAction(
                        dedupe_key=f"expire_offer:{offer_id}",
                        action_type="expire_offer",
                        aggregate_id=offer_id,
                        generation=1,
                        execute_at=execute_at,
                        payload={"offer_id": str(offer_id)},
                    )
                )
                await self._event_recorder.record(offer)
            completed = await self._actions.mark_succeeded_if_pending(
                f"expire_offer:{offer_id}",
                1,
                completed_at,
            )
            if not completed:
                # Un worker ya posee o completó la acción. También se revierte la
                # expiración local para que solo el dueño del lease confirme.
                await self._unit_of_work.rollback()
                return None
            await self._unit_of_work.commit()
            return offer
        except BaseException:
            await self._unit_of_work.rollback()
            raise
