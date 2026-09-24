"""Use case: get an operational snapshot of the realtime outbox."""

from __future__ import annotations

from datetime import UTC, datetime

from app.application.dto import RealtimeOutboxOperationalSnapshot
from app.application.interfaces import RealtimeOutboxOperationalReader


def _as_utc(value: datetime) -> datetime:
    """Normaliza timestamps SQLite sin zona y conserva instantes PostgreSQL."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _nonnegative_seconds(later: datetime, earlier: datetime) -> float:
    """Compute a duration without publishing negative gauges due to clock skew."""
    return max(0.0, (_as_utc(later) - _as_utc(earlier)).total_seconds())


class GetRealtimeOutboxOperationalSnapshot:
    """Derive operational ages over a stable, persisted projection."""

    def __init__(self, reader: RealtimeOutboxOperationalReader) -> None:
        self._reader = reader

    async def execute(self, now: datetime) -> RealtimeOutboxOperationalSnapshot:
        captured_at = _as_utc(now)
        state = await self._reader.read()

        max_pending_age_seconds = 0.0
        if state.oldest_pending_created_at is not None:
            max_pending_age_seconds = _nonnegative_seconds(
                captured_at,
                state.oldest_pending_created_at,
            )

        latest_publish_delay_seconds: float | None = None
        if (
            state.latest_published_created_at is not None
            and state.latest_published_at is not None
        ):
            latest_publish_delay_seconds = _nonnegative_seconds(
                state.latest_published_at,
                state.latest_published_created_at,
            )

        latest_published_at = state.latest_published_at
        if latest_published_at is not None:
            latest_published_at = _as_utc(latest_published_at)

        return RealtimeOutboxOperationalSnapshot(
            captured_at=captured_at,
            pending_event_count=state.pending_event_count,
            pending_batch_count=state.pending_batch_count,
            retrying_batch_count=state.retrying_batch_count,
            quarantined_batches=state.quarantined_batches,
            max_pending_age_seconds=max_pending_age_seconds,
            latest_publish_delay_seconds=latest_publish_delay_seconds,
            latest_published_at=latest_published_at,
        )
