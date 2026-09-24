"""Use case: delete published batches after their retention."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.application.dto import PublishedRealtimeOutboxRetentionResult
from app.application.interfaces import PublishedRealtimeOutboxRetention, UnitOfWork


class PurgePublishedRealtimeOutbox:
    """Apply an explicit policy without touching pending or quarantined batches."""

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
