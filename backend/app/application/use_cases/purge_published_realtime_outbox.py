"""Caso de uso: elimina batches publicados después de su retención."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.application.dto import PublishedRealtimeOutboxRetentionResult
from app.application.interfaces import PublishedRealtimeOutboxRetention, UnitOfWork


class PurgePublishedRealtimeOutbox:
    """Aplica una política explícita sin tocar pendientes ni cuarentenas."""

    def __init__(
        self,
        retention: PublishedRealtimeOutboxRetention,
        unit_of_work: UnitOfWork,
    ) -> None:
        self._retention = retention
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        now: datetime,
        *,
        retention_days: int,
        batch_limit: int,
    ) -> PublishedRealtimeOutboxRetentionResult:
        if retention_days <= 0:
            raise ValueError("La retención publicada debe ser mayor a cero.")
        if batch_limit <= 0:
            raise ValueError("El límite de batches debe ser positivo.")

        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)
        else:
            now = now.astimezone(UTC)
        cutoff = now - timedelta(days=retention_days)
        try:
            result = await self._retention.purge(cutoff, batch_limit)
            await self._unit_of_work.commit()
            return result
        except BaseException:
            await self._unit_of_work.rollback()
            raise
