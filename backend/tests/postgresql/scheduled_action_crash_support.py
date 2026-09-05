"""Proceso hijo coordinado para el smoke de crash de scheduled_actions."""

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
        raise RuntimeError("El smoke de scheduler requiere postgresql+asyncpg.")
    if not (database.startswith("test_") or database.endswith("_test")):
        raise RuntimeError("El smoke de scheduler requiere una base desechable.")


def run_claim_process(
    database_url: str,
    claim_at_iso: str,
    reached: Any,
    release: Any,
) -> None:
    """Confirma un claim y espera para que el padre termine el proceso."""
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
                    raise RuntimeError("No había una acción vencida para reclamar.")
                await session.commit()
            reached.set()
            released = await asyncio.to_thread(release.wait, 30)
            if not released:
                raise TimeoutError("La coordinación del smoke de scheduler venció.")
        finally:
            await engine.dispose()

    asyncio.run(run())
