"""SQLAlchemy projection to observe the realtime outbox's health."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto import (
    RealtimeOutboxOperationalState,
    RealtimeOutboxQuarantineCount,
)
from app.application.interfaces import RealtimeOutboxOperationalReader
from app.infrastructure.db.models import RealtimeOutboxModel


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        # SQLite descarta la zona de DateTime(timezone=True).
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class SqlAlchemyRealtimeOutboxOperationalReader(RealtimeOutboxOperationalReader):
    """Count terminal rows and batches without loading payloads or ORM models."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def read(self) -> RealtimeOutboxOperationalState:
        if self._session.get_bind().dialect.name == "postgresql":
            # All the endpoint's aggregates belong to the same cut. It must
            # be the first statement of this short, read-only session.
            await self._session.execute(
                text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            )
        pending_predicate = (
            RealtimeOutboxModel.published_at.is_(None),
            RealtimeOutboxModel.quarantined_at.is_(None),
        )
        pending_event_count = int(
            (
                await self._session.scalar(
                    select(func.count(RealtimeOutboxModel.id)).where(
                        *pending_predicate
                    )
                )
            )
            or 0
        )

        pending_batch_row = (
            await self._session.execute(
                select(
                    func.count(RealtimeOutboxModel.id),
                    func.coalesce(
                        func.sum(
                            case((RealtimeOutboxModel.attempts > 0, 1), else_=0)
                        ),
                        0,
                    ),
                    func.min(RealtimeOutboxModel.created_at),
                ).where(
                    *pending_predicate,
                    RealtimeOutboxModel.sequence == 0,
                )
            )
        ).one()

        quarantine_rows = (
            await self._session.execute(
                select(
                    RealtimeOutboxModel.quarantine_code,
                    func.count(RealtimeOutboxModel.id),
                )
                .where(
                    RealtimeOutboxModel.quarantined_at.is_not(None),
                    RealtimeOutboxModel.sequence == 0,
                )
                .group_by(RealtimeOutboxModel.quarantine_code)
                .order_by(RealtimeOutboxModel.quarantine_code)
            )
        ).all()
        quarantined_batches = tuple(
            RealtimeOutboxQuarantineCount(code=str(code), batch_count=int(count))
            for code, count in quarantine_rows
        )

        latest_published_row = (
            await self._session.execute(
                select(
                    RealtimeOutboxModel.created_at,
                    RealtimeOutboxModel.published_at,
                )
                .where(
                    RealtimeOutboxModel.published_at.is_not(None),
                    RealtimeOutboxModel.quarantined_at.is_(None),
                    RealtimeOutboxModel.sequence == 0,
                )
                .order_by(
                    RealtimeOutboxModel.published_at.desc(),
                    RealtimeOutboxModel.id.desc(),
                )
                .limit(1)
            )
        ).one_or_none()

        latest_published_created_at: datetime | None = None
        latest_published_at: datetime | None = None
        if latest_published_row is not None:
            latest_published_created_at = _as_utc(latest_published_row.created_at)
            latest_published_at = _as_utc(latest_published_row.published_at)

        return RealtimeOutboxOperationalState(
            pending_event_count=pending_event_count,
            pending_batch_count=int(pending_batch_row[0]),
            retrying_batch_count=int(pending_batch_row[1]),
            quarantined_batches=quarantined_batches,
            oldest_pending_created_at=_as_utc(pending_batch_row[2]),
            latest_published_created_at=latest_published_created_at,
            latest_published_at=latest_published_at,
        )
