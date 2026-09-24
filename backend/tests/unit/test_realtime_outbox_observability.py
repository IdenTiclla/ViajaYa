"""Tests of the realtime outbox's operational projection."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.application.dto import (
    RealtimeOutboxOperationalState,
    RealtimeOutboxQuarantineCount,
)
from app.application.interfaces import RealtimeOutboxOperationalReader
from app.application.use_cases.get_realtime_outbox_operational_snapshot import (
    GetRealtimeOutboxOperationalSnapshot,
)
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.db.outbox_observability import (
    SqlAlchemyRealtimeOutboxOperationalReader,
)


class StubOperationalReader(RealtimeOutboxOperationalReader):
    def __init__(self, state: RealtimeOutboxOperationalState) -> None:
        self.state = state
        self.calls = 0

    async def read(self) -> RealtimeOutboxOperationalState:
        self.calls += 1
        return self.state


@pytest_asyncio.fixture
async def outbox_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(RealtimeOutboxModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


def _row(
    *,
    batch_id: uuid.UUID,
    sequence: int,
    batch_size: int,
    created_at: datetime,
    attempts: int = 0,
    published_at: datetime | None = None,
    quarantined_at: datetime | None = None,
    quarantine_code: str | None = None,
) -> RealtimeOutboxModel:
    aggregate_id = uuid.uuid4()
    return RealtimeOutboxModel(
        id=uuid.uuid4(),
        batch_id=batch_id,
        correlation_id=uuid.uuid4(),
        sequence=sequence,
        batch_size=batch_size,
        event_type="ride_closed",
        topic=f"ride:{uuid.uuid4()}",
        stream_version=1,
        aggregate_type="ride",
        aggregate_id=aggregate_id,
        aggregate_version=1,
        payload={"type": "ride_closed", "data": {"ride_id": str(aggregate_id)}},
        created_at=created_at,
        next_attempt_at=created_at,
        published_at=published_at,
        quarantined_at=quarantined_at,
        quarantine_code=quarantine_code,
        attempts=attempts,
    )


async def test_use_case_derives_ages_with_an_explicit_clock() -> None:
    now = datetime(2026, 7, 22, 18, 0, tzinfo=UTC)
    reader = StubOperationalReader(
        RealtimeOutboxOperationalState(
            pending_event_count=7,
            pending_batch_count=3,
            retrying_batch_count=1,
            quarantined_batches=(
                RealtimeOutboxQuarantineCount("invalid_payload", 2),
            ),
            oldest_pending_created_at=now - timedelta(seconds=45),
            latest_published_created_at=now - timedelta(seconds=12),
            latest_published_at=now - timedelta(seconds=4),
        )
    )

    snapshot = await GetRealtimeOutboxOperationalSnapshot(reader).execute(now)

    assert reader.calls == 1
    assert snapshot.captured_at == now
    assert snapshot.pending_event_count == 7
    assert snapshot.pending_batch_count == 3
    assert snapshot.retrying_batch_count == 1
    assert snapshot.quarantined_batches == (
        RealtimeOutboxQuarantineCount("invalid_payload", 2),
    )
    assert snapshot.max_pending_age_seconds == 45
    assert snapshot.latest_publish_delay_seconds == 8
    assert snapshot.latest_published_at == now - timedelta(seconds=4)


async def test_use_case_handles_empty_state_and_clock_skew() -> None:
    now = datetime(2026, 7, 22, 18, 0, tzinfo=UTC)
    empty_reader = StubOperationalReader(
        RealtimeOutboxOperationalState(
            pending_event_count=0,
            pending_batch_count=0,
            retrying_batch_count=0,
            quarantined_batches=(),
        )
    )
    empty = await GetRealtimeOutboxOperationalSnapshot(empty_reader).execute(now)

    assert empty.max_pending_age_seconds == 0
    assert empty.latest_publish_delay_seconds is None
    assert empty.latest_published_at is None

    skewed_reader = StubOperationalReader(
        RealtimeOutboxOperationalState(
            pending_event_count=1,
            pending_batch_count=1,
            retrying_batch_count=0,
            quarantined_batches=(),
            oldest_pending_created_at=now + timedelta(seconds=2),
            latest_published_created_at=now,
            latest_published_at=now - timedelta(seconds=1),
        )
    )
    skewed = await GetRealtimeOutboxOperationalSnapshot(skewed_reader).execute(now)

    assert skewed.max_pending_age_seconds == 0
    assert skewed.latest_publish_delay_seconds == 0


async def test_sql_reader_counts_events_batches_retries_and_quarantines(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 7, 22, 18, 0, tzinfo=UTC)
    pending_batch = uuid.uuid4()
    retrying_batch = uuid.uuid4()
    published_batch = uuid.uuid4()
    latest_published_batch = uuid.uuid4()
    quarantined_batch = uuid.uuid4()
    second_quarantined_batch = uuid.uuid4()
    other_quarantine_batch = uuid.uuid4()

    rows = [
        _row(
            batch_id=pending_batch,
            sequence=0,
            batch_size=2,
            created_at=now - timedelta(seconds=30),
        ),
        _row(
            batch_id=pending_batch,
            sequence=1,
            batch_size=2,
            created_at=now - timedelta(seconds=30),
        ),
        _row(
            batch_id=retrying_batch,
            sequence=0,
            batch_size=1,
            created_at=now - timedelta(seconds=10),
            attempts=2,
        ),
        _row(
            batch_id=published_batch,
            sequence=0,
            batch_size=1,
            created_at=now - timedelta(seconds=50),
            attempts=1,
            published_at=now - timedelta(seconds=20),
        ),
        _row(
            batch_id=latest_published_batch,
            sequence=0,
            batch_size=1,
            created_at=now - timedelta(seconds=12),
            attempts=1,
            published_at=now - timedelta(seconds=4),
        ),
        _row(
            batch_id=quarantined_batch,
            sequence=0,
            batch_size=2,
            created_at=now - timedelta(seconds=40),
            attempts=1,
            quarantined_at=now - timedelta(seconds=35),
            quarantine_code="invalid_payload",
        ),
        _row(
            batch_id=quarantined_batch,
            sequence=1,
            batch_size=2,
            created_at=now - timedelta(seconds=40),
            attempts=1,
            quarantined_at=now - timedelta(seconds=35),
            quarantine_code="invalid_payload",
        ),
        _row(
            batch_id=second_quarantined_batch,
            sequence=0,
            batch_size=1,
            created_at=now - timedelta(seconds=25),
            attempts=1,
            quarantined_at=now - timedelta(seconds=20),
            quarantine_code="invalid_payload",
        ),
        _row(
            batch_id=other_quarantine_batch,
            sequence=0,
            batch_size=1,
            created_at=now - timedelta(seconds=15),
            attempts=1,
            quarantined_at=now - timedelta(seconds=10),
            quarantine_code="invalid_topic",
        ),
    ]
    async with outbox_sessions() as session:
        session.add_all(rows)
        await session.commit()

        state = await SqlAlchemyRealtimeOutboxOperationalReader(session).read()
        snapshot = await GetRealtimeOutboxOperationalSnapshot(
            SqlAlchemyRealtimeOutboxOperationalReader(session)
        ).execute(now)

    assert state.pending_event_count == 3
    assert state.pending_batch_count == 2
    assert state.retrying_batch_count == 1
    assert state.quarantined_batches == (
        RealtimeOutboxQuarantineCount("invalid_payload", 2),
        RealtimeOutboxQuarantineCount("invalid_topic", 1),
    )
    assert state.oldest_pending_created_at == now - timedelta(seconds=30)
    assert snapshot.max_pending_age_seconds == 30
    assert snapshot.latest_publish_delay_seconds == 8
    assert snapshot.latest_published_at == now - timedelta(seconds=4)


async def test_sql_reader_returns_zeroes_for_an_empty_outbox(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with outbox_sessions() as session:
        state = await SqlAlchemyRealtimeOutboxOperationalReader(session).read()

    assert state == RealtimeOutboxOperationalState(
        pending_event_count=0,
        pending_batch_count=0,
        retrying_batch_count=0,
        quarantined_batches=(),
    )
