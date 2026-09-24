"""Fast contract of the durable scheduled actions repository."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.application.dto import PendingScheduledAction, RenewableScheduledAction
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork


@pytest_asyncio.fixture
async def action_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(ScheduledActionModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


def _pending(
    *,
    key: str = "expire_offer:offer-1",
    generation: int = 1,
    execute_at: datetime,
) -> PendingScheduledAction:
    aggregate_id = uuid.uuid5(uuid.NAMESPACE_URL, key)
    return PendingScheduledAction(
        dedupe_key=key,
        action_type="expire_offer",
        aggregate_id=aggregate_id,
        generation=generation,
        execute_at=execute_at,
        payload={"offer_id": str(aggregate_id)},
    )


async def test_schedule_deduplicates_and_only_a_greater_generation_renews(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        original = await repository.schedule(_pending(execute_at=now))
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        duplicate = await repository.schedule(
            _pending(generation=1, execute_at=now + timedelta(hours=1))
        )
        await SqlAlchemyUnitOfWork(session).commit()

    assert duplicate.id == original.id
    assert duplicate.generation == 1
    assert duplicate.execute_at == now

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        renewed = await repository.schedule(
            _pending(generation=2, execute_at=now + timedelta(hours=2))
        )
        await SqlAlchemyUnitOfWork(session).commit()

    assert renewed.id == original.id
    assert renewed.generation == 2
    assert renewed.execute_at == now + timedelta(hours=2)
    assert renewed.status == "pending"
    assert renewed.attempts == 0


async def test_schedule_next_increments_generation_and_revokes_a_current_lease(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    key = "cancel_absent_ride:ride-1"
    ride_id = uuid.uuid5(uuid.NAMESPACE_URL, key)
    renewable = RenewableScheduledAction(
        dedupe_key=key,
        action_type="cancel_absent_ride",
        aggregate_id=ride_id,
        execute_at=now,
        payload={"ride_id": str(ride_id)},
    )
    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        first = await repository.schedule_next(renewable)
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        claimed = await repository.claim_due(now, now - timedelta(minutes=1))
        assert claimed is not None and claimed.lock_token is not None
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        renewed = await repository.schedule_next(
            RenewableScheduledAction(
                dedupe_key=key,
                action_type="cancel_absent_ride",
                aggregate_id=ride_id,
                execute_at=now + timedelta(minutes=2),
                payload={"ride_id": str(ride_id)},
            )
        )
        await SqlAlchemyUnitOfWork(session).commit()

    assert renewed.id == first.id
    assert renewed.generation == 2
    assert renewed.status == "pending"
    assert renewed.lock_token is None
    assert renewed.attempts == 0

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        assert not await repository.lock_owned(
            claimed.id,
            claimed.generation,
            claimed.lock_token,
        )
        assert not await repository.mark_succeeded(
            claimed.id,
            claimed.generation,
            claimed.lock_token,
            now,
        )


async def test_claim_respects_deadline_and_recovers_lease_with_a_new_token(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        await repository.schedule(_pending(execute_at=now))
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        assert (
            await repository.claim_due(
                now - timedelta(seconds=1),
                now - timedelta(minutes=1),
            )
            is None
        )
        await SqlAlchemyUnitOfWork(session).rollback()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        first = await repository.claim_due(now, now - timedelta(minutes=1))
        assert first is not None
        assert first.lock_token is not None
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        assert (
            await repository.claim_due(
                now + timedelta(seconds=5),
                now - timedelta(minutes=1),
            )
            is None
        )
        await SqlAlchemyUnitOfWork(session).rollback()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        reclaimed = await repository.claim_due(
            now + timedelta(minutes=2),
            now + timedelta(minutes=1),
        )
        assert reclaimed is not None
        assert reclaimed.id == first.id
        assert reclaimed.attempts == 2
        assert reclaimed.lock_token is not None
        assert reclaimed.lock_token != first.lock_token
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        assert not await repository.mark_succeeded(
            first.id,
            first.generation,
            first.lock_token,
            now + timedelta(minutes=2),
        )
        assert await repository.mark_succeeded(
            reclaimed.id,
            reclaimed.generation,
            reclaimed.lock_token,
            now + timedelta(minutes=2),
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        row = await session.scalar(select(ScheduledActionModel))
        assert row is not None
        assert row.status == "succeeded"
        assert row.lock_token is None
        assert row.terminal_at is not None


async def test_failure_reschedules_and_can_exhaust_without_losing_fencing(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        await repository.schedule(_pending(execute_at=now))
        claimed = await repository.claim_due(now, now - timedelta(minutes=1))
        assert claimed is not None and claimed.lock_token is not None
        retry_at = now + timedelta(seconds=10)
        assert await repository.mark_failed(
            claimed.id,
            claimed.generation,
            claimed.lock_token,
            error_code="TimeoutError",
            next_attempt_at=retry_at,
            terminal=False,
            terminal_at=now,
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        repository = SqlAlchemyScheduledActionRepository(session)
        assert (
            await repository.claim_due(
                retry_at - timedelta(microseconds=1),
                now - timedelta(minutes=1),
            )
            is None
        )
        claimed_again = await repository.claim_due(
            retry_at,
            now - timedelta(minutes=1),
        )
        assert claimed_again is not None and claimed_again.lock_token is not None
        assert await repository.mark_failed(
            claimed_again.id,
            claimed_again.generation,
            claimed_again.lock_token,
            error_code="RuntimeError",
            next_attempt_at=retry_at,
            terminal=True,
            terminal_at=retry_at,
        )
        await SqlAlchemyUnitOfWork(session).commit()

    async with action_sessions() as session:
        row = await session.scalar(select(ScheduledActionModel))
        assert row is not None
        assert row.status == "dead"
        assert row.attempts == 2
        assert row.last_error == "RuntimeError"
        assert row.terminal_at is not None
