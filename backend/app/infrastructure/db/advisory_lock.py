"""Coordination of the realtime outbox consumer processes."""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)

logger = logging.getLogger(__name__)

_LEGACY_LOCK_EXPRESSION = (
    "hashtextextended(current_database() || ':viajaya:realtime:live_local', 0)"
)
_SHADOW_LOCK_EXPRESSION = (
    "hashtextextended(current_database() || ':viajaya:realtime:shadow-group', 0)"
)
_LIVE_LOCK_EXPRESSION = (
    "hashtextextended(current_database() || ':viajaya:realtime:live-group', 0)"
)
_MODE_TRANSITION_LOCK_EXPRESSION = (
    "hashtextextended(current_database() || ':viajaya:realtime:mode-transition', 0)"
)


class LiveLocalProcessLockUnavailableError(RuntimeError):
    """Otro modo consumidor mantiene un lock incompatible."""


class PostgreSQLLiveLocalProcessLock:
    """Hold the realtime mode exclusion on a dedicated connection.

    The lock is derived from the database name so that environments sharing the
    same PostgreSQL cluster do not collide. The connection uses autocommit: it stays
    reserved for the lifespan without keeping an idle transaction open.
    During a rolling deploy every mode also keeps the previous version's
    key: shadow shares it and both live modes take it exclusively.
    This prevents mixing old/new binaries. ``live_redis`` only shares the
    legacy key when the deployment certifies shared presence; an older
    binary, which still takes it exclusively, keeps blocking the rollout.
    An ephemeral mutex
    serializes only the transition while each group checks that the
    opposite one is empty.

    SQLite is only supported for local tests. In that dialect the method
    returns ``False`` and does not pretend to provide an exclusion SQLite cannot guarantee
    across processes.
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        exclusive: bool = True,
        mode: Literal["shadow", "live_local", "live_redis"] | None = None,
        allow_live_redis_multiworker: bool = False,
    ) -> None:
        self._session_factory = session_factory
        self._mode = mode or ("live_local" if exclusive else "shadow")
        if allow_live_redis_multiworker and self._mode != "live_redis":
            raise ValueError("Solo live_redis puede habilitar el lock multiworker.")
        self._allow_live_redis_multiworker = allow_live_redis_multiworker
        self._connection: AsyncConnection | None = None
        self._dialect_name: str | None = None
        self._backend_pid: int | None = None
        self._held_expression: str | None = None
        self._held_shared = False
        self._legacy_held_shared = False
        self._operation_lock = asyncio.Lock()

    @property
    def enforced(self) -> bool:
        """Indica si PostgreSQL mantiene actualmente el lock dedicado."""
        return self._connection is not None

    @property
    def dialect_name(self) -> str | None:
        return self._dialect_name

    async def acquire(self) -> bool:
        """Acquire the exclusion or fail if another instance already holds it."""
        if self._connection is not None or self._dialect_name is not None:
            raise RuntimeError("El lock live_local ya fue inicializado.")

        engine = await self._resolve_engine()
        self._dialect_name = engine.dialect.name
        if self._dialect_name == "sqlite":
            logger.warning("SQLite no aplica coordinación multiproceso realtime.")
            return False
        if self._dialect_name != "postgresql":
            raise RuntimeError("El lock realtime requiere PostgreSQL.")

        connection = await engine.connect()
        try:
            connection = await connection.execution_options(
                isolation_level="AUTOCOMMIT"
            )
            held_expression, held_shared, conflicting_expression = {
                "shadow": (
                    _SHADOW_LOCK_EXPRESSION,
                    True,
                    _LIVE_LOCK_EXPRESSION,
                ),
                "live_redis": (
                    _LIVE_LOCK_EXPRESSION,
                    True,
                    _SHADOW_LOCK_EXPRESSION,
                ),
                "live_local": (
                    _LIVE_LOCK_EXPRESSION,
                    False,
                    _SHADOW_LOCK_EXPRESSION,
                ),
            }[self._mode]
            legacy_shared = self._mode == "shadow" or (
                self._mode == "live_redis"
                and self._allow_live_redis_multiworker
            )
            await self._lock(
                connection,
                _MODE_TRANSITION_LOCK_EXPRESSION,
                shared=False,
            )
            try:
                backend_pid = int(
                    (
                        await connection.execute(text("SELECT pg_backend_pid()"))
                    ).scalar_one()
                )
                legacy_acquired = await self._try_lock(
                    connection,
                    _LEGACY_LOCK_EXPRESSION,
                    legacy_shared,
                )
                if not legacy_acquired:
                    raise LiveLocalProcessLockUnavailableError(
                        "Existe un modo realtime incompatible activo para esta base."
                    )
                held_acquired = False
                try:
                    held_acquired = await self._try_lock(
                        connection,
                        held_expression,
                        held_shared,
                    )
                    if not held_acquired:
                        raise LiveLocalProcessLockUnavailableError(
                            "Existe un modo realtime incompatible activo para esta base."
                        )
                    conflicting_acquired = await self._try_lock(
                        connection,
                        conflicting_expression,
                        shared=False,
                    )
                    if not conflicting_acquired:
                        raise LiveLocalProcessLockUnavailableError(
                            "Existe un modo realtime incompatible activo para esta base."
                        )
                    await self._unlock(
                        connection,
                        conflicting_expression,
                        shared=False,
                    )
                except BaseException:
                    if held_acquired:
                        await self._unlock(
                            connection,
                            held_expression,
                            held_shared,
                        )
                    await self._unlock(
                        connection,
                        _LEGACY_LOCK_EXPRESSION,
                        legacy_shared,
                    )
                    raise
            finally:
                await self._unlock(
                    connection,
                    _MODE_TRANSITION_LOCK_EXPRESSION,
                    shared=False,
                )
        except BaseException:
            await connection.close()
            raise

        self._connection = connection
        self._backend_pid = backend_pid
        self._held_expression = held_expression
        self._held_shared = held_shared
        self._legacy_held_shared = legacy_shared
        return True

    async def check(self) -> bool:
        """Check the same owning session without re-acquiring the lock.

        Comparing the PID avoids treating a transparent reconnection as healthy: a
        new session no longer holds the original advisory lock.
        """
        async with self._operation_lock:
            if self._dialect_name == "sqlite":
                return True
            connection = self._connection
            if (
                connection is None
                or self._backend_pid is None
                or connection.invalidated
            ):
                return False
            try:
                current_pid = int(
                    (
                        await connection.execute(text("SELECT pg_backend_pid()"))
                    ).scalar_one()
                )
            except Exception:  # noqa: BLE001 - probe fail-closed y sanitizado
                logger.error("Se perdió la sesión propietaria del lock realtime.")
                return False
            return current_pid == self._backend_pid

    async def release(self) -> None:
        """Release the exclusion and return the dedicated connection to the pool."""
        async with self._operation_lock:
            connection = self._connection
            self._connection = None
            self._backend_pid = None
            held_expression = self._held_expression
            held_shared = self._held_shared
            legacy_held_shared = self._legacy_held_shared
            self._held_expression = None
            self._held_shared = False
            self._legacy_held_shared = False
            if connection is None:
                return

            try:
                if connection.invalidated:
                    return
                if held_expression is None:
                    raise RuntimeError("El lock realtime perdió su identidad.")
                released = await self._unlock(
                    connection,
                    held_expression,
                    held_shared,
                )
                if not released:
                    logger.error(
                        "PostgreSQL informó que el lock realtime no estaba tomado."
                    )
                legacy_released = await self._unlock(
                    connection,
                    _LEGACY_LOCK_EXPRESSION,
                    legacy_held_shared,
                )
                if not legacy_released:
                    logger.error(
                        "PostgreSQL informó que el lock realtime legado no estaba tomado."
                    )
            except Exception:  # noqa: BLE001 - cerrar libera el lock
                # The driver error is not logged so the DSN does not leak.
                logger.error("No se pudo liberar limpiamente el lock realtime.")
                await connection.invalidate()
            finally:
                await connection.close()

    @staticmethod
    async def _try_lock(
        connection: AsyncConnection,
        expression: str,
        shared: bool,
    ) -> bool:
        function = "pg_try_advisory_lock_shared" if shared else "pg_try_advisory_lock"
        return bool(
            (
                await connection.execute(text(f"SELECT {function}({expression})"))
            ).scalar_one()
        )

    @staticmethod
    async def _lock(
        connection: AsyncConnection,
        expression: str,
        shared: bool,
    ) -> None:
        function = "pg_advisory_lock_shared" if shared else "pg_advisory_lock"
        await connection.execute(text(f"SELECT {function}({expression})"))

    @staticmethod
    async def _unlock(
        connection: AsyncConnection,
        expression: str,
        shared: bool,
    ) -> bool:
        function = "pg_advisory_unlock_shared" if shared else "pg_advisory_unlock"
        return bool(
            (
                await connection.execute(text(f"SELECT {function}({expression})"))
            ).scalar_one()
        )

    async def _resolve_engine(self) -> AsyncEngine:
        session = self._session_factory()
        try:
            engine = session.bind
            if not isinstance(engine, AsyncEngine):
                raise RuntimeError("La factoría de sesiones no tiene un AsyncEngine.")
            return engine
        finally:
            await session.close()
