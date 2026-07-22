"""Loops operativos de outbox para los modos sombra y live local."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.dto import DispatchRealtimeOutboxResult
from app.application.interfaces import (
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
)
from app.application.use_cases.dispatch_realtime_outbox_batch import (
    DispatchRealtimeOutboxBatch,
)
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class ShadowRealtimeOutboxDispatcher:
    """Drena batches válidos sin enviarlos al hub local ni a Redis."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        validator: RealtimeOutboxBatchValidator,
        *,
        poll_interval_seconds: float,
        retry_base_seconds: float,
        retry_max_seconds: float,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("El intervalo de polling debe ser positivo.")
        if retry_base_seconds <= 0:
            raise ValueError("El backoff base debe ser positivo.")
        if retry_max_seconds < retry_base_seconds:
            raise ValueError("El backoff máximo no puede ser menor al base.")
        self._session_factory = session_factory
        self._validator = validator
        self._poll_interval_seconds = poll_interval_seconds
        # Se conserva para clasificar fallos transitorios cuando exista un
        # transporte live; los errores de contrato nunca consumen backoff.
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds
        self._publisher: RealtimeOutboxBatchPublisher | None = None
        self._mode_label = "sombra"
        self._clock = clock
        self._stop_event = asyncio.Event()
        self._running = False
        self._last_error: str | None = None
        self._quarantined_batch_count = 0
        self._last_quarantined_batch_id: str | None = None
        self._last_quarantine_code: str | None = None

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_error(self) -> str | None:
        """Nombre sanitizado del último fallo operativo, si lo hubo."""
        return self._last_error

    @property
    def quarantined_batch_count(self) -> int:
        """Cantidad de batches apartados terminalmente desde el arranque."""
        return self._quarantined_batch_count

    @property
    def last_quarantined_batch_id(self) -> str | None:
        """Último batch apartado, sin incluir topic ni payload."""
        return self._last_quarantined_batch_id

    @property
    def last_quarantine_code(self) -> str | None:
        """Código estable del último batch apartado."""
        return self._last_quarantine_code

    async def preflight(self) -> None:
        """Falla al arrancar si alguna migración 0018–0020 no está aplicada."""
        async with self._session_factory() as session:
            try:
                # Seleccionar los modelos completos detecta también una tabla
                # parcial a la que le falte alguna columna hasta la revisión 0020.
                await session.execute(select(RealtimeOutboxModel).limit(1))
                await session.execute(select(RealtimeAggregateVersionModel).limit(1))
                await session.execute(select(RealtimeStreamVersionModel).limit(1))
            finally:
                await session.rollback()

    async def dispatch_once(self) -> DispatchRealtimeOutboxResult:
        """Procesa como máximo un batch dentro de una sesión nueva."""
        async with self._session_factory() as session:
            use_case = DispatchRealtimeOutboxBatch(
                SqlAlchemyRealtimeOutbox(session),
                SqlAlchemyUnitOfWork(session),
                self._validator,
                self._publisher,
                retry_base_seconds=self._retry_base_seconds,
                retry_max_seconds=self._retry_max_seconds,
            )
            return await use_case.execute(self._clock())

    async def run(self) -> None:
        """Drena el backlog y espera de forma cancelable cuando queda vacío."""
        if self._running:
            raise RuntimeError(f"El dispatcher {self._mode_label} ya está en ejecución.")
        self._running = True
        logger.info("Dispatcher de outbox iniciado en modo %s.", self._mode_label)
        try:
            while not self._stop_event.is_set():
                try:
                    result = await self.dispatch_once()
                    self._last_error = None
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001 - loop resiliente
                    self._last_error = type(error).__name__
                    logger.error(
                        "Falló una iteración del dispatcher %s (%s).",
                        self._mode_label,
                        self._last_error,
                    )
                    await self._wait_for_work()
                    continue

                if result.status == "empty":
                    await self._wait_for_work()
                elif result.status == "quarantined":
                    self._quarantined_batch_count += 1
                    self._last_quarantined_batch_id = str(result.batch_id)
                    self._last_quarantine_code = result.quarantine_code
                    logger.error(
                        "El dispatcher %s puso en cuarentena terminal "
                        "el batch %s (%s).",
                        self._mode_label,
                        self._last_quarantined_batch_id,
                        self._last_quarantine_code,
                    )
        finally:
            self._running = False
            logger.info("Dispatcher de outbox %s detenido.", self._mode_label)

    def stop(self) -> None:
        """Solicita un cierre coordinado y despierta el polling actual."""
        self._stop_event.set()

    async def _wait_for_work(self) -> None:
        try:
            await asyncio.wait_for(
                self._stop_event.wait(),
                timeout=self._poll_interval_seconds,
            )
        except TimeoutError:
            pass


class LocalRealtimeOutboxDispatcher(ShadowRealtimeOutboxDispatcher):
    """Publica envelopes v2 al hub local antes de confirmar cada batch."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        validator: RealtimeOutboxBatchValidator,
        publisher: RealtimeOutboxBatchPublisher,
        *,
        poll_interval_seconds: float,
        retry_base_seconds: float,
        retry_max_seconds: float,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        super().__init__(
            session_factory,
            validator,
            poll_interval_seconds=poll_interval_seconds,
            retry_base_seconds=retry_base_seconds,
            retry_max_seconds=retry_max_seconds,
            clock=clock,
        )
        self._publisher = publisher
        self._mode_label = "live_local"
