"""Worker concurrente y cancelable de acciones programadas."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.application.dto import DispatchScheduledActionResult, ScheduledAction
from app.application.exceptions import (
    InvalidScheduledActionError,
    UnsupportedScheduledActionError,
)
from app.application.interfaces import (
    MissingScheduledActionsReconciler,
    ScheduledActionExecutor,
)
from app.application.use_cases.claim_scheduled_action import ClaimScheduledAction
from app.application.use_cases.reconcile_missing_scheduled_actions import (
    ReconcileMissingScheduledActions,
)
from app.application.use_cases.record_scheduled_action_failure import (
    RecordScheduledActionFailure,
)
from app.infrastructure.db.clock import DatabaseClock, database_utc_now
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork

logger = logging.getLogger(__name__)


class ScheduledActionsWorker:
    """Claim in short transactions and run each effect in a new session."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        executor: ScheduledActionExecutor,
        *,
        poll_interval_seconds: float,
        lease_seconds: float,
        handler_timeout_seconds: float,
        max_attempts: int,
        retry_base_seconds: float,
        retry_max_seconds: float,
        clock: DatabaseClock = database_utc_now,
        reconciler_factory: (
            Callable[[AsyncSession], MissingScheduledActionsReconciler] | None
        ) = None,
        reconciliation_batch_limit: int = 1000,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("El intervalo de polling debe ser positivo.")
        if lease_seconds <= 0:
            raise ValueError("El lease debe ser positivo.")
        if not 0 < handler_timeout_seconds < lease_seconds:
            raise ValueError("El timeout del handler debe ser menor al lease.")
        if max_attempts < 1:
            raise ValueError("La cantidad máxima de intentos debe ser positiva.")
        if retry_base_seconds <= 0 or retry_max_seconds < retry_base_seconds:
            raise ValueError("El backoff configurado no es válido.")
        if reconciliation_batch_limit <= 0:
            raise ValueError("El límite de reconciliación debe ser positivo.")
        self._session_factory = session_factory
        self._executor = executor
        self._poll_interval_seconds = poll_interval_seconds
        self._lease_seconds = lease_seconds
        self._handler_timeout_seconds = handler_timeout_seconds
        self._max_attempts = max_attempts
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds
        self._clock = clock
        self._reconciler_factory = reconciler_factory
        self._reconciliation_batch_limit = reconciliation_batch_limit
        self._next_reconciliation_at = 0.0
        self._stop_event = asyncio.Event()
        self._running = False
        self._last_error: str | None = None
        self._claimed_count = 0
        self._succeeded_count = 0
        self._deferred_count = 0
        self._retried_count = 0
        self._dead_count = 0
        self._recovered_lease_count = 0

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def claimed_count(self) -> int:
        return self._claimed_count

    @property
    def succeeded_count(self) -> int:
        return self._succeeded_count

    @property
    def deferred_count(self) -> int:
        return self._deferred_count

    @property
    def retried_count(self) -> int:
        return self._retried_count

    @property
    def dead_count(self) -> int:
        return self._dead_count

    @property
    def recovered_lease_count(self) -> int:
        return self._recovered_lease_count

    async def preflight(self) -> None:
        """Require the full table and its operational indexes before starting."""
        async with self._session_factory() as session:
            try:
                await session.execute(select(ScheduledActionModel).limit(1))
                connection = await session.connection()
                index_names = await connection.run_sync(
                    lambda sync_connection: {
                        str(index["name"])
                        for index in inspect(sync_connection).get_indexes(
                            ScheduledActionModel.__tablename__
                        )
                    }
                )
                required = {
                    "ix_scheduled_actions_due",
                    "ix_scheduled_actions_stale",
                    "ix_scheduled_actions_terminal_retention",
                }
                if not required <= index_names:
                    raise RuntimeError(
                        "Faltan índices operativos de la migración 0022."
                    )
            finally:
                await session.rollback()

    async def dispatch_once(self) -> DispatchScheduledActionResult:
        await self._reconcile_missing_offer_actions()
        action = await self._claim()
        if action is None:
            return DispatchScheduledActionResult(status="empty")

        self._claimed_count += 1
        if action.lease_recovered:
            self._recovered_lease_count += 1
        if action.attempts > self._max_attempts:
            return await self._record_failure(
                action,
                "LeaseAttemptsExhausted",
                force_terminal=True,
            )

        try:
            outcome = await asyncio.wait_for(
                self._executor.execute(action),
                timeout=self._handler_timeout_seconds,
            )
        except asyncio.CancelledError:
            # A SIGTERM/cancel leaves the lease running; another worker recovers it.
            raise
        except (InvalidScheduledActionError, UnsupportedScheduledActionError) as error:
            return await self._record_failure(
                action,
                type(error).__name__,
                force_terminal=True,
            )
        except Exception as error:  # noqa: BLE001 - retry durable y sanitizado
            return await self._record_failure(
                action,
                type(error).__name__,
            )

        if outcome == "lost_lease":
            return DispatchScheduledActionResult(
                status="lost_lease",
                action_id=action.id,
                action_type=action.action_type,
                attempts=action.attempts,
                lease_recovered=action.lease_recovered,
            )
        if outcome == "deferred":
            self._deferred_count += 1
            return DispatchScheduledActionResult(
                status="deferred",
                action_id=action.id,
                action_type=action.action_type,
                attempts=action.attempts,
                lease_recovered=action.lease_recovered,
            )
        self._succeeded_count += 1
        return DispatchScheduledActionResult(
            status="succeeded",
            action_id=action.id,
            action_type=action.action_type,
            attempts=action.attempts,
            lease_recovered=action.lease_recovered,
        )

    async def run(self) -> None:
        if self._running:
            raise RuntimeError("El worker de scheduled_actions ya está en ejecución.")
        self._running = True
        logger.info("Worker de scheduled_actions iniciado.")
        try:
            while not self._stop_event.is_set():
                try:
                    result = await self.dispatch_once()
                    self._last_error = None
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001 - loop operativo resiliente
                    self._last_error = type(error).__name__
                    logger.error(
                        "Falló un ciclo de scheduled_actions (%s).",
                        self._last_error,
                    )
                    await self._wait_for_work()
                    continue

                if result.status in {"empty", "deferred", "retried", "lost_lease"}:
                    await self._wait_for_work()
                elif result.status == "dead":
                    logger.error(
                        "Una scheduled_action terminó dead (%s, intento %s).",
                        result.action_type,
                        result.attempts,
                    )
        finally:
            self._running = False
            logger.info("Worker de scheduled_actions detenido.")

    def stop(self) -> None:
        self._stop_event.set()

    async def _claim(self) -> ScheduledAction | None:
        async with self._session_factory() as session:
            now = await self._clock(session)
            return await ClaimScheduledAction(
                SqlAlchemyScheduledActionRepository(session),
                SqlAlchemyUnitOfWork(session),
            ).execute(
                now,
                now - timedelta(seconds=self._lease_seconds),
            )

    async def _reconcile_missing_offer_actions(self) -> None:
        if self._reconciler_factory is None:
            return
        loop = asyncio.get_running_loop()
        loop_now = loop.time()
        if loop_now < self._next_reconciliation_at:
            return
        # During a backlog the loop consumes without sleeping. Limiting the query to the
        # polling interval avoids scanning offers before every claim.
        self._next_reconciliation_at = loop_now + self._poll_interval_seconds
        async with self._session_factory() as session:
            created_count = await ReconcileMissingScheduledActions(
                self._reconciler_factory(session),
                SqlAlchemyUnitOfWork(session),
            ).execute(self._reconciliation_batch_limit)
        if created_count:
            logger.warning(
                "Reconciliación reparó %s acciones durables ausentes.",
                created_count,
            )

    async def _record_failure(
        self,
        action: ScheduledAction,
        error_code: str,
        *,
        force_terminal: bool = False,
    ) -> DispatchScheduledActionResult:
        async with self._session_factory() as session:
            now = await self._clock(session)
            result = await RecordScheduledActionFailure(
                SqlAlchemyScheduledActionRepository(session),
                SqlAlchemyUnitOfWork(session),
                max_attempts=self._max_attempts,
                retry_base_seconds=self._retry_base_seconds,
                retry_max_seconds=self._retry_max_seconds,
            ).execute(
                action,
                error_code,
                now,
                force_terminal=force_terminal,
            )
        if result.status == "retried":
            self._retried_count += 1
        elif result.status == "dead":
            self._dead_count += 1
        return result

    async def _wait_for_work(self) -> None:
        try:
            await asyncio.wait_for(
                self._stop_event.wait(),
                timeout=self._poll_interval_seconds,
            )
        except TimeoutError:
            pass
