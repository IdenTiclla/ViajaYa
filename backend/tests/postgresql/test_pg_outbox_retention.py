"""Retención concurrente real de batches publicados en PostgreSQL."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.application.dto import PendingRealtimeEvent
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.outbox_retention import (
    SqlAlchemyPublishedRealtimeOutboxRetention,
)


def _pending(aggregate_id: uuid.UUID, topic: str) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type="ride_status",
        topic=topic,
        aggregate_type="ride",
        aggregate_id=aggregate_id,
        correlation_id=None,
        payload={
            "type": "ride_status",
            "data": {"ride_id": str(aggregate_id)},
        },
    )


async def test_two_retention_workers_do_not_double_count_or_split_batches(
    pg_test_db,
) -> None:
    ride_a = uuid.uuid4()
    ride_b = uuid.uuid4()
    topic_a = f"ride:{ride_a}"
    topic_b = f"ride:{ride_b}"
    aggregate_ids = {ride_a, ride_b}
    topics = {topic_a, topic_b}
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    now = datetime.now(UTC)

    try:
        async with sessions() as session:
            first = await SqlAlchemyRealtimeOutbox(session).add_batch(
                [_pending(ride_a, topic_a), _pending(ride_b, topic_b)]
            )
            await session.commit()
        async with sessions() as session:
            second = await SqlAlchemyRealtimeOutbox(session).add_batch(
                [_pending(ride_a, topic_a)]
            )
            await session.commit()

        batch_ids = {first[0].batch_id, second[0].batch_id}
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.update(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.batch_id.in_(batch_ids))
                .values(published_at=now - timedelta(days=31))
            )

        async def purge_one():
            async with sessions() as session:
                result = await SqlAlchemyPublishedRealtimeOutboxRetention(
                    session
                ).purge(now - timedelta(days=30), 1)
                await session.commit()
                return result

        results = await asyncio.wait_for(
            asyncio.gather(purge_one(), purge_one()),
            timeout=5,
        )

        assert sum(result.batch_count for result in results) == 2
        assert sum(result.event_count for result in results) == 3
        async with sessions() as session:
            assert (
                await session.scalar(
                    sa.select(sa.func.count(RealtimeOutboxModel.id)).where(
                        RealtimeOutboxModel.batch_id.in_(batch_ids)
                    )
                )
                == 0
            )

            next_event = await SqlAlchemyRealtimeOutbox(session).add_batch(
                [_pending(ride_a, topic_a)]
            )
            await session.commit()

        assert next_event[0].aggregate_version == 3
        assert next_event[0].stream_version == 3
    finally:
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.delete(RealtimeOutboxModel).where(
                    RealtimeOutboxModel.aggregate_id.in_(aggregate_ids)
                )
            )
            await connection.execute(
                sa.delete(RealtimeAggregateVersionModel).where(
                    RealtimeAggregateVersionModel.aggregate_type == "ride",
                    RealtimeAggregateVersionModel.aggregate_id.in_(aggregate_ids),
                )
            )
            await connection.execute(
                sa.delete(RealtimeStreamVersionModel).where(
                    RealtimeStreamVersionModel.topic.in_(topics)
                )
            )
