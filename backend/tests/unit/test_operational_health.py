"""Tests of the API's operational liveness and readiness."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Sequence

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.application.dto import RealtimeOutboxEvent
from app.application.interfaces import RealtimeDeliveryBridge
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
    ScheduledActionModel,
)
from app.main import create_app


class _HealthBridge(RealtimeDeliveryBridge):
    def __init__(self) -> None:
        self._running = False
        self._connected = False
        self._last_error: str | None = None
        self._ready = asyncio.Event()
        self._stop = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._running

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def last_error(self) -> str | None:
        return self._last_error

    async def preflight(self) -> None:
        pass

    async def wait_until_ready(self, timeout_seconds: float) -> None:
        await asyncio.wait_for(self._ready.wait(), timeout=timeout_seconds)

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        del events

    async def force_resync(self, streams: Sequence[str]) -> None:
        del streams

    async def run(self) -> None:
        self._running = True
        self._connected = True
        self._ready.set()
        try:
            await self._stop.wait()
        finally:
            self._connected = False
            self._running = False

    def stop(self) -> None:
        self._stop.set()

    async def aclose(self) -> None:
        pass


@pytest_asyncio.fixture
async def sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(OfferModel.__table__.create)
        await connection.run_sync(ScheduledActionModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def outbox_sessions(
    sessions: async_sessionmaker[AsyncSession],
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = sessions.kw["bind"]
    async with engine.begin() as connection:
        await connection.run_sync(RealtimeAggregateVersionModel.__table__.create)
        await connection.run_sync(RealtimeStreamVersionModel.__table__.create)
        await connection.run_sync(RealtimeOutboxModel.__table__.create)
    yield sessions


async def _get(app, path: str, *, headers: dict[str, str] | None = None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path, headers=headers)


async def test_health_legacy_and_liveness_keep_the_exact_public_contract(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    app = create_app(session_factory=sessions)

    legacy = await _get(app, "/health")
    live = await _get(app, "/health/live")

    assert legacy.status_code == 200
    assert legacy.json() == {"status": "ok"}
    assert live.status_code == 200
    assert live.json() == {"status": "ok"}


async def test_app_echoes_request_id_without_changing_the_response_body(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    app = create_app(session_factory=sessions)
    correlation_id = uuid.uuid4()

    response = await _get(
        app,
        "/health/live",
        headers={"X-Request-ID": str(correlation_id)},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"] == str(correlation_id)


async def test_app_returns_request_id_on_unexpected_500(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    app = create_app(session_factory=sessions)
    correlation_id = uuid.uuid4()

    @app.get("/unexpected-error")
    async def unexpected_error() -> None:
        raise RuntimeError("detalle interno")

    response = await _get(
        app,
        "/unexpected-error",
        headers={"X-Request-ID": str(correlation_id)},
    )

    assert response.status_code == 500
    assert response.text == "Internal Server Error"
    assert response.headers["X-Request-ID"] == str(correlation_id)


async def test_readiness_checks_database_and_reports_disabled_dispatcher(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    app = create_app(session_factory=sessions)

    async with app.router.lifespan_context(app):
        response = await _get(app, "/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "checks": {
            "database": "ok",
            "scheduled_actions_worker": "disabled",
            "scheduled_actions_retention": "ok",
            "realtime_outbox_dispatcher": "disabled",
            "realtime_redis_bridge": "disabled",
            "passenger_presence_store": "disabled",
            "realtime_outbox_process_lock": "disabled",
            "realtime_outbox_retention": "disabled",
        },
    }


async def test_readiness_sanitizes_database_errors(
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret = "postgresql://usuario:clave-super-secreta@db/viajaya"

    class FailingSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def execute(self, statement):
            del statement
            raise RuntimeError(secret)

        async def rollback(self) -> None:
            pass

    class FailingSessionFactory:
        def __call__(self):
            return FailingSession()

    app = create_app(session_factory=FailingSessionFactory())  # type: ignore[arg-type]

    response = await _get(app, "/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "checks": {
            "database": "error",
            "scheduled_actions_worker": "disabled",
            "scheduled_actions_retention": "error",
            "realtime_outbox_dispatcher": "disabled",
            "realtime_redis_bridge": "disabled",
            "passenger_presence_store": "disabled",
            "realtime_outbox_process_lock": "disabled",
            "realtime_outbox_retention": "disabled",
        },
    }
    assert secret not in response.text
    assert secret not in caplog.text
    assert "RuntimeError" in caplog.text


async def test_readiness_requires_a_running_dispatcher_in_shadow_mode(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_poll_interval_seconds=30,
    )
    app = create_app(settings=settings, session_factory=outbox_sessions)

    before_startup = await _get(app, "/health/ready")
    assert before_startup.status_code == 503
    assert before_startup.json()["checks"]["realtime_outbox_dispatcher"] == "error"

    async with app.router.lifespan_context(app):
        healthy = await _get(app, "/health/ready")
        assert healthy.status_code == 200
        assert healthy.json()["checks"]["realtime_outbox_dispatcher"] == "ok"
        assert healthy.json()["checks"]["realtime_outbox_process_lock"] == "ok"

        dispatcher = app.state.realtime_outbox_dispatcher
        task = app.state.realtime_outbox_dispatcher_task
        dispatcher.stop()
        await task

        stopped = await _get(app, "/health/ready")
        assert stopped.status_code == 503
        assert stopped.json()["checks"] == {
            "database": "ok",
            "scheduled_actions_worker": "disabled",
            "scheduled_actions_retention": "ok",
            "realtime_outbox_dispatcher": "error",
                "realtime_redis_bridge": "disabled",
                "passenger_presence_store": "disabled",
            "realtime_outbox_process_lock": "ok",
            "realtime_outbox_retention": "disabled",
        }


async def test_readiness_live_redis_exige_dispatcher_y_suscripcion(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="live_redis",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=30,
    )
    bridge = _HealthBridge()
    app = create_app(
        settings=settings,
        session_factory=outbox_sessions,
        realtime_redis_bridge=bridge,
    )

    before_startup = await _get(app, "/health/ready")
    assert before_startup.status_code == 503
    assert before_startup.json()["checks"]["realtime_redis_bridge"] == "error"

    async with app.router.lifespan_context(app):
        healthy = await _get(app, "/health/ready")
        assert healthy.status_code == 200
        assert healthy.json()["checks"]["realtime_outbox_dispatcher"] == "ok"
        assert healthy.json()["checks"]["realtime_redis_bridge"] == "ok"
        assert healthy.json()["checks"]["realtime_outbox_process_lock"] == "ok"
        realtime = await _get(app, "/health/realtime")
        assert realtime.status_code == 200
        assert realtime.json()["redis_connected"] is True

        bridge._last_error = "ConnectionError"
        unhealthy = await _get(app, "/health/ready")
        assert unhealthy.status_code == 503
        assert unhealthy.json()["checks"]["realtime_redis_bridge"] == "error"
        realtime_unhealthy = await _get(app, "/health/realtime")
        assert realtime_unhealthy.status_code == 503
        assert realtime_unhealthy.json()["status"] == "unavailable"


async def test_readiness_stops_dispatcher_when_process_lock_is_lost(
    outbox_sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="shadow",
        realtime_outbox_poll_interval_seconds=30,
    )
    app = create_app(settings=settings, session_factory=outbox_sessions)

    async with app.router.lifespan_context(app):
        process_lock = app.state.live_local_process_lock

        async def lost_lock() -> bool:
            return False

        monkeypatch.setattr(process_lock, "check", lost_lock)
        response = await _get(app, "/health/ready")

        assert response.status_code == 503
        assert response.json()["checks"]["realtime_outbox_process_lock"] == "error"
        await asyncio.wait_for(app.state.realtime_outbox_dispatcher_task, timeout=1)
        assert app.state.realtime_outbox_dispatcher.running is False


async def test_realtime_health_is_disabled_without_outbox_rollout(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    app = create_app(session_factory=sessions)

    response = await _get(app, "/health/realtime")

    assert response.status_code == 200
    assert response.json() == {
        "status": "disabled",
        "mode": "off",
        "retention_days": 0,
    }


async def test_realtime_health_exposes_only_sanitized_aggregates(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="shadow",
    )
    app = create_app(settings=settings, session_factory=outbox_sessions)

    response = await _get(app, "/health/realtime")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["mode"] == "shadow"
    assert payload["pending_event_count"] == 0
    assert payload["pending_batch_count"] == 0
    assert payload["retrying_batch_count"] == 0
    assert payload["quarantined_batches"] == []
    assert payload["max_pending_age_seconds"] == 0
    assert "latest_publish_delay_seconds" not in payload
    assert "latest_published_at" not in payload
    assert payload["retention_days"] == 0
    assert payload["retention_deleted_batch_count"] == 0
    assert payload["retention_deleted_event_count"] == 0


async def test_realtime_health_sanitizes_missing_outbox_migration(
    sessions: async_sessionmaker[AsyncSession],
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_dispatch_mode="shadow",
    )
    app = create_app(settings=settings, session_factory=sessions)

    response = await _get(app, "/health/realtime")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "mode": "shadow",
        "retention_days": 0,
    }
    assert "OperationalError" in caplog.text
    assert "SELECT" not in response.text


async def test_readiness_checks_retention_worker_when_enabled(
    outbox_sessions: async_sessionmaker[AsyncSession],
) -> None:
    settings = Settings(
        _env_file=None,
        realtime_outbox_published_retention_days=30,
        realtime_outbox_retention_interval_seconds=3600,
    )
    app = create_app(settings=settings, session_factory=outbox_sessions)

    before_startup = await _get(app, "/health/ready")
    assert before_startup.status_code == 503
    assert before_startup.json()["checks"]["realtime_outbox_retention"] == "error"

    async with app.router.lifespan_context(app):
        ready = await _get(app, "/health/ready")
        assert ready.status_code == 200
        assert ready.json()["checks"]["realtime_outbox_retention"] == "ok"
