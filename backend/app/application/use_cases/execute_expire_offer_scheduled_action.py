"""Use case: expire an offer and complete its action in a single UoW."""

from __future__ import annotations

from datetime import datetime

from app.application.dto import (
    ExecuteExpireOfferScheduledActionResult,
    ScheduledAction,
)
from app.application.exceptions import InvalidScheduledActionError
from app.application.interfaces import (
    ExpireOfferEventRecorder,
    ScheduledActionQueue,
    UnitOfWork,
)
from app.domain.repositories import OfferRepository


class ExecuteExpireOfferScheduledAction:
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
        action: ScheduledAction,
        completed_at: datetime,
    ) -> ExecuteExpireOfferScheduledActionResult:
        if (
            action.action_type != "expire_offer"
            or action.payload != {"offer_id": str(action.aggregate_id)}
            or action.lock_token is None
        ):
            raise InvalidScheduledActionError(
                "La acción expire_offer no coincide con su agregado."
            )
        try:
            offer = await self._offers.mark_expired_if_pending(action.aggregate_id)
            if offer is not None:
                await self._event_recorder.record(offer)
            completed = await self._actions.mark_succeeded(
                action.id,
                action.generation,
                action.lock_token,
                completed_at,
            )
            if not completed:
                await self._unit_of_work.rollback()
                return ExecuteExpireOfferScheduledActionResult(status="lost_lease")
            await self._unit_of_work.commit()
            return ExecuteExpireOfferScheduledActionResult(
                status="succeeded",
                expired_offer=offer,
            )
        except BaseException:
            await self._unit_of_work.rollback()
            raise
