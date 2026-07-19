"""Caso de uso: valida y consume un batch de la outbox en modo sombra."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.application.dto import DispatchRealtimeOutboxResult
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    RealtimeOutbox,
    RealtimeOutboxBatchValidator,
    UnitOfWork,
)

_MAX_RECORDED_ERROR_LENGTH = 500
_MAX_BACKOFF_EXPONENT = 20


class DispatchRealtimeOutboxBatch:
    """Reclama un lote y lo marca sin publicarlo a ningún transporte.

    El modo sombra certifica persistencia, reclamación y contrato. No conoce el
    hub WebSocket ni Redis, por lo que no puede duplicar la entrega directa
    vigente.
    """

    def __init__(
        self,
        outbox: RealtimeOutbox,
        unit_of_work: UnitOfWork,
        validator: RealtimeOutboxBatchValidator,
        *,
        retry_base_seconds: float,
        retry_max_seconds: float,
    ) -> None:
        if retry_base_seconds <= 0:
            raise ValueError("El backoff base debe ser positivo.")
        if retry_max_seconds < retry_base_seconds:
            raise ValueError("El backoff máximo no puede ser menor al base.")
        self._outbox = outbox
        self._unit_of_work = unit_of_work
        self._validator = validator
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
            except InvalidRealtimeOutboxBatchError as error:
                retry_at = now + timedelta(
                    seconds=self._retry_delay_seconds(
                        max(event.attempts for event in events)
                    )
                )
                await self._outbox.mark_batch_failed(
                    events[0].batch_id,
                    str(error)[:_MAX_RECORDED_ERROR_LENGTH],
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

    def _retry_delay_seconds(self, attempts: int) -> float:
        exponent = min(max(attempts - 1, 0), _MAX_BACKOFF_EXPONENT)
        return min(
            self._retry_max_seconds,
            self._retry_base_seconds * (2**exponent),
        )
