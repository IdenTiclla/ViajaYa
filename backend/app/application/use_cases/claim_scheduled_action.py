"""Caso de uso: reclamar una acción programada mediante un lease durable."""

from __future__ import annotations

from datetime import datetime

from app.application.dto import ScheduledAction
from app.application.interfaces import ScheduledActionQueue, UnitOfWork


class ClaimScheduledAction:
    def __init__(self, actions: ScheduledActionQueue, unit_of_work: UnitOfWork) -> None:
        self._actions = actions
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        now: datetime,
        stale_before: datetime,
    ) -> ScheduledAction | None:
        try:
            action = await self._actions.claim_due(now, stale_before)
            if action is None:
                await self._unit_of_work.rollback()
                return None
            await self._unit_of_work.commit()
            return action
        except BaseException:
            await self._unit_of_work.rollback()
            raise
