"""Lifecycle, retries y apagado del worker de acciones programadas."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Literal

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.application.dto import PendingScheduledAction, ScheduledAction
from app.application.interfaces import ScheduledActionExecutor
from app.infrastructure.config import Settings
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.scheduled_actions.worker import ScheduledActionsWorker
from app.main import create_app


@pytest_asyncio.fixture
async def action_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(ScheduledActionModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _schedule(
    sessions: async_sessionmaker[AsyncSession],
    now: datetime,
) -> None:
    aggregate_id = uuid.uuid4()
    async with sessions() as session:
        await SqlAlchemyScheduledActionRepository(session).schedule(
            PendingScheduledAction(
                dedupe_key=f"expire_offer:{aggregate_id}",
                action_type="expire_offer",
                aggregate_id=aggregate_id,
                generation=1,
                execute_at=now,
                payload={"offer_id": str(aggregate_id)},
            )
        )
        await session.commit()


class _SucceedingExecutor(ScheduledActionExecutor):
    def __init__(self, sessions: async_sessionmaker[AsyncSession], now: datetime) -> None:
        self._sessions = sessions
        self._now = now
        self.actions: list[ScheduledAction] = []

    async def execute(
        self,
        action: ScheduledAction,
    ) -> Literal["succeeded", "lost_lease"]:
        self.actions.append(action)
        assert action.lock_token is not None
        async with self._sessions() as session:
            completed = await SqlAlchemyScheduledActionRepository(
                session
            ).mark_succeeded(
                action.id,
                action.generation,
                action.lock_token,
                self._now,
            )
            await session.commit()
        return "succeeded" if completed else "lost_lease"


class _FailingExecutor(ScheduledActionExecutor):
    async def execute(
        self,
        action: ScheduledAction,
    ) -> Literal["succeeded", "lost_lease"]:
        del action
        raise TimeoutError("detalle que no debe persistirse")


def _fixed_clock(moment: datetime):
    async def now(_session: AsyncSession) -> datetime:
        return moment

    return now


def _worker(
    sessions: async_sessionmaker[AsyncSession],
    executor: ScheduledActionExecutor,
    now: datetime,
    *,
    max_attempts: int = 5,
    poll_interval_seconds: float = 30,
) -> ScheduledActionsWorker:
    return ScheduledActionsWorker(
        sessions,
        executor,
        poll_interval_seconds=poll_interval_seconds,
        lease_seconds=30,
        handler_timeout_seconds=10,
        max_attempts=max_attempts,
        retry_base_seconds=1,
        retry_max_seconds=60,
        clock=_fixed_clock(now),
    )


async def test_dispatch_once_confirma_efecto_y_ack_durable(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _schedule(action_sessions, now)
    executor = _SucceedingExecutor(action_sessions, now)
    worker = _worker(action_sessions, executor, now)

    result = await worker.dispatch_once()

    async with action_sessions() as session:
        row = await session.scalar(select(ScheduledActionModel))
    assert result.status == "succeeded"
    assert row is not None and row.status == "succeeded"
    assert row.attempts == 1
    assert worker.claimed_count == 1
    assert worker.succeeded_count == 1
    assert executor.actions[0].id == row.id


async def test_error_transitorio_solo_persiste_codigo_y_backoff(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _schedule(action_sessions, now)
    worker = _worker(action_sessions, _FailingExecutor(), now)

    result = await worker.dispatch_once()

    async with action_sessions() as session:
        row = await session.scalar(select(ScheduledActionModel))
    assert result.status == "retried"
    assert row is not None and row.status == "pending"
    assert row.last_error == "TimeoutError"
    assert row.next_attempt_at.replace(tzinfo=UTC) == now + timedelta(seconds=1)
    assert "detalle" not in (row.last_error or "")
    assert worker.retried_count == 1


async def test_claim_y_retry_usan_instantes_leidos_en_sesiones_distintas(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    claim_at = datetime.now(UTC)
    failure_at = claim_at + timedelta(seconds=7)
    await _schedule(action_sessions, claim_at)
    moments = iter((claim_at, failure_at))
    sessions_seen: list[AsyncSession] = []

    async def advancing_clock(session: AsyncSession) -> datetime:
        sessions_seen.append(session)
        return next(moments)

    worker = ScheduledActionsWorker(
        action_sessions,
        _FailingExecutor(),
        poll_interval_seconds=30,
        lease_seconds=30,
        handler_timeout_seconds=10,
        max_attempts=5,
        retry_base_seconds=1,
        retry_max_seconds=60,
        clock=advancing_clock,
    )

    result = await worker.dispatch_once()

    async with action_sessions() as session:
        row = await session.scalar(select(ScheduledActionModel))
    assert result.status == "retried"
    assert row is not None
    assert row.locked_at is None
    assert row.updated_at.replace(tzinfo=UTC) == failure_at
    assert row.next_attempt_at.replace(tzinfo=UTC) == failure_at + timedelta(seconds=1)
    assert len(sessions_seen) == 2
    assert sessions_seen[0] is not sessions_seen[1]


async def test_ultimo_intento_termina_dead(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _schedule(action_sessions, now)
    worker = _worker(
        action_sessions,
        _FailingExecutor(),
        now,
        max_attempts=1,
    )

    result = await worker.dispatch_once()

    async with action_sessions() as session:
        row = await session.scalar(select(ScheduledActionModel))
    assert result.status == "dead"
    assert row is not None and row.status == "dead"
    assert row.terminal_at is not None
    assert worker.dead_count == 1


async def test_cancelacion_deja_running_para_recuperacion_por_lease(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _schedule(action_sessions, now)
    started = asyncio.Event()
    release = asyncio.Event()

    class BlockingExecutor(ScheduledActionExecutor):
        async def execute(
            self,
            action: ScheduledAction,
        ) -> Literal["succeeded", "lost_lease"]:
            del action
            started.set()
            await release.wait()
            return "succeeded"

    task = asyncio.create_task(
        _worker(action_sessions, BlockingExecutor(), now).dispatch_once()
    )
    await asyncio.wait_for(started.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    async with action_sessions() as session:
        row = await session.scalar(select(ScheduledActionModel))
    assert row is not None and row.status == "running"
    assert row.lock_token is not None


async def test_run_se_detiene_durante_polling_sin_tarea_huerfana(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    worker = _worker(
        action_sessions,
        _SucceedingExecutor(action_sessions, now),
        now,
    )
    task = asyncio.create_task(worker.run())
    for _ in range(20):
        if worker.running:
            break
        await asyncio.sleep(0)
    assert worker.running is True

    worker.stop()
    await asyncio.wait_for(task, timeout=1)

    assert task.done()
    assert worker.running is False


async def test_reconciliacion_se_limita_al_intervalo_de_polling(
    action_sessions: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    calls = 0

    class CountingReconciler:
        def __init__(self, _session: AsyncSession) -> None:
            pass

        async def reconcile(self, action_limit: int) -> int:
            nonlocal calls
            assert action_limit == 1000
            calls += 1
            return 0

    worker = ScheduledActionsWorker(
        action_sessions,
        _SucceedingExecutor(action_sessions, now),
        poll_interval_seconds=30,
        lease_seconds=30,
        handler_timeout_seconds=10,
        max_attempts=5,
        retry_base_seconds=1,
        retry_max_seconds=60,
        clock=_fixed_clock(now),
        reconciler_factory=CountingReconciler,
    )

    assert (await worker.dispatch_once()).status == "empty"
    assert (await worker.dispatch_once()).status == "empty"
    assert calls == 1


def test_settings_define_rollout_independiente_y_seguro() -> None:
    defaults = Settings(_env_file=None)
    assert defaults.scheduled_actions_mode == "off"
    assert defaults.scheduled_actions_terminal_retention_days == 30
    assert defaults.scheduled_actions_retention_interval_seconds == 60
    assert defaults.scheduled_actions_retention_batch_limit == 1000
    assert (
        Settings(_env_file=None, scheduled_actions_mode="shadow").scheduled_actions_mode
        == "shadow"
    )
    with pytest.raises(ValidationError, match="requiere outbox recording"):
        Settings(_env_file=None, scheduled_actions_mode="live")
    live = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="live_local",
        realtime_outbox_recording_enabled=True,
        scheduled_actions_mode="live",
    )
    assert live.scheduled_actions_mode == "live"
    with pytest.raises(ValidationError, match="requiere live_redis"):
        Settings(
            _env_file=None,
            realtime_shared_presence_enabled=True,
        )
    shared = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="live_redis",
        realtime_outbox_recording_enabled=True,
        scheduled_actions_mode="live",
        realtime_shared_presence_enabled=True,
    )
    assert shared.realtime_shared_presence_enabled is True
    with pytest.raises(ValidationError, match="antes de vencer"):
        Settings(
            _env_file=None,
            realtime_presence_lease_seconds=10,
            realtime_presence_renew_interval_seconds=10,
        )
    with pytest.raises(ValidationError, match="menor al lease"):
        Settings(
            _env_file=None,
            scheduled_actions_handler_timeout_seconds=30,
            scheduled_actions_lease_seconds=30,
        )


async def test_lifecycle_live_inicia_y_detiene_scheduler_antes_del_dispatcher(
    session_factory,
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="live_local",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=30,
        scheduled_actions_mode="live",
        scheduled_actions_poll_interval_seconds=30,
    )
    app = create_app(settings=settings, session_factory=session_factory)

    async with app.router.lifespan_context(app):
        worker = app.state.scheduled_actions_worker
        task = app.state.scheduled_actions_task
        retention_worker = app.state.scheduled_actions_retention_worker
        retention_task = app.state.scheduled_actions_retention_task
        assert isinstance(worker, ScheduledActionsWorker)
        assert worker.running is True
        assert task is not None and not task.done()
        assert retention_worker.running is True
        assert retention_task is not None and not retention_task.done()

    assert worker.running is False
    assert task.done()
    assert retention_worker.running is False
    assert retention_task.done()
    assert app.state.realtime_outbox_dispatcher.running is False


async def test_lifecycle_shadow_ejecuta_scheduler_y_conserva_timer_legacy(
    session_factory,
) -> None:
    settings = Settings(
        _env_file=None,
        scheduled_actions_mode="shadow",
        scheduled_actions_poll_interval_seconds=30,
    )
    app = create_app(settings=settings, session_factory=session_factory)

    async with app.router.lifespan_context(app):
        worker = app.state.scheduled_actions_worker
        task = app.state.scheduled_actions_task
        retention_worker = app.state.scheduled_actions_retention_worker
        retention_task = app.state.scheduled_actions_retention_task
        assert isinstance(worker, ScheduledActionsWorker)
        assert worker.running is True
        assert task is not None and not task.done()
        assert retention_worker.running is True
        assert retention_task is not None and not retention_task.done()

    assert worker.running is False
    assert task.done()
    assert retention_worker.running is False
    assert retention_task.done()
