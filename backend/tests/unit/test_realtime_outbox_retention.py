"""Pruebas de retención segura de batches publicados."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.application.dto import (
    PendingRealtimeEvent,
    PublishedRealtimeOutboxRetentionResult,
)
from app.application.use_cases.purge_published_realtime_outbox import (
    PurgePublishedRealtimeOutbox,
)
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.outbox_retention import (
    SqlAlchemyPublishedRealtimeOutboxRetention,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime.outbox_retention import (
    PublishedRealtimeOutboxRetentionWorker,
)


@pytest_asyncio.fixture
async def outbox_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(RealtimeAggregateVersionModel.__table__.create)
        await connection.run_sync(RealtimeStreamVersionModel.__table__.create)
        await connection.run_sync(RealtimeOutboxModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


def _pending(aggregate_id: uuid.UUID, event_type: str) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type=event_type,
        topic=f"ride:{aggregate_id}",
        aggregate_type="ride",
        aggregate_id=aggregate_id,
        payload={"type": event_type, "data": {"ride_id": str(aggregate_id)}},
    )


async def _add_batch(
    factory: async_sessionmaker[AsyncSession],
    size: int,
) -> uuid.UUID:
    aggregate_id = uuid.uuid4()
    async with factory() as session:
        saved = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [_pending(aggregate_id, f"evento_{index}") for index in range(size)]
        )
        await SqlAlchemyUnitOfWork(session).commit()
    return saved[0].batch_id


async def _mark_published(
    factory: async_sessionmaker[AsyncSession],
    batch_id: uuid.UUID,
    at: datetime,
) -> None:
    async with factory() as session:
        await SqlAlchemyRealtimeOutbox(session).mark_batch_published(batch_id, at)
        await SqlAlchemyUnitOfWork(session).commit()


async def test_purge_only_deletes_complete_old_published_batches(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 7, 22, tzinfo=UTC)
    old_at = now - timedelta(days=31)
    recent_at = now - timedelta(days=2)
    old_complete = await _add_batch(outbox_sessions, 2)
    old_incomplete = await _add_batch(outbox_sessions, 2)
    recent = await _add_batch(outbox_sessions, 1)
    pending = await _add_batch(outbox_sessions, 1)
    quarantined = await _add_batch(outbox_sessions, 1)
    await _mark_published(outbox_sessions, old_complete, old_at)
    await _mark_published(outbox_sessions, old_incomplete, old_at - timedelta(days=1))
    await _mark_published(outbox_sessions, recent, recent_at)

    async with outbox_sessions() as session:
        await session.execute(
            delete(RealtimeOutboxModel).where(
                RealtimeOutboxModel.batch_id == old_incomplete,
                RealtimeOutboxModel.sequence == 1,
            )
        )
        assert await SqlAlchemyRealtimeOutbox(session).mark_batch_quarantined(
            quarantined,
            "invalid_payload",
            old_at,
        ) == 1
        await session.commit()

    async with outbox_sessions() as session:
        result = await PurgePublishedRealtimeOutbox(
            SqlAlchemyPublishedRealtimeOutboxRetention(session),
            SqlAlchemyUnitOfWork(session),
        ).execute(now, retention_days=30, batch_limit=1)

    assert result.batch_count == 1
    assert result.event_count == 2

    async with outbox_sessions() as session:
        remaining = set(
            (
                await session.execute(select(RealtimeOutboxModel.batch_id))
            ).scalars()
        )
        aggregate_counter_count = await session.scalar(
            select(func.count(RealtimeAggregateVersionModel.aggregate_id))
        )
        stream_counter_count = await session.scalar(
            select(func.count(RealtimeStreamVersionModel.topic))
        )

    assert old_complete not in remaining
    assert {old_incomplete, recent, pending, quarantined} <= remaining
    assert aggregate_counter_count == 5
    assert stream_counter_count == 5


async def test_purge_limit_is_measured_in_batches(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 7, 22, tzinfo=UTC)
    old_at = now - timedelta(days=31)
    batches = [await _add_batch(outbox_sessions, size) for size in (3, 2)]
    for batch_id in batches:
        await _mark_published(outbox_sessions, batch_id, old_at)

    async with outbox_sessions() as session:
        first = await PurgePublishedRealtimeOutbox(
            SqlAlchemyPublishedRealtimeOutboxRetention(session),
            SqlAlchemyUnitOfWork(session),
        ).execute(now, retention_days=30, batch_limit=1)

    assert first.batch_count == 1
    assert first.event_count in {2, 3}

    async with outbox_sessions() as session:
        second = await PurgePublishedRealtimeOutbox(
            SqlAlchemyPublishedRealtimeOutboxRetention(session),
            SqlAlchemyUnitOfWork(session),
        ).execute(now, retention_days=30, batch_limit=1)

    assert second.batch_count == 1
    assert first.event_count + second.event_count == 5


async def test_purge_normalizes_a_naive_clock_as_utc(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    aware_now = datetime(2026, 7, 22, tzinfo=UTC)
    batch_id = await _add_batch(outbox_sessions, 1)
    await _mark_published(outbox_sessions, batch_id, aware_now - timedelta(days=31))

    async with outbox_sessions() as session:
        result = await PurgePublishedRealtimeOutbox(
            SqlAlchemyPublishedRealtimeOutboxRetention(session),
            SqlAlchemyUnitOfWork(session),
        ).execute(
            aware_now.replace(tzinfo=None),
            retention_days=30,
            batch_limit=1,
        )

    assert result.batch_count == 1
    assert result.event_count == 1


async def test_retention_worker_stops_during_long_interval(
    outbox_sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = PublishedRealtimeOutboxRetentionWorker(
        outbox_sessions,
        retention_days=30,
        interval_seconds=3600,
        batch_limit=10,
    )
    completed = asyncio.Event()

    async def empty_purge(_now: datetime):
        completed.set()
        return PublishedRealtimeOutboxRetentionResult(0, 0)

    monkeypatch.setattr(worker, "purge_once", empty_purge)
    task = asyncio.create_task(worker.run())
    await asyncio.wait_for(completed.wait(), timeout=1)
    worker.stop()
    await asyncio.wait_for(task, timeout=1)

    assert worker.running is False


async def test_retention_preflight_requires_0021_index(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    worker = PublishedRealtimeOutboxRetentionWorker(
        outbox_sessions,
        retention_days=30,
        interval_seconds=3600,
        batch_limit=10,
    )
    await worker.preflight()

    async with outbox_sessions() as session:
        await session.execute(text("DROP INDEX ix_realtime_outbox_published_retention"))
        await session.commit()

    with pytest.raises(RuntimeError, match="índice.*0021"):
        await worker.preflight()
