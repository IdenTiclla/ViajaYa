"""Orden de claim por stream con dispatchers PostgreSQL concurrentes."""

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


def _pending(
    aggregate_id: uuid.UUID,
    topic: str,
    event_type: str = "ride_status",
) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type=event_type,
        topic=topic,
        aggregate_type="ride",
        aggregate_id=aggregate_id,
        payload={"type": event_type, "data": {}},
    )


async def _add_batch(pg_test_db, events: list[PendingRealtimeEvent]):
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    async with sessions() as session:
        saved = await SqlAlchemyRealtimeOutbox(session).add_batch(events)
        await session.commit()
        return saved


async def _cleanup(
    pg_test_db,
    aggregate_ids: set[uuid.UUID],
    topics: set[str],
) -> None:
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


async def test_head_bloqueado_no_se_salta_y_otro_stream_si_progresa(
    pg_test_db,
) -> None:
    blocked_ride_id = uuid.uuid4()
    independent_ride_id = uuid.uuid4()
    blocked_topic = f"ride:{blocked_ride_id}"
    independent_topic = f"ride:{independent_ride_id}"
    aggregate_ids = {blocked_ride_id, independent_ride_id}
    topics = {blocked_topic, independent_topic}

    try:
        head = await _add_batch(
            pg_test_db,
            [_pending(blocked_ride_id, blocked_topic)],
        )
        await _add_batch(
            pg_test_db,
            [_pending(blocked_ride_id, blocked_topic)],
        )
        independent = await _add_batch(
            pg_test_db,
            [_pending(independent_ride_id, independent_topic)],
        )

        ready_at = datetime.now(UTC) + timedelta(seconds=1)
        async with pg_test_db.engine.begin() as connection:
            await connection.execute(
                sa.update(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.batch_id == head[0].batch_id)
                .values(next_attempt_at=ready_at)
            )
            await connection.execute(
                sa.update(RealtimeOutboxModel)
                .where(RealtimeOutboxModel.batch_id == independent[0].batch_id)
                .values(next_attempt_at=ready_at + timedelta(milliseconds=1))
            )

        sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
        claim_at = ready_at + timedelta(seconds=1)
        async with sessions() as session_a, sessions() as session_b:
            claimed_a = await SqlAlchemyRealtimeOutbox(session_a).claim_next_batch(
                claim_at
            )
            claimed_b = await SqlAlchemyRealtimeOutbox(session_b).claim_next_batch(
                claim_at
            )

            assert claimed_a[0].batch_id == head[0].batch_id
            assert claimed_b[0].batch_id == independent[0].batch_id
            await session_b.rollback()
            await session_a.rollback()
    finally:
        await _cleanup(pg_test_db, aggregate_ids, topics)


async def test_commit_del_head_habilita_la_siguiente_version_del_stream(
    pg_test_db,
) -> None:
    ride_id = uuid.uuid4()
    topic = f"ride:{ride_id}"

    try:
        head = await _add_batch(pg_test_db, [_pending(ride_id, topic)])
        successor = await _add_batch(pg_test_db, [_pending(ride_id, topic)])
        sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
        claim_at = datetime.now(UTC) + timedelta(seconds=1)

        async with sessions() as session_a, sessions() as session_b:
            outbox_a = SqlAlchemyRealtimeOutbox(session_a)
            outbox_b = SqlAlchemyRealtimeOutbox(session_b)
            claimed_head = await outbox_a.claim_next_batch(claim_at)
            assert claimed_head[0].batch_id == head[0].batch_id
            assert await outbox_b.claim_next_batch(claim_at) == []

            await outbox_a.mark_batch_published(head[0].batch_id, claim_at)
            await session_a.commit()

            claimed_successor = await outbox_b.claim_next_batch(claim_at)
            assert claimed_successor[0].batch_id == successor[0].batch_id
            assert claimed_successor[0].stream_version == 2
            await session_b.rollback()
    finally:
        await _cleanup(pg_test_db, {ride_id}, {topic})


async def test_productores_con_topics_invertidos_no_forman_deadlock(
    pg_test_db,
) -> None:
    ride_a = uuid.uuid4()
    ride_b = uuid.uuid4()
    topic_a = f"ride:{ride_a}"
    topic_b = f"ride:{ride_b}"
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)

    async def add(events: list[PendingRealtimeEvent]):
        async with sessions() as session:
            saved = await SqlAlchemyRealtimeOutbox(session).add_batch(events)
            await session.commit()
            return saved

    try:
        first, second = await asyncio.wait_for(
            asyncio.gather(
                add([_pending(ride_a, topic_a), _pending(ride_b, topic_b)]),
                add([_pending(ride_b, topic_b), _pending(ride_a, topic_a)]),
            ),
            timeout=5,
        )

        for topic in (topic_a, topic_b):
            versions = sorted(
                event.stream_version
                for event in [*first, *second]
                if event.topic == topic
            )
            assert versions == [1, 2]
    finally:
        await _cleanup(pg_test_db, {ride_a, ride_b}, {topic_a, topic_b})
