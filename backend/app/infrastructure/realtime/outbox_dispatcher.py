"""Operational outbox loops for the shadow and local live modes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.dto import DispatchRealtimeOutboxResult
from app.application.interfaces import (
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
)
from app.application.use_cases.dispatch_realtime_outbox_batch import (
    DispatchRealtimeOutboxBatch,
)
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class ShadowRealtimeOutboxDispatcher:
    """Drain valid batches without sending them to the local hub or to Redis."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        validator: RealtimeOutboxBatchValidator,
        *,
        poll_interval_seconds: float,
        retry_base_seconds: float,
        retry_max_seconds: float,
        clock: Callable[[], datetime] = _utc_now,
        process_guard: Callable[[], Awaitable[bool]] | None = None,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("The polling interval must be positive.")
        if retry_base_seconds <= 0:
            raise ValueError("The base backoff must be positive.")
        if retry_max_seconds < retry_base_seconds:
            raise ValueError("The maximum backoff cannot be lower than the base.")
        self._session_factory = session_factory
        self._validator = validator
        self._poll_interval_seconds = poll_interval_seconds
        # Kept to classify transient failures once there is a
        # live transport; contract errors never consume backoff.
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds
        self._publisher: RealtimeOutboxBatchPublisher | None = None
        self._mode_label = "shadow"
        self._clock = clock
        self._process_guard = process_guard
        self._stop_event = asyncio.Event()
        self._running = False
        self._last_error: str | None = None
        self._quarantined_batch_count = 0
        self._last_quarantined_batch_id: str | None = None
        self._last_quarantine_code: str | None = None

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_error(self) -> str | None:
        """Sanitized name of the latest operational failure, if any."""
        return self._last_error

    @property
    def quarantined_batch_count(self) -> int:
        """Number of batches terminally set aside since startup."""
        return self._quarantined_batch_count

    @property
    def last_quarantined_batch_id(self) -> str | None:
        """Latest set-aside batch, without topic or payload."""
        return self._last_quarantined_batch_id

    @property
    def last_quarantine_code(self) -> str | None:
        """Stable code of the latest set-aside batch."""
        return self._last_quarantine_code

    async def preflight(self) -> None:
        """Fail on startup if any of the 0018–0021 migrations is not applied."""
        async with self._session_factory() as session:
            try:
                # Selecting the full models also detects a partial table
                # missing any column up to revision 0020.
                await session.execute(select(RealtimeOutboxModel).limit(1))
                await session.execute(select(RealtimeAggregateVersionModel).limit(1))
                await session.execute(select(RealtimeStreamVersionModel).limit(1))
                incomplete_batch_id = await session.scalar(
                    select(RealtimeOutboxModel.batch_id)
                    .where(
                        RealtimeOutboxModel.published_at.is_(None),
                        RealtimeOutboxModel.quarantined_at.is_(None),
                    )
                    .group_by(RealtimeOutboxModel.batch_id)
                    .having(
                        or_(
                            func.count(RealtimeOutboxModel.id)
                            != func.max(RealtimeOutboxModel.batch_size),
                            func.min(RealtimeOutboxModel.sequence) != 0,
                            func.max(RealtimeOutboxModel.sequence)
                            != func.max(RealtimeOutboxModel.batch_size) - 1,
                            func.min(RealtimeOutboxModel.batch_size)
                            != func.max(RealtimeOutboxModel.batch_size),
                        )
                    )
                    .limit(1)
                )
                if incomplete_batch_id is not None:
                    raise RuntimeError(
                        "The outbox contains an incomplete pending batch."
                    )
            finally:
                await session.rollback()

    async def dispatch_once(self) -> DispatchRealtimeOutboxResult:
        """Process at most one batch within a new session."""
        async with self._session_factory() as session:
            use_case = DispatchRealtimeOutboxBatch(
                SqlAlchemyRealtimeOutbox(session),
                SqlAlchemyUnitOfWork(session),
                self._validator,
                self._publisher,
                retry_base_seconds=self._retry_base_seconds,
                retry_max_seconds=self._retry_max_seconds,
                completion_clock=self._clock,
            )
            return await use_case.execute(self._clock())

    async def run(self) -> None:
        """Drain the backlog and wait cancellably when it is empty."""
        if self._running:
            raise RuntimeError(f"The dispatcher {self._mode_label} is already running.")
        self._running = True
        logger.info("Outbox dispatcher started in %s mode.", self._mode_label)
        try:
            while not self._stop_event.is_set():
                if (
                    self._process_guard is not None
                    and not await self._process_guard()
                ):
                    self._last_error = "RealtimeProcessLockLost"
                    logger.critical(
                        "Dispatcher %s lost its process lock and will stop.",
                        self._mode_label,
                    )
                    break
                try:
                    result = await self.dispatch_once()
                    self._last_error = None
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001 - loop resiliente
                    self._last_error = type(error).__name__
                    logger.error(
                        "A dispatcher %s iteration failed (%s).",
                        self._mode_label,
                        self._last_error,
                    )
                    await self._wait_for_work()
                    continue

                if result.status == "empty":
                    await self._wait_for_work()
                elif result.status == "quarantined":
                    self._quarantined_batch_count += 1
                    self._last_quarantined_batch_id = str(result.batch_id)
                    self._last_quarantine_code = result.quarantine_code
                    logger.error(
                        "Dispatcher %s terminally quarantined "
                        "batch %s (%s).",
                        self._mode_label,
                        self._last_quarantined_batch_id,
                        self._last_quarantine_code,
                    )
                elif result.status == "failed":
                    logger.warning(
                        "Dispatcher %s rescheduled batch %s (%s events).",
                        self._mode_label,
                        result.batch_id,
                        result.event_count,
                    )
        finally:
            self._running = False
            logger.info("Outbox dispatcher %s stopped.", self._mode_label)

    def stop(self) -> None:
        """Solicita un cierre coordinado y despierta el polling actual."""
        self._stop_event.set()

    async def _wait_for_work(self) -> None:
        try:
            await asyncio.wait_for(
                self._stop_event.wait(),
                timeout=self._poll_interval_seconds,
            )
        except TimeoutError:
            pass


class LocalRealtimeOutboxDispatcher(ShadowRealtimeOutboxDispatcher):
    """Publish v2 envelopes to the local hub before confirming each batch."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        validator: RealtimeOutboxBatchValidator,
        publisher: RealtimeOutboxBatchPublisher,
        *,
        poll_interval_seconds: float,
        retry_base_seconds: float,
        retry_max_seconds: float,
        clock: Callable[[], datetime] = _utc_now,
        process_guard: Callable[[], Awaitable[bool]] | None = None,
        mode_label: str = "live_local",
    ) -> None:
        super().__init__(
            session_factory,
            validator,
            poll_interval_seconds=poll_interval_seconds,
            retry_base_seconds=retry_base_seconds,
            retry_max_seconds=retry_max_seconds,
            clock=clock,
            process_guard=process_guard,
        )
        self._publisher = publisher
        self._mode_label = mode_label
