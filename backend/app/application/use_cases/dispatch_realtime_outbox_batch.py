"""Caso de uso: valida y consume un batch de la outbox en modo sombra."""

from __future__ import annotations

from datetime import datetime

from app.application.dto import DispatchRealtimeOutboxResult
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    RealtimeOutbox,
    RealtimeOutboxBatchValidator,
    UnitOfWork,
)


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
    ) -> None:
        self._outbox = outbox
        self._unit_of_work = unit_of_work
        self._validator = validator

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
                return DispatchRealtimeOutboxResult(
                    status="quarantined",
                    batch_id=events[0].batch_id,
                    event_count=len(events),
                    quarantine_code=error.code,
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
