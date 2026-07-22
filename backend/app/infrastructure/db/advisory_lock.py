"""Coordinación de procesos consumidores de la outbox realtime."""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)

logger = logging.getLogger(__name__)

_LOCK_EXPRESSION = (
    "hashtextextended(current_database() || ':viajaya:realtime:live_local', 0)"
)


class LiveLocalProcessLockUnavailableError(RuntimeError):
    """Otro modo consumidor mantiene un lock incompatible."""


class PostgreSQLLiveLocalProcessLock:
    """Mantiene un advisory lock de sesión en una conexión dedicada.

    El lock se deriva del nombre de la base para no hacer colisionar entornos
    que compartan un mismo clúster PostgreSQL. La conexión usa autocommit: queda
    reservada durante el lifespan sin mantener una transacción ociosa abierta.
    Los dispatchers sombra toman el lock compartido y ``live_local`` lo toma
    exclusivo, por lo que un rolling deploy nunca mezcla ambos consumidores.

    SQLite solo se admite para las pruebas locales. En ese dialecto el método
    devuelve ``False`` y no finge una exclusión que SQLite no puede garantizar
    entre procesos.
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        exclusive: bool = True,
    ) -> None:
        self._session_factory = session_factory
        self._exclusive = exclusive
        self._connection: AsyncConnection | None = None
        self._dialect_name: str | None = None
        self._backend_pid: int | None = None
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
            logger.warning(
                "SQLite no aplica coordinación multiproceso realtime; "
                "este modo solo es válido en pruebas de un proceso."
            )
            return False
        if self._dialect_name != "postgresql":
            raise RuntimeError("El lock realtime requiere PostgreSQL.")

        connection = await engine.connect()
        try:
            connection = await connection.execution_options(
                isolation_level="AUTOCOMMIT"
            )
            lock_function = (
                "pg_try_advisory_lock"
                if self._exclusive
                else "pg_try_advisory_lock_shared"
            )
            backend_pid, acquired = (
                await connection.execute(
                    text(
                        "SELECT pg_backend_pid(), "
                        f"{lock_function}({_LOCK_EXPRESSION})"
                    )
                )
            ).one()
            if not acquired:
                raise LiveLocalProcessLockUnavailableError(
                    "Existe un modo realtime incompatible activo para esta base."
                )
        except BaseException:
            await connection.close()
            raise

        self._connection = connection
        self._backend_pid = int(backend_pid)
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
            if connection is None:
                return

            try:
                if connection.invalidated:
                    return
                unlock_function = (
                    "pg_advisory_unlock"
                    if self._exclusive
                    else "pg_advisory_unlock_shared"
                )
                released = bool(
                    (
                        await connection.execute(
                            text(f"SELECT {unlock_function}({_LOCK_EXPRESSION})")
                        )
                    ).scalar_one()
                )
                if not released:
                    logger.error(
                        "PostgreSQL informó que el lock realtime no estaba tomado."
                    )
            except Exception:  # noqa: BLE001 - cerrar libera el lock
                # No se registra el error del driver para no filtrar el DSN.
                logger.error("No se pudo liberar limpiamente el lock realtime.")
                await connection.invalidate()
            finally:
                await connection.close()

    async def _resolve_engine(self) -> AsyncEngine:
        session = self._session_factory()
        try:
            engine = session.bind
            if not isinstance(engine, AsyncEngine):
                raise RuntimeError("La factoría de sesiones no tiene un AsyncEngine.")
            return engine
        finally:
            await session.close()
