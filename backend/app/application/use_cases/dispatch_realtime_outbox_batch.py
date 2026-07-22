"""Caso de uso: valida y consume un batch durable de tiempo real."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import datetime, timedelta

from app.application.dto import DispatchRealtimeOutboxResult, RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    RealtimeOutbox,
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
    UnitOfWork,
)


class DispatchRealtimeOutboxBatch:
    """Reclama un lote y opcionalmente lo entrega antes de confirmarlo.

    Sin publisher conserva el modo sombra: valida y marca sin producir efectos
    visibles. Con publisher ofrece entrega al menos una vez: una caída después
    de publicar y antes del commit repetirá el mismo ``event_id``.
    """

    def __init__(
        self,
        outbox: RealtimeOutbox,
        unit_of_work: UnitOfWork,
        validator: RealtimeOutboxBatchValidator,
        publisher: RealtimeOutboxBatchPublisher | None = None,
        *,
        retry_base_seconds: float = 1,
        retry_max_seconds: float = 60,
    ) -> None:
        if retry_base_seconds <= 0:
            raise ValueError("El backoff base debe ser positivo.")
        if retry_max_seconds < retry_base_seconds:
            raise ValueError("El backoff máximo no puede ser menor al base.")
        self._outbox = outbox
        self._unit_of_work = unit_of_work
        self._validator = validator
        self._publisher = publisher
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds

    async def execute(self, now: datetime) -> DispatchRealtimeOutboxResult:
        try:
            events = await self._outbox.claim_next_batch(now)
            if not events:
                # Incluso una lectura abre transacción en SQLAlchemy. Se cierra
                # explícitamente para que cada iteración use una frontera limpia.
                await self._unit_of_work.rollback()
                return DispatchRealtimeOutboxResult(status="empty")

            try:
                self._validator.validate(events)
                if self._publisher is not None:
                    await self._publisher.publish(events)
            except InvalidRealtimeOutboxBatchError as error:
                return await self._quarantine(events, error, now)
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - fallo transitorio sanitizado
                if self._publisher is None:
                    raise
                retry_at = now + timedelta(
                    seconds=self._retry_delay(events[0].attempts)
                )
                await self._outbox.mark_batch_failed(
                    events[0].batch_id,
                    type(error).__name__,
                    retry_at,
                )
                await self._unit_of_work.commit()
                return DispatchRealtimeOutboxResult(
                    status="failed",
                    batch_id=events[0].batch_id,
                    event_count=len(events),
                )

            await self._outbox.mark_batch_published(events[0].batch_id, now)
            await self._unit_of_work.commit()
            return DispatchRealtimeOutboxResult(
                status="published",
                batch_id=events[0].batch_id,
                event_count=len(events),
            )
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _quarantine(
        self,
        events: Sequence[RealtimeOutboxEvent],
        error: InvalidRealtimeOutboxBatchError,
        now: datetime,
    ) -> DispatchRealtimeOutboxResult:
        affected_streams = tuple(dict.fromkeys(event.topic for event in events))
        quarantined_count = await self._outbox.mark_batch_quarantined(
            events[0].batch_id,
            error.code,
            now,
        )
        if quarantined_count != len(events):
            raise RuntimeError(
                "La cuarentena no alcanzó a todos los eventos del batch reclamado."
            ) from error
        await self._unit_of_work.commit()
        if self._publisher is not None:
            # El contador del stream ya contiene la versión apartada. Cerrar
            # después del commit obliga a capturar un watermark que salte el hueco,
            # incluso si nunca llega un evento N+2 que permita detectarlo.
            resync_task = asyncio.create_task(
                self._publisher.force_resync(affected_streams),
                name="realtime-outbox-quarantine-resync",
            )
            try:
                await asyncio.shield(resync_task)
            except asyncio.CancelledError:
                # La cuarentena ya quedó confirmada y no volverá a reclamarse.
                # Completar el cierre es parte de esa confirmación terminal.
                await resync_task
                raise
        return DispatchRealtimeOutboxResult(
            status="quarantined",
            batch_id=events[0].batch_id,
            event_count=len(events),
            quarantine_code=error.code,
            affected_streams=affected_streams,
        )

    def _retry_delay(self, attempts: int) -> float:
        exponent = min(max(attempts - 1, 0), 63)
        return min(
            self._retry_max_seconds,
            self._retry_base_seconds * (2**exponent),
        )
