"""Worker cancelable para retención opt-in de la outbox publicada."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.dto import PublishedRealtimeOutboxRetentionResult
from app.application.use_cases.purge_published_realtime_outbox import (
    PurgePublishedRealtimeOutbox,
)
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.db.outbox_retention import (
    SqlAlchemyPublishedRealtimeOutboxRetention,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class PublishedRealtimeOutboxRetentionWorker:
    """Drena en chunks sin compartir sesión ni transacción con el dispatcher."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        retention_days: int,
        interval_seconds: float,
        batch_limit: int,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        if retention_days <= 0:
            raise ValueError("La retención publicada debe ser mayor a cero.")
        if interval_seconds <= 0:
            raise ValueError("El intervalo de retención debe ser positivo.")
        if batch_limit <= 0:
            raise ValueError("El límite de retención debe ser positivo.")
        self._session_factory = session_factory
        self._retention_days = retention_days
        self._interval_seconds = interval_seconds
        self._batch_limit = batch_limit
        self._clock = clock
        self._stop_event = asyncio.Event()
        self._running = False
        self._last_error: str | None = None
        self._deleted_batch_count = 0
        self._deleted_event_count = 0

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def deleted_batch_count(self) -> int:
        return self._deleted_batch_count

    @property
    def deleted_event_count(self) -> int:
        return self._deleted_event_count

    async def preflight(self) -> None:
        """Exige la columna y el índice de 0021 antes de limpiar."""
        async with self._session_factory() as session:
            try:
                await session.execute(
                    select(
                        RealtimeOutboxModel.batch_id,
                        RealtimeOutboxModel.batch_size,
                        RealtimeOutboxModel.published_at,
                    ).limit(1)
                )
                connection = await session.connection()
                index_names = await connection.run_sync(
                    lambda sync_connection: {
                        str(index["name"])
                        for index in inspect(sync_connection).get_indexes(
                            RealtimeOutboxModel.__tablename__
                        )
                    }
                )
                if "ix_realtime_outbox_published_retention" not in index_names:
                    raise RuntimeError(
                        "Falta el índice de retención de la migración 0021."
                    )
            finally:
                await session.rollback()

    async def purge_once(self, now: datetime) -> PublishedRealtimeOutboxRetentionResult:
        async with self._session_factory() as session:
            use_case = PurgePublishedRealtimeOutbox(
                SqlAlchemyPublishedRealtimeOutboxRetention(session),
                SqlAlchemyUnitOfWork(session),
            )
            return await use_case.execute(
                now,
                retention_days=self._retention_days,
                batch_limit=self._batch_limit,
            )

    async def run(self) -> None:
        if self._running:
            raise RuntimeError("El worker de retención ya está en ejecución.")
        self._running = True
        logger.info("Worker de retención de outbox publicado iniciado.")
        try:
            while not self._stop_event.is_set():
                cycle_now = self._clock()
                try:
                    result = await self.purge_once(cycle_now)
                    self._last_error = None
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001 - loop operativo resiliente
                    self._last_error = type(error).__name__
                    logger.error(
                        "Falló un ciclo de retención de outbox (%s).",
                        self._last_error,
                    )
                    await self._wait_for_cycle()
                    continue

                self._deleted_batch_count += result.batch_count
                self._deleted_event_count += result.event_count
                if result.batch_count:
                    logger.info(
                        "Retención de outbox eliminó %s batches y %s eventos publicados.",
                        result.batch_count,
                        result.event_count,
                    )

                # Un solo chunk por intervalo evita que un backlog histórico
                # compita indefinidamente con publicación y tráfico de negocio.
                await self._wait_for_cycle()
        finally:
            self._running = False
            logger.info("Worker de retención de outbox detenido.")

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
