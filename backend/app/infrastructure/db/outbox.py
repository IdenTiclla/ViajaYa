"""Adaptador SQLAlchemy para la outbox durable de tiempo real."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto import PendingRealtimeEvent, RealtimeOutboxEvent
from app.application.interfaces import RealtimeOutbox
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
)


def _to_event(row: RealtimeOutboxModel) -> RealtimeOutboxEvent:
    return RealtimeOutboxEvent(
        id=row.id,
        batch_id=row.batch_id,
        sequence=row.sequence,
        event_type=row.event_type,
        topic=row.topic,
        aggregate_type=row.aggregate_type,
        aggregate_id=row.aggregate_id,
        aggregate_version=row.aggregate_version,
        payload=dict(row.payload),
        created_at=row.created_at,
        next_attempt_at=row.next_attempt_at,
        published_at=row.published_at,
        attempts=row.attempts,
        last_error=row.last_error,
    )


class SqlAlchemyRealtimeOutbox(RealtimeOutbox):
    """Persiste lotes y los reclama manteniendo el lock hasta el commit del UoW."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add_batch(
        self,
        events: Sequence[PendingRealtimeEvent],
    ) -> list[RealtimeOutboxEvent]:
        if not events:
            raise ValueError("El lote de eventos no puede estar vacío.")

        batch_id = uuid.uuid4()
        rows: list[RealtimeOutboxModel] = []
        for sequence, event in enumerate(events):
            version = await self._next_aggregate_version(
                event.aggregate_type,
                event.aggregate_id,
            )
            row = RealtimeOutboxModel(
                batch_id=batch_id,
                sequence=sequence,
                event_type=event.event_type,
                topic=event.topic,
                aggregate_type=event.aggregate_type,
                aggregate_id=event.aggregate_id,
                aggregate_version=version,
                payload=dict(event.payload),
            )
            self._session.add(row)
            rows.append(row)

        await self._session.flush()
        return [_to_event(row) for row in rows]

    async def claim_next_batch(self, now: datetime) -> list[RealtimeOutboxEvent]:
        anchor = (
            await self._session.execute(
                select(RealtimeOutboxModel.batch_id)
                .where(
                    RealtimeOutboxModel.sequence == 0,
                    RealtimeOutboxModel.published_at.is_(None),
                    RealtimeOutboxModel.next_attempt_at <= now,
                )
                .order_by(
                    RealtimeOutboxModel.next_attempt_at,
                    RealtimeOutboxModel.created_at,
                    RealtimeOutboxModel.id,
                )
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if anchor is None:
            return []

        rows = (
            await self._session.execute(
                select(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.batch_id == anchor)
                .order_by(RealtimeOutboxModel.sequence)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        for row in rows:
            row.attempts += 1
        await self._session.flush()
        return [_to_event(row) for row in rows]

    async def mark_batch_published(
        self,
        batch_id: uuid.UUID,
        published_at: datetime,
    ) -> None:
        await self._session.execute(
            update(RealtimeOutboxModel)
            .where(RealtimeOutboxModel.batch_id == batch_id)
            .values(published_at=published_at, last_error=None)
        )

    async def mark_batch_failed(
        self,
        batch_id: uuid.UUID,
        error: str,
        next_attempt_at: datetime,
    ) -> None:
        await self._session.execute(
            update(RealtimeOutboxModel)
            .where(RealtimeOutboxModel.batch_id == batch_id)
            .values(last_error=error, next_attempt_at=next_attempt_at)
        )

    async def _next_aggregate_version(
        self,
        aggregate_type: str,
        aggregate_id: uuid.UUID,
    ) -> int:
        values = {
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "version": 1,
        }
        dialect_name = self._session.get_bind().dialect.name
        if dialect_name == "postgresql":
            statement = postgresql_insert(RealtimeAggregateVersionModel).values(**values)
        elif dialect_name == "sqlite":
            statement = sqlite_insert(RealtimeAggregateVersionModel).values(**values)
        else:  # pragma: no cover - los entornos soportados son PostgreSQL y SQLite
            raise RuntimeError(f"Dialect de outbox no soportado: {dialect_name}")

        statement = statement.on_conflict_do_update(
            index_elements=[
                RealtimeAggregateVersionModel.aggregate_type,
                RealtimeAggregateVersionModel.aggregate_id,
            ],
            set_={
                "version": RealtimeAggregateVersionModel.version + 1,
                "updated_at": func.now(),
            },
        ).returning(RealtimeAggregateVersionModel.version)
        return int((await self._session.execute(statement)).scalar_one())
