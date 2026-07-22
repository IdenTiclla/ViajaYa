"""Exclusión PostgreSQL entre procesos para el dispatcher ``live_local``."""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import text
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

    assert await asyncio.gather(shadow_a.acquire(), shadow_b.acquire()) == [True, True]
    with pytest.raises(LiveLocalProcessLockUnavailableError):
        await live.acquire()

    await shadow_b.release()
    await shadow_a.release()
    successor = PostgreSQLLiveLocalProcessLock(sessions)
    assert await successor.acquire() is True
    await successor.release()


async def test_live_redis_es_exclusivo_hasta_compartir_presencia(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(
        pg_test_db.engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    redis_a = PostgreSQLLiveLocalProcessLock(sessions, mode="live_redis")
    redis_b = PostgreSQLLiveLocalProcessLock(sessions, mode="live_redis")
    shadow = PostgreSQLLiveLocalProcessLock(sessions, mode="shadow")
    live_local = PostgreSQLLiveLocalProcessLock(sessions, mode="live_local")

    assert await redis_a.acquire() is True
    with pytest.raises(LiveLocalProcessLockUnavailableError):
        await redis_b.acquire()
    with pytest.raises(LiveLocalProcessLockUnavailableError):
        await shadow.acquire()
    with pytest.raises(LiveLocalProcessLockUnavailableError):
        await live_local.acquire()

    await redis_a.release()
    successor = PostgreSQLLiveLocalProcessLock(sessions, mode="live_redis")
    assert await successor.acquire() is True
    await successor.release()


async def test_clave_legada_impide_mezclar_binarios_en_rolling_deploy(
    pg_test_db,
) -> None:
    sessions = async_sessionmaker(
        pg_test_db.engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    legacy_connection = await pg_test_db.engine.connect()
    legacy_connection = await legacy_connection.execution_options(
        isolation_level="AUTOCOMMIT"
    )
    legacy_expression = (
        "hashtextextended(current_database() || "
        "':viajaya:realtime:live_local', 0)"
    )
    try:
        old_shadow_acquired = bool(
            (
                await legacy_connection.execute(
                    text(
                        "SELECT pg_try_advisory_lock_shared(" + legacy_expression + ")"
                    )
                )
            ).scalar_one()
        )
        assert old_shadow_acquired is True

        new_shadow = PostgreSQLLiveLocalProcessLock(sessions, mode="shadow")
        new_redis = PostgreSQLLiveLocalProcessLock(sessions, mode="live_redis")
        assert await new_shadow.acquire() is True
        with pytest.raises(LiveLocalProcessLockUnavailableError):
            await new_redis.acquire()
        await new_shadow.release()

        released = bool(
            (
                await legacy_connection.execute(
                    text("SELECT pg_advisory_unlock_shared(" + legacy_expression + ")")
                )
            ).scalar_one()
        )
        assert released is True

        old_live_acquired = bool(
            (
                await legacy_connection.execute(
                    text("SELECT pg_try_advisory_lock(" + legacy_expression + ")")
                )
            ).scalar_one()
        )
        assert old_live_acquired is True
        new_shadow_after_old_live = PostgreSQLLiveLocalProcessLock(
            sessions,
            mode="shadow",
        )
        with pytest.raises(LiveLocalProcessLockUnavailableError):
            await new_shadow_after_old_live.acquire()
        old_live_released = bool(
            (
                await legacy_connection.execute(
                    text("SELECT pg_advisory_unlock(" + legacy_expression + ")")
                )
            ).scalar_one()
        )
        assert old_live_released is True
    finally:
        await legacy_connection.close()
