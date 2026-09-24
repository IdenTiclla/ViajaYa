"""Use case: expire an offer through the legacy path and complete its action."""

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
    """Let the timer/sweep and the worker race without leaving orphaned actions."""

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
                # During a rolling deploy, the previous version may create the
                # offer after the 0022 backfill. The new timer/sweep repairs
                # that row before applying the terminal CAS.
                execute_at = offer_expires_at(offer)
                if execute_at is None:  # pragma: no cover - la BD exige created_at
                    raise RuntimeError("The persisted offer has no creation date.")
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
                # A worker already owns or completed the action. The local expiry is
                # also rolled back so that only the lease owner confirms it.
                await self._unit_of_work.rollback()
                return None
            await self._unit_of_work.commit()
            return offer
        except BaseException:
            await self._unit_of_work.rollback()
            raise
