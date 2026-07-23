"""Coordinación de procesos consumidores de la outbox realtime."""

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
    """Mantiene la exclusión de modos realtime en una conexión dedicada.

    El lock se deriva del nombre de la base para no hacer colisionar entornos
    que compartan un mismo clúster PostgreSQL. La conexión usa autocommit: queda
    reservada durante el lifespan sin mantener una transacción ociosa abierta.
    Durante el rolling deploy todos los modos conservan además la clave de la
    versión anterior: shadow la comparte y ambos live la toman en exclusiva.
    Esto impide mezclar binarios viejos/nuevos. ``live_redis`` solo comparte la
    clave legada cuando el despliegue certifica presencia compartida; un binario
    anterior, que todavía la toma en exclusiva, continúa bloqueando el rolling.
    Un mutex efímero
    serializa únicamente la transición mientras cada grupo comprueba que el
    opuesto esté vacío.

    SQLite solo se admite para las pruebas locales. En ese dialecto el método
    devuelve ``False`` y no finge una exclusión que SQLite no puede garantizar
    entre procesos.
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
        """Adquiere la exclusión o falla si otra instancia ya la posee."""
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
        """Comprueba la misma sesión propietaria sin readquirir el lock.

        Comparar el PID evita considerar sana una reconexión transparente: una
        nueva sesión ya no posee el advisory lock original.
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
        """Libera la exclusión y devuelve la conexión dedicada al pool."""
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
                # No se registra el error del driver para no filtrar el DSN.
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
