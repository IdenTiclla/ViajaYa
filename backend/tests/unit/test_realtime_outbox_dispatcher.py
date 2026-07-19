"""Pruebas operativas del dispatcher de outbox en modo sombra."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.api.v1.realtime_outbox import CanonicalRealtimeOutboxBatchValidator
from app.application.dto import DispatchRealtimeOutboxResult, PendingRealtimeEvent
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.realtime import hub as realtime_hub_module
from app.infrastructure.realtime.outbox_dispatcher import (
    ShadowRealtimeOutboxDispatcher,
)
from app.main import create_app


@pytest_asyncio.fixture
async def outbox_sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(RealtimeAggregateVersionModel.__table__.create)
        await connection.run_sync(RealtimeStreamVersionModel.__table__.create)
        await connection.run_sync(RealtimeOutboxModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


def _dispatcher(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    poll_interval_seconds: float = 10,
    clock=None,
) -> ShadowRealtimeOutboxDispatcher:
    options = {}
    if clock is not None:
        options["clock"] = clock
    return ShadowRealtimeOutboxDispatcher(
        session_factory,
        CanonicalRealtimeOutboxBatchValidator(),
        poll_interval_seconds=poll_interval_seconds,
        retry_base_seconds=1,
        retry_max_seconds=60,
        **options,
    )


async def test_dispatch_once_consumes_sqlite_batch_without_calling_local_hub(
    outbox_sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ride_id = uuid.uuid4()
    async with outbox_sessions() as session:
        saved = await SqlAlchemyRealtimeOutbox(session).add_batch(
            [
                PendingRealtimeEvent(
                    event_type="ride_closed",
                    topic="pool:taxi",
                    aggregate_type="ride",
                    aggregate_id=ride_id,
                    payload={
                        "type": "ride_closed",
                        "data": {"ride_id": str(ride_id)},
                    },
                )
            ]
        )
        await SqlAlchemyUnitOfWork(session).commit()

    now = datetime.now(UTC) + timedelta(seconds=1)
    broadcast = AsyncMock()
    monkeypatch.setattr(realtime_hub_module.hub, "broadcast", broadcast)
    result = await _dispatcher(outbox_sessions, clock=lambda: now).dispatch_once()

    async with outbox_sessions() as session:
        row = (
            await session.execute(
                select(RealtimeOutboxModel).where(
                    RealtimeOutboxModel.batch_id == saved[0].batch_id
                )
            )
        ).scalar_one()

    assert result.status == "published"
    assert result.batch_id == saved[0].batch_id
    assert result.event_count == 1
    assert row.published_at is not None
    assert row.attempts == 1
    broadcast.assert_not_awaited()


async def test_run_stops_while_waiting_without_leaving_an_orphan_task(
    outbox_sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dispatcher = _dispatcher(outbox_sessions, poll_interval_seconds=30)
    dispatched = asyncio.Event()
    call_count = 0

    async def dispatch_empty() -> DispatchRealtimeOutboxResult:
        nonlocal call_count
        call_count += 1
        dispatched.set()
        return DispatchRealtimeOutboxResult(status="empty")

    monkeypatch.setattr(dispatcher, "dispatch_once", dispatch_empty)
    task = asyncio.create_task(dispatcher.run())
    await asyncio.wait_for(dispatched.wait(), timeout=1)
    await asyncio.sleep(0)

    dispatcher.stop()
    await asyncio.wait_for(task, timeout=1)

    assert task.done()
    assert not task.cancelled()
    assert dispatcher.running is False
    assert call_count == 1


async def test_run_exposes_a_quarantined_batch_without_logging_its_payload(
    outbox_sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dispatcher = _dispatcher(outbox_sessions, poll_interval_seconds=30)
    batch_id = uuid.uuid4()

    async def dispatch_quarantined() -> DispatchRealtimeOutboxResult:
        dispatcher.stop()
        return DispatchRealtimeOutboxResult(
            status="quarantined",
            batch_id=batch_id,
            event_count=1,
            quarantine_code="invalid_payload",
        )

    monkeypatch.setattr(dispatcher, "dispatch_once", dispatch_quarantined)
    await dispatcher.run()

    assert dispatcher.quarantined_batch_count == 1
    assert dispatcher.last_quarantined_batch_id == str(batch_id)
    assert dispatcher.last_quarantine_code == "invalid_payload"
    assert str(batch_id) in caplog.text


async def test_run_sanitizes_unexpected_errors(
    outbox_sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dispatcher = _dispatcher(outbox_sessions, poll_interval_seconds=30)
    secret = "payload-super-secreto"

    async def dispatch_error() -> DispatchRealtimeOutboxResult:
        dispatcher.stop()
        raise RuntimeError(secret)

    monkeypatch.setattr(dispatcher, "dispatch_once", dispatch_error)
    await dispatcher.run()

    assert dispatcher.last_error == "RuntimeError"
    assert "RuntimeError" in caplog.text
    assert secret not in caplog.text


async def test_preflight_accepts_a_database_with_outbox_tables(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    await _dispatcher(outbox_sessions).preflight()


async def test_preflight_rejects_a_database_without_migrations_0018_to_0020() -> None:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        with pytest.raises(SQLAlchemyError):
            await _dispatcher(factory).preflight()
    finally:
        await engine.dispose()


async def test_app_lifecycle_starts_and_stops_shadow_dispatcher(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_poll_interval_seconds=30,
    )
    app = create_app(settings=settings, session_factory=outbox_sessions)

    async with app.router.lifespan_context(app):
        dispatcher = app.state.realtime_outbox_dispatcher
        assert isinstance(dispatcher, ShadowRealtimeOutboxDispatcher)
        for _ in range(10):
            if dispatcher.running:
                break
            await asyncio.sleep(0)
        assert dispatcher.running is True

    assert dispatcher.running is False


def test_settings_keep_shadow_dispatcher_disabled_by_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.realtime_outbox_dispatch_mode == "off"
    assert settings.realtime_outbox_recording_enabled is False


def test_settings_reject_recording_without_shadow_dispatcher() -> None:
    with pytest.raises(ValidationError, match="requiere"):
        Settings(
            _env_file=None,
            realtime_outbox_dispatch_mode="off",
            realtime_outbox_recording_enabled=True,
        )


def test_settings_accept_shadow_rollout_with_recording_enabled() -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_recording_enabled=True,
    )

    assert settings.realtime_outbox_dispatch_mode == "shadow"
    assert settings.realtime_outbox_recording_enabled is True
