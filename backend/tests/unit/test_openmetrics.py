"""Pruebas del contrato OpenMetrics operativo."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from prometheus_client.openmetrics.parser import text_string_to_metric_families
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.metrics import OPENMETRICS_CONTENT_TYPE, render_realtime_openmetrics
from app.application.dto import (
    RealtimeOutboxOperationalSnapshot,
    RealtimeOutboxQuarantineCount,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
)
from app.main import create_app


@pytest_asyncio.fixture
async def sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
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


async def _get(app, path: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def _assert_valid_openmetrics(content: str) -> None:
    """Exige que el parser oficial acepte el documento completo."""
    assert list(text_string_to_metric_families(content))
    assert content.endswith("# EOF\n")


async def test_metrics_off_no_exige_migraciones_de_outbox(sessions) -> None:
    settings = Settings(_env_file=None, openmetrics_enabled=True)
    app = create_app(settings=settings, session_factory=sessions)

    response = await _get(app, "/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"] == OPENMETRICS_CONTENT_TYPE
    assert "# TYPE viajaya_realtime_outbox info" in response.text
    assert 'viajaya_realtime_outbox_info{mode="off"} 1.0' in response.text
    assert "viajaya_realtime_outbox_dispatcher_enabled 0.0" in response.text
    assert "viajaya_realtime_outbox_collection_success 1.0" in response.text
    assert "viajaya_realtime_outbox_pending_events" not in response.text
    assert response.text.endswith("# EOF\n")
    _assert_valid_openmetrics(response.text)


async def test_metrics_shadow_expone_corte_persistido_sanitizado(
    outbox_sessions,
) -> None:
    settings = Settings(
        _env_file=None,
        openmetrics_enabled=True,
        realtime_outbox_dispatch_mode="shadow",
    )
    app = create_app(settings=settings, session_factory=outbox_sessions)

    async with app.router.lifespan_context(app):
        response = await _get(app, "/metrics")

    assert response.status_code == 200
    assert 'viajaya_realtime_outbox_info{mode="shadow"} 1.0' in response.text
    assert "viajaya_realtime_outbox_dispatcher_enabled 1.0" in response.text
    assert "viajaya_realtime_outbox_dispatcher_running 1.0" in response.text
    assert "viajaya_realtime_outbox_pending_events 0.0" in response.text
    assert "viajaya_realtime_outbox_pending_batches 0.0" in response.text
    assert "viajaya_realtime_outbox_retrying_batches 0.0" in response.text
    assert "payload=" not in response.text
    assert "topic=" not in response.text


async def test_metrics_falla_cerrado_sin_filtrar_error(sessions, caplog) -> None:
    secret = "postgresql://usuario:clave-super-secreta@db/viajaya"

    class FailingUseCase:
        async def execute(self, now):
            del now
            raise RuntimeError(secret)

    settings = Settings(
        _env_file=None,
        openmetrics_enabled=True,
        realtime_outbox_dispatch_mode="shadow",
    )
    app = create_app(settings=settings, session_factory=sessions)
    from app.api.deps import get_realtime_outbox_operational_snapshot

    app.dependency_overrides[get_realtime_outbox_operational_snapshot] = FailingUseCase

    response = await _get(app, "/metrics")

    assert response.status_code == 200
    assert "viajaya_realtime_outbox_collection_success 0.0" in response.text
    assert secret not in response.text
    assert secret not in caplog.text
    assert "RuntimeError" in caplog.text


def test_renderer_exporta_labels_y_contadores_sin_campos_sensibles() -> None:
    snapshot = RealtimeOutboxOperationalSnapshot(
        captured_at=datetime(2026, 7, 22, tzinfo=UTC),
        pending_event_count=3,
        pending_batch_count=2,
        retrying_batch_count=1,
        quarantined_batches=(
            RealtimeOutboxQuarantineCount(code='invalid_"payload', batch_count=4),
            RealtimeOutboxQuarantineCount(code="otro_desconocido", batch_count=2),
        ),
        max_pending_age_seconds=12.5,
        latest_publish_delay_seconds=0.25,
        latest_published_at=datetime(2026, 7, 22, tzinfo=UTC),
    )

    content = render_realtime_openmetrics(
        mode="live_local",
        retention_days=30,
        dispatcher_running=True,
        dispatcher_error=False,
        retention_running=True,
        retention_error=False,
        retention_deleted_batch_count=7,
        retention_deleted_event_count=11,
        snapshot=snapshot,
        scrape_success=True,
    )

    assert 'code="unknown"} 6.0' in content
    assert content.count('code="unknown"') == 1
    assert "viajaya_realtime_outbox_pending_events 3.0" in content
    assert "viajaya_realtime_outbox_max_pending_age_seconds 12.5" in content
    assert "viajaya_realtime_outbox_latest_publish_delay_seconds 0.25" in content
    assert "viajaya_realtime_outbox_retention_deleted_batches_total 7.0" in content
    assert "viajaya_realtime_outbox_retention_deleted_events_total 11.0" in content
    assert "# TYPE viajaya_realtime_outbox_retention_deleted_batches counter" in content
    assert "# TYPE viajaya_realtime_outbox_retention_deleted_events counter" in content
    assert "# TYPE viajaya_realtime_outbox_retention_deleted_batches_total" not in content
    assert "viajaya_realtime_outbox_dispatcher_running 1.0" in content
    assert "viajaya_realtime_outbox_dispatcher_error 0.0" in content
    assert "viajaya_realtime_outbox_retention_enabled 1.0" in content
    assert "viajaya_realtime_outbox_retention_running 1.0" in content
    assert "viajaya_realtime_outbox_retention_error 0.0" in content
    assert "payload=" not in content
    assert "topic=" not in content
    _assert_valid_openmetrics(content)


async def test_metrics_no_se_publica_sin_opt_in(sessions) -> None:
    settings = Settings(_env_file=None, openmetrics_enabled=False)
    app = create_app(settings=settings, session_factory=sessions)

    response = await _get(app, "/metrics")

    assert response.status_code == 404
