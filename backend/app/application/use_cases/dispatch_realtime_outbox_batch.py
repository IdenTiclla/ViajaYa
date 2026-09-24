"""Caso de uso: valida y consume un batch durable de tiempo real."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
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
    """Claim a batch and optionally deliver it before confirming it.

    Without a publisher it keeps shadow mode: it validates and marks without producing
    visible effects. With a publisher it offers at-least-once delivery: a crash after
    publishing and before the commit will repeat the same ``event_id``.
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
        completion_clock: Callable[[], datetime] | None = None,
    ) -> None:
        if retry_base_seconds <= 0:
            raise ValueError("The base backoff must be positive.")
        if retry_max_seconds < retry_base_seconds:
            raise ValueError("The maximum backoff cannot be lower than the base.")
        self._outbox = outbox
        self._unit_of_work = unit_of_work
        self._validator = validator
        self._publisher = publisher
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds
        self._completion_clock = completion_clock

    async def execute(self, now: datetime) -> DispatchRealtimeOutboxResult:
        try:
            events = await self._outbox.claim_next_batch(now)
            if not events:
                # Even a read opens a transaction in SQLAlchemy. It is closed
                # explicitly so that each iteration uses a clean boundary.
                await self._unit_of_work.rollback()
                return DispatchRealtimeOutboxResult(status="empty")

            try:
                self._validator.validate(events)
                if self._publisher is not None:
                    await self._publisher.publish(events)
            except InvalidRealtimeOutboxBatchError as error:
                return await self._quarantine(
                    events,
                    error,
                    self._completed_at(now),
                )
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - fallo transitorio sanitizado
                if self._publisher is None:
                    raise
                retry_at = self._completed_at(now) + timedelta(
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

            await self._outbox.mark_batch_published(
                events[0].batch_id,
                self._completed_at(now),
            )
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
                "The quarantine did not reach every event of the claimed batch."
            ) from error
        await self._unit_of_work.commit()
        if self._publisher is not None:
            # The stream counter already includes the set-aside version. Closing
            # after the commit forces capturing a watermark that skips the gap,
            # even if an N+2 event that would reveal it never arrives.
            resync_task = asyncio.create_task(
                self._publisher.force_resync(affected_streams),
                name="realtime-outbox-quarantine-resync",
            )
            try:
                await asyncio.shield(resync_task)
            except asyncio.CancelledError:
                # The quarantine is already confirmed and will not be claimed again.
                # Completing the close is part of that terminal confirmation.
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

    def _completed_at(self, fallback: datetime) -> datetime:
        """Read the clock after the attempt, not before publishing.

        Tests and adapters that do not inject a clock yet keep the
        received instant for compatibility. The operational dispatcher always
        injects its real clock.
        """
        if self._completion_clock is None:
            return fallback
        return self._completion_clock()
