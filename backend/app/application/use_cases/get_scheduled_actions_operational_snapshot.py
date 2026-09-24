"""Use case: get the operational snapshot of scheduled actions."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.application.dto import ScheduledActionsOperationalSnapshot
from app.application.interfaces import ScheduledActionsOperationalReader


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class GetScheduledActionsOperationalSnapshot:
    def __init__(self, reader: ScheduledActionsOperationalReader) -> None:
        self._reader = reader

    async def execute(
        self,
        now: datetime,
        *,
        lease_seconds: float,
    ) -> ScheduledActionsOperationalSnapshot:
        captured_at = _as_utc(now)
        state = await self._reader.read(
            captured_at,
            captured_at - timedelta(seconds=lease_seconds),
        )
        oldest_due_age_seconds = 0.0
        if state.oldest_due_at is not None:
            oldest_due_age_seconds = max(
                0.0,
                (captured_at - _as_utc(state.oldest_due_at)).total_seconds(),
            )
        return ScheduledActionsOperationalSnapshot(
            captured_at=captured_at,
            pending_count=state.pending_count,
            due_count=state.due_count,
            running_count=state.running_count,
            stale_count=state.stale_count,
            retrying_count=state.retrying_count,
            dead_counts=state.dead_counts,
            oldest_due_age_seconds=oldest_due_age_seconds,
            next_due_at=(
                _as_utc(state.next_due_at) if state.next_due_at is not None else None
            ),
            latest_succeeded_at=(
                _as_utc(state.latest_succeeded_at)
                if state.latest_succeeded_at is not None
                else None
            ),
        )
