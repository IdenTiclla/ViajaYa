"""Adaptador SQLAlchemy para la outbox durable de tiempo real."""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import and_, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.application.dto import (
    PendingRealtimeEvent,
    RealtimeOutboxEvent,
    RealtimeOutboxQuarantineCode,
)
from app.application.interfaces import RealtimeOutbox
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)


def _to_event(row: RealtimeOutboxModel) -> RealtimeOutboxEvent:
    created_at = row.created_at
    if created_at.tzinfo is None:
        # SQLite pierde la zona de DateTime(timezone=True); PostgreSQL conserva
        # el instante aware. El envelope v2 exige siempre una fecha inequívoca.
        created_at = created_at.replace(tzinfo=UTC)
    return RealtimeOutboxEvent(
        id=row.id,
        batch_id=row.batch_id,
        sequence=row.sequence,
        batch_size=row.batch_size,
        event_type=row.event_type,
        topic=row.topic,
        aggregate_type=row.aggregate_type,
        aggregate_id=row.aggregate_id,
        aggregate_version=row.aggregate_version,
        stream_version=row.stream_version,
        payload=dict(row.payload),
        created_at=created_at,
        next_attempt_at=row.next_attempt_at,
        published_at=row.published_at,
        attempts=row.attempts,
        last_error=row.last_error,
        quarantined_at=row.quarantined_at,
        quarantine_code=row.quarantine_code,
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

        # Todos los productores adquieren locks en el mismo orden global para
        # que dos lotes con las mismas claves invertidas no formen un deadlock.
        # Los contadores de agregado siempre se reservan antes que los de topic.
        aggregate_counts = Counter(
            (event.aggregate_type, event.aggregate_id) for event in events
        )
        next_aggregate_versions: dict[tuple[str, uuid.UUID], int] = {}
        for aggregate_type, aggregate_id in sorted(
            aggregate_counts,
            key=lambda key: (key[0], key[1].hex),
        ):
            count = aggregate_counts[(aggregate_type, aggregate_id)]
            last_version = await self._reserve_aggregate_versions(
                aggregate_type,
                aggregate_id,
                count,
            )
            next_aggregate_versions[(aggregate_type, aggregate_id)] = (
                last_version - count + 1
            )

        stream_counts = Counter(event.topic for event in events)
        next_stream_versions: dict[str, int] = {}
        for topic in sorted(stream_counts):
            count = stream_counts[topic]
            last_version = await self._reserve_stream_versions(topic, count)
            next_stream_versions[topic] = last_version - count + 1

        batch_id = uuid.uuid4()
        batch_size = len(events)
        rows: list[RealtimeOutboxModel] = []
        for sequence, event in enumerate(events):
            aggregate_key = (event.aggregate_type, event.aggregate_id)
            aggregate_version = next_aggregate_versions[aggregate_key]
            stream_version = next_stream_versions[event.topic]
            next_aggregate_versions[aggregate_key] += 1
            next_stream_versions[event.topic] += 1
            row = RealtimeOutboxModel(
                batch_id=batch_id,
                sequence=sequence,
                batch_size=batch_size,
                event_type=event.event_type,
                topic=event.topic,
                aggregate_type=event.aggregate_type,
                aggregate_id=event.aggregate_id,
                aggregate_version=aggregate_version,
                stream_version=stream_version,
                payload=dict(event.payload),
            )
            self._session.add(row)
            rows.append(row)

        await self._session.flush()
        return [_to_event(row) for row in rows]

    async def claim_next_batch(self, now: datetime) -> list[RealtimeOutboxEvent]:
        anchor_row = aliased(RealtimeOutboxModel, name="anchor")
        member = aliased(RealtimeOutboxModel, name="member")
        prior = aliased(RealtimeOutboxModel, name="prior")
        blocking_prior = (
            select(literal(1))
            .select_from(member)
            .join(
                prior,
                and_(
                    prior.topic == member.topic,
                    prior.stream_version < member.stream_version,
                    prior.batch_id != member.batch_id,
                    prior.published_at.is_(None),
                    prior.quarantined_at.is_(None),
                ),
            )
            .where(member.batch_id == anchor_row.batch_id)
            .correlate(anchor_row)
            .exists()
        )

        anchor_batch_id = (
            await self._session.execute(
                select(anchor_row.batch_id)
                .where(
                    anchor_row.sequence == 0,
                    anchor_row.published_at.is_(None),
                    anchor_row.quarantined_at.is_(None),
                    anchor_row.next_attempt_at <= now,
                    ~blocking_prior,
                )
                .order_by(
                    anchor_row.next_attempt_at,
                    anchor_row.created_at,
                    anchor_row.id,
                )
                .limit(1)
                .with_for_update(of=anchor_row, skip_locked=True)
            )
        ).scalar_one_or_none()
        if anchor_batch_id is None:
            return []

        rows = (
            await self._session.execute(
                select(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.batch_id == anchor_batch_id)
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
            .where(
                RealtimeOutboxModel.batch_id == batch_id,
                RealtimeOutboxModel.published_at.is_(None),
                RealtimeOutboxModel.quarantined_at.is_(None),
            )
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
            .where(
                RealtimeOutboxModel.batch_id == batch_id,
                RealtimeOutboxModel.published_at.is_(None),
                RealtimeOutboxModel.quarantined_at.is_(None),
            )
            .values(last_error=error, next_attempt_at=next_attempt_at)
        )

    async def mark_batch_quarantined(
        self,
        batch_id: uuid.UUID,
        code: RealtimeOutboxQuarantineCode,
        quarantined_at: datetime,
    ) -> int:
        result = await self._session.execute(
            update(RealtimeOutboxModel)
            .where(
                RealtimeOutboxModel.batch_id == batch_id,
                RealtimeOutboxModel.published_at.is_(None),
                RealtimeOutboxModel.quarantined_at.is_(None),
            )
            .values(
                quarantined_at=quarantined_at,
                quarantine_code=code,
                last_error=None,
            )
        )
        return int(result.rowcount or 0)

    async def _reserve_aggregate_versions(
        self,
        aggregate_type: str,
        aggregate_id: uuid.UUID,
        count: int,
    ) -> int:
        values = {
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "version": count,
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
                "version": RealtimeAggregateVersionModel.version + count,
                "updated_at": func.now(),
            },
        ).returning(RealtimeAggregateVersionModel.version)
        return int((await self._session.execute(statement)).scalar_one())

    async def _reserve_stream_versions(self, topic: str, count: int) -> int:
        values = {"topic": topic, "version": count}
        dialect_name = self._session.get_bind().dialect.name
        if dialect_name == "postgresql":
            statement = postgresql_insert(RealtimeStreamVersionModel).values(**values)
        elif dialect_name == "sqlite":
            statement = sqlite_insert(RealtimeStreamVersionModel).values(**values)
        else:  # pragma: no cover - los entornos soportados son PostgreSQL y SQLite
            raise RuntimeError(f"Dialect de outbox no soportado: {dialect_name}")

        statement = statement.on_conflict_do_update(
            index_elements=[RealtimeStreamVersionModel.topic],
            set_={
                "version": RealtimeStreamVersionModel.version + count,
                "updated_at": func.now(),
            },
        ).returning(RealtimeStreamVersionModel.version)
        return int((await self._session.execute(statement)).scalar_one())
