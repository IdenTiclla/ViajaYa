"""Cancellable worker for the retention of terminal scheduled actions."""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.use_cases.purge_terminal_scheduled_actions import (
    PurgeTerminalScheduledActions,
)
from app.infrastructure.db.clock import DatabaseClock, database_utc_now
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.scheduled_actions_retention import (
    SqlAlchemyTerminalScheduledActionsRetention,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork

logger = logging.getLogger(__name__)


class TerminalScheduledActionsRetentionWorker:
    """Purge one chunk per interval with its own session and transaction."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        retention_days: int,
        interval_seconds: float,
        action_limit: int,
        clock: DatabaseClock = database_utc_now,
    ) -> None:
        if retention_days <= 0:
            raise ValueError("La retención de acciones debe ser mayor a cero.")
        if interval_seconds <= 0:
            raise ValueError("El intervalo de retención debe ser positivo.")
        if action_limit <= 0:
            raise ValueError("El límite de acciones debe ser positivo.")
        self._session_factory = session_factory
        self._retention_days = retention_days
        self._interval_seconds = interval_seconds
        self._action_limit = action_limit
        self._clock = clock
        self._stop_event = asyncio.Event()
        self._running = False
        self._last_error: str | None = None
        self._deleted_action_count = 0

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def deleted_action_count(self) -> int:
        return self._deleted_action_count

    async def preflight(self) -> None:
        """Require the table and the partial index added by migration 0022."""
        async with self._session_factory() as session:
            try:
                await session.execute(
                    select(
                        ScheduledActionModel.id,
                        ScheduledActionModel.status,
                        ScheduledActionModel.terminal_at,
                    ).limit(1)
                )
                connection = await session.connection()
                index_names = await connection.run_sync(
                    lambda sync_connection: {
                        str(index["name"])
                        for index in inspect(sync_connection).get_indexes(
                            ScheduledActionModel.__tablename__
                        )
                    }
                )
                if "ix_scheduled_actions_terminal_retention" not in index_names:
                    raise RuntimeError(
                        "Falta el índice de retención de la migración 0022."
                    )
            finally:
                await session.rollback()

    async def purge_once(self) -> int:
        async with self._session_factory() as session:
            now = await self._clock(session)
            use_case = PurgeTerminalScheduledActions(
                SqlAlchemyTerminalScheduledActionsRetention(session),
                SqlAlchemyUnitOfWork(session),
            )
            return await use_case.execute(
                now,
                retention_days=self._retention_days,
                action_limit=self._action_limit,
            )

    async def run(self) -> None:
        if self._running:
            raise RuntimeError("El worker de retención ya está en ejecución.")
        self._running = True
        logger.info("Worker de retención de acciones programadas iniciado.")
        try:
            while not self._stop_event.is_set():
                try:
                    deleted_count = await self.purge_once()
                    self._last_error = None
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001 - loop operativo resiliente
                    self._last_error = type(error).__name__
                    logger.error(
                        "Falló un ciclo de retención de acciones programadas (%s).",
                        self._last_error,
                    )
                    await self._wait_for_cycle()
                    continue

                self._deleted_action_count += deleted_count
                if deleted_count:
                    logger.info(
                        "Retención eliminó %s acciones programadas terminales.",
                        deleted_count,
                    )

                # One chunk per interval avoids competing continuously with
                # the action claim and business transactions.
                await self._wait_for_cycle()
        finally:
            self._running = False
            logger.info("Worker de retención de acciones programadas detenido.")

    def stop(self) -> None:
        self._stop_event.set()

    async def _wait_for_cycle(self) -> None:
        try:
            await asyncio.wait_for(
                self._stop_event.wait(),
                timeout=self._interval_seconds,
            )
        except TimeoutError:
            pass
