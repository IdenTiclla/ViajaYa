"""Coordinated child process for the scheduled_actions crash smoke."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)


def _validate_test_database_url(database_url: str) -> None:
    url = make_url(database_url)
    database = url.database or ""
    if url.drivername != "postgresql+asyncpg":
        raise RuntimeError("The scheduler smoke requires postgresql+asyncpg.")
    if not (database.startswith("test_") or database.endswith("_test")):
        raise RuntimeError("The scheduler smoke requires a disposable database.")


def run_claim_process(
    database_url: str,
    claim_at_iso: str,
    reached: Any,
    release: Any,
) -> None:
    """Confirm a claim and wait so the parent kills the process."""
    _validate_test_database_url(database_url)

    async def run() -> None:
        engine = create_async_engine(database_url, poolclass=NullPool)
        sessions = async_sessionmaker[AsyncSession](engine, expire_on_commit=False)
        claim_at = datetime.fromisoformat(claim_at_iso)
        try:
            async with sessions() as session:
                action = await SqlAlchemyScheduledActionRepository(session).claim_due(
                    claim_at,
                    claim_at - timedelta(minutes=1),
                )
                if action is None:
                    raise RuntimeError("There was no due action to claim.")
                await session.commit()
            reached.set()
            released = await asyncio.to_thread(release.wait, 30)
            if not released:
                raise TimeoutError("The scheduler smoke coordination timed out.")
        finally:
            await engine.dispose()

    asyncio.run(run())
