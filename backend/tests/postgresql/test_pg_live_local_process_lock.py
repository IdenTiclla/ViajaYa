"""Exclusión PostgreSQL entre procesos para el dispatcher ``live_local``."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.infrastructure.db.advisory_lock import (
    LiveLocalProcessLockUnavailableError,
    PostgreSQLLiveLocalProcessLock,
)


async def test_live_local_lock_excludes_another_process_and_is_recoverable(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(
        pg_test_db.engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    owner = PostgreSQLLiveLocalProcessLock(sessions)
    contender = PostgreSQLLiveLocalProcessLock(sessions)

    assert await owner.acquire() is True
    assert owner.enforced is True
    assert await owner.check() is True
    with pytest.raises(
        LiveLocalProcessLockUnavailableError,
        match="modo realtime incompatible",
    ):
        await contender.acquire()

    await owner.release()
    assert owner.enforced is False
    assert await owner.check() is False

    successor = PostgreSQLLiveLocalProcessLock(sessions)
    assert await successor.acquire() is True
    assert successor.enforced is True
    await successor.release()


async def test_shared_shadow_locks_block_live_but_not_each_other(pg_test_db) -> None:
    sessions = async_sessionmaker(
        pg_test_db.engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    shadow_a = PostgreSQLLiveLocalProcessLock(sessions, exclusive=False)
    shadow_b = PostgreSQLLiveLocalProcessLock(sessions, exclusive=False)
    live = PostgreSQLLiveLocalProcessLock(sessions)

    assert await shadow_a.acquire() is True
    assert await shadow_b.acquire() is True
    with pytest.raises(LiveLocalProcessLockUnavailableError):
        await live.acquire()

    await shadow_b.release()
    await shadow_a.release()
    successor = PostgreSQLLiveLocalProcessLock(sessions)
    assert await successor.acquire() is True
    await successor.release()
