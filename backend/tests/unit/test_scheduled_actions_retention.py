"""Pruebas de retención segura de acciones programadas terminales."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.application.use_cases.purge_terminal_scheduled_actions import (
    PurgeTerminalScheduledActions,
)
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.scheduled_actions_retention import (
    SqlAlchemyTerminalScheduledActionsRetention,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.scheduled_actions.retention import (
    TerminalScheduledActionsRetentionWorker,
)


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


def _action(status: str, terminal_at: datetime | None) -> ScheduledActionModel:
    action_id = uuid.uuid4()
    created_at = terminal_at or datetime(2026, 1, 1, tzinfo=UTC)
    return ScheduledActionModel(
        id=action_id,
        dedupe_key=f"expire_offer:{action_id}",
        action_type="expire_offer",
        aggregate_id=uuid.uuid4(),
        generation=1,
        execute_at=created_at,
        payload={"offer_id": str(action_id)},
        status=status,
        attempts=1 if status != "pending" else 0,
        next_attempt_at=created_at,
        locked_at=None,
        lock_token=None,
        last_error="RuntimeError" if status == "dead" else None,
        terminal_at=terminal_at,
        created_at=created_at,
        updated_at=created_at,
    )


async def test_purge_elimina_por_chunks_solo_exitos_y_cancelaciones_antiguas(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 7, 22, tzinfo=UTC)
    old_at = now - timedelta(days=31)
    rows = [
        _action("succeeded", old_at - timedelta(days=1)),
        _action("cancelled", old_at),
        _action("dead", old_at - timedelta(days=2)),
        _action("succeeded", now - timedelta(days=2)),
        _action("pending", None),
    ]
    async with action_sessions() as session:
        session.add_all(rows)
        await session.commit()

    async with action_sessions() as session:
        first = await PurgeTerminalScheduledActions(
            SqlAlchemyTerminalScheduledActionsRetention(session),
            SqlAlchemyUnitOfWork(session),
        ).execute(now, retention_days=30, action_limit=1)

    async with action_sessions() as session:
        second = await PurgeTerminalScheduledActions(
            SqlAlchemyTerminalScheduledActionsRetention(session),
            SqlAlchemyUnitOfWork(session),
        ).execute(now, retention_days=30, action_limit=1)

    assert first == 1
    assert second == 1
    async with action_sessions() as session:
        remaining = set(
            (await session.execute(select(ScheduledActionModel.status))).scalars()
        )
    assert remaining == {"dead", "succeeded", "pending"}


async def test_purge_normaliza_reloj_naive_como_utc(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime(2026, 7, 22, tzinfo=UTC)
    async with action_sessions() as session:
        session.add(_action("succeeded", now - timedelta(days=31)))
        await session.commit()

    async with action_sessions() as session:
        deleted_count = await PurgeTerminalScheduledActions(
            SqlAlchemyTerminalScheduledActionsRetention(session),
            SqlAlchemyUnitOfWork(session),
        ).execute(
            now.replace(tzinfo=None),
            retention_days=30,
            action_limit=10,
        )

    assert deleted_count == 1


async def test_retention_worker_se_detiene_durante_intervalo_largo(
    action_sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = TerminalScheduledActionsRetentionWorker(
        action_sessions,
        retention_days=30,
        interval_seconds=3600,
        action_limit=10,
    )
    completed = asyncio.Event()

    async def empty_purge() -> int:
        completed.set()
        return 0

    monkeypatch.setattr(worker, "purge_once", empty_purge)
    task = asyncio.create_task(worker.run())
    await asyncio.wait_for(completed.wait(), timeout=1)
    worker.stop()
    await asyncio.wait_for(task, timeout=1)

    assert worker.running is False


async def test_retention_preflight_exige_indice_0022(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    worker = TerminalScheduledActionsRetentionWorker(
        action_sessions,
        retention_days=30,
        interval_seconds=3600,
        action_limit=10,
    )
    await worker.preflight()

    async with action_sessions() as session:
        await session.execute(text("DROP INDEX ix_scheduled_actions_terminal_retention"))
        await session.commit()

    with pytest.raises(RuntimeError, match="índice.*0022"):
        await worker.preflight()
