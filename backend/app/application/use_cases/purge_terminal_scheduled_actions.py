"""Caso de uso: elimina acciones programadas terminales ya retenidas."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.application.interfaces import TerminalScheduledActionsRetention, UnitOfWork


class PurgeTerminalScheduledActions:
    """Apply retention only to successes and cancellations; keep ``dead`` failures."""

    def __init__(
        self,
        retention: TerminalScheduledActionsRetention,
        unit_of_work: UnitOfWork,
    ) -> None:
        self._retention = retention
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        now: datetime,
        *,
        retention_days: int,
        action_limit: int,
    ) -> int:
        if retention_days <= 0:
            raise ValueError("Action retention must be greater than zero.")
        if action_limit <= 0:
            raise ValueError("The action limit must be positive.")

        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)
        else:
            now = now.astimezone(UTC)
        cutoff = now - timedelta(days=retention_days)
        try:
            deleted_count = await self._retention.purge(cutoff, action_limit)
            await self._unit_of_work.commit()
            return deleted_count
        except BaseException:
            await self._unit_of_work.rollback()
            raise
