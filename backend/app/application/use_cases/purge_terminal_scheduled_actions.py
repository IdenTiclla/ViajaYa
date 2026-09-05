"""Caso de uso: elimina acciones programadas terminales ya retenidas."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.application.interfaces import TerminalScheduledActionsRetention, UnitOfWork


class PurgeTerminalScheduledActions:
    """Aplica retención solo a éxitos y cancelaciones; conserva fallos ``dead``."""

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
            raise ValueError("La retención de acciones debe ser mayor a cero.")
        if action_limit <= 0:
            raise ValueError("El límite de acciones debe ser positivo.")

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
