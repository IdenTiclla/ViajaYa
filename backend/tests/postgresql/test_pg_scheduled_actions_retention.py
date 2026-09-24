"""Bounded retention of scheduled_actions on real PostgreSQL."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.application.use_cases.purge_terminal_scheduled_actions import (
    PurgeTerminalScheduledActions,
)
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.scheduled_actions_retention import (
    SqlAlchemyTerminalScheduledActionsRetention,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork


def _terminal(status: str, terminal_at: datetime) -> ScheduledActionModel:
    action_id = uuid.uuid4()
    return ScheduledActionModel(
        id=action_id,
        dedupe_key=f"expire_offer:{action_id}",
        action_type="expire_offer",
        aggregate_id=uuid.uuid4(),
        generation=1,
        execute_at=terminal_at,
        payload={"offer_id": str(action_id)},
        status=status,
        attempts=1,
        next_attempt_at=terminal_at,
        last_error="RuntimeError" if status == "dead" else None,
        terminal_at=terminal_at,
        created_at=terminal_at,
        updated_at=terminal_at,
    )


async def test_dos_purgas_concurrentes_eliminan_chunks_disjuntos_y_conservan_dead(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    now = datetime.now(UTC)
    old_at = now - timedelta(days=31)
    async with sessions() as session:
        session.add_all(
            [
                _terminal("succeeded", old_at - timedelta(seconds=index))
                for index in range(4)
            ]
            + [_terminal("dead", old_at - timedelta(minutes=1))]
        )
        await session.commit()

    async def purge_chunk() -> int:
        async with sessions() as session:
            return await PurgeTerminalScheduledActions(
                SqlAlchemyTerminalScheduledActionsRetention(session),
                SqlAlchemyUnitOfWork(session),
            ).execute(now, retention_days=30, action_limit=2)

    deleted = await asyncio.gather(purge_chunk(), purge_chunk())

    async with sessions() as session:
        remaining_statuses = list(
            (await session.execute(select(ScheduledActionModel.status))).scalars()
        )
    assert sum(deleted) == 4
    assert remaining_statuses == ["dead"]
