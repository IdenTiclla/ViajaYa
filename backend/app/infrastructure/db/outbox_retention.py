"""SQLAlchemy retention of published realtime outbox batches."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.application.dto import PublishedRealtimeOutboxRetentionResult
from app.application.interfaces import PublishedRealtimeOutboxRetention
from app.infrastructure.db.models import RealtimeOutboxModel


class SqlAlchemyPublishedRealtimeOutboxRetention(PublishedRealtimeOutboxRetention):
    """Selecciona anchors antiguos y borra solo cardinalidades verificadas."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def purge(
        self,
        cutoff: datetime,
        batch_limit: int,
    ) -> PublishedRealtimeOutboxRetentionResult:
        if batch_limit <= 0:
            raise ValueError("The batch limit must be positive.")

        anchor = aliased(RealtimeOutboxModel, name="retention_anchor")
        member = aliased(RealtimeOutboxModel, name="retention_member")
        invalid_member = (
            select(literal(1))
            .where(
                member.batch_id == anchor.batch_id,
                or_(
                    member.batch_size != anchor.batch_size,
                    member.published_at.is_(None),
                    member.published_at > cutoff,
                    member.quarantined_at.is_not(None),
                ),
            )
            .correlate(anchor)
            .exists()
        )
        member_count = (
            select(func.count(member.id))
            .where(member.batch_id == anchor.batch_id)
            .correlate(anchor)
            .scalar_subquery()
        )
        candidate_ids = list(
            (
                await self._session.execute(
                    select(anchor.batch_id)
                    .where(
                        anchor.sequence == 0,
                        anchor.published_at.is_not(None),
                        anchor.published_at <= cutoff,
                        anchor.quarantined_at.is_(None),
                        member_count == anchor.batch_size,
                        ~invalid_member,
                    )
                    .order_by(anchor.published_at, anchor.batch_id)
                    .limit(batch_limit)
                    .with_for_update(of=anchor, skip_locked=True)
                )
            ).scalars()
        )
        if not candidate_ids:
            return PublishedRealtimeOutboxRetentionResult(0, 0)

        # The SQL condition keeps an old truncated batch from monopolizing the
        # LIMIT forever. The second check under lock protects the DELETE
        # against anomalous historical data and concurrent changes.
        rows = list(
            (
                await self._session.execute(
                    select(RealtimeOutboxModel)
                    .where(RealtimeOutboxModel.batch_id.in_(candidate_ids))
                    .order_by(
                        RealtimeOutboxModel.batch_id,
                        RealtimeOutboxModel.sequence,
                    )
                    .with_for_update()
                )
            ).scalars()
        )
        grouped: dict[uuid.UUID, list[RealtimeOutboxModel]] = {}
        for row in rows:
            grouped.setdefault(row.batch_id, []).append(row)

        complete_ids = [
            batch_id
            for batch_id in candidate_ids
            if self._is_complete_published_batch(grouped.get(batch_id, []), cutoff)
        ]
        if not complete_ids:
            return PublishedRealtimeOutboxRetentionResult(0, 0)

        result = await self._session.execute(
            delete(RealtimeOutboxModel).where(
                RealtimeOutboxModel.batch_id.in_(complete_ids)
            )
        )
        return PublishedRealtimeOutboxRetentionResult(
            batch_count=len(complete_ids),
            event_count=int(result.rowcount or 0),
        )

    @staticmethod
    def _is_complete_published_batch(
        rows: list[RealtimeOutboxModel],
        cutoff: datetime,
    ) -> bool:
        if not rows:
            return False
        batch_size = rows[0].batch_size
        return (
            batch_size >= 1
            and len(rows) == batch_size
            and [row.sequence for row in rows] == list(range(batch_size))
            and all(row.batch_size == batch_size for row in rows)
            and all(row.quarantined_at is None for row in rows)
            and all(
                row.published_at is not None
                and SqlAlchemyPublishedRealtimeOutboxRetention._as_utc(
                    row.published_at
                )
                <= SqlAlchemyPublishedRealtimeOutboxRetention._as_utc(cutoff)
                for row in rows
            )
        )

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
