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
    ScheduledActionDeadCount,
    ScheduledActionsOperationalSnapshot,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeAggregateVersionModel,
    RealtimeOutboxModel,
    RealtimeStreamVersionModel,
    ScheduledActionModel,
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
        await connection.run_sync(OfferModel.__table__.create)
        await connection.run_sync(ScheduledActionModel.__table__.create)
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
    assert 'viajaya_scheduled_actions_info{mode="off"} 1.0' in response.text
    assert "viajaya_scheduled_actions_worker_enabled 0.0" in response.text
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
    scheduled_snapshot = ScheduledActionsOperationalSnapshot(
        captured_at=datetime(2026, 7, 22, tzinfo=UTC),
        pending_count=5,
        due_count=2,
        running_count=1,
        stale_count=1,
        retrying_count=3,
        dead_counts=(
            ScheduledActionDeadCount(action_type="expire_offer", action_count=4),
            ScheduledActionDeadCount(action_type="tipo_privado", action_count=2),
        ),
        oldest_due_age_seconds=15.5,
        next_due_at=datetime(2026, 7, 22, tzinfo=UTC),
        latest_succeeded_at=datetime(2026, 7, 21, tzinfo=UTC),
    )

    content = render_realtime_openmetrics(
        mode="live_redis",
        retention_days=30,
        dispatcher_running=True,
        dispatcher_error=False,
        retention_running=True,
        retention_error=False,
        retention_deleted_batch_count=7,
        retention_deleted_event_count=11,
        snapshot=snapshot,
        scrape_success=True,
        redis_connected=True,
        redis_error=False,
        redis_published_batch_count=4,
        redis_received_batch_count=8,
        redis_received_event_count=13,
        redis_resync_message_count=2,
        redis_reconnect_count=1,
        redis_invalid_message_count=3,
        redis_last_publish_subscriber_count=2,
        redis_local_socket_count=5,
        scheduled_mode="live",
        scheduled_worker_running=True,
        scheduled_worker_error=False,
        scheduled_claimed_count=9,
        scheduled_succeeded_count=7,
        scheduled_retried_count=2,
        scheduled_dead_count=1,
        scheduled_recovered_lease_count=3,
        scheduled_retention_running=True,
        scheduled_retention_error=False,
        scheduled_retention_days=30,
        scheduled_retention_deleted_action_count=5,
        scheduled_snapshot=scheduled_snapshot,
        scheduled_scrape_success=True,
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
    assert "viajaya_realtime_redis_bridge_enabled 1.0" in content
    assert "viajaya_realtime_redis_bridge_connected 1.0" in content
    assert "viajaya_realtime_redis_bridge_error 0.0" in content
    assert "viajaya_realtime_redis_published_batches_total 4.0" in content
    assert "viajaya_realtime_redis_received_batches_total 8.0" in content
    assert "viajaya_realtime_redis_received_events_total 13.0" in content
    assert "viajaya_realtime_redis_resync_messages_total 2.0" in content
    assert "viajaya_realtime_redis_reconnects_total 1.0" in content
    assert "viajaya_realtime_redis_invalid_messages_total 3.0" in content
    assert "viajaya_realtime_redis_last_publish_subscribers 2.0" in content
    assert "viajaya_realtime_local_sockets 5.0" in content
    assert 'viajaya_scheduled_actions_info{mode="live"} 1.0' in content
    assert "viajaya_scheduled_actions_pending 5.0" in content
    assert "viajaya_scheduled_actions_due 2.0" in content
    assert "viajaya_scheduled_actions_stale 1.0" in content
    assert "viajaya_scheduled_actions_claimed_total 9.0" in content
    assert "viajaya_scheduled_actions_recovered_leases_total 3.0" in content
    assert "viajaya_scheduled_actions_retention_running 1.0" in content
    assert "viajaya_scheduled_actions_retention_error 0.0" in content
    assert "viajaya_scheduled_actions_retention_days 30.0" in content
    assert (
        "viajaya_scheduled_actions_retention_deleted_actions_total 5.0" in content
    )
    assert 'action_type="expire_offer"} 4.0' in content
    assert 'action_type="unknown"} 2.0' in content
    assert "tipo_privado" not in content
    assert "payload=" not in content
    assert "topic=" not in content
    _assert_valid_openmetrics(content)


async def test_metrics_no_se_publica_sin_opt_in(sessions) -> None:
    settings = Settings(_env_file=None, openmetrics_enabled=False)
    app = create_app(settings=settings, session_factory=sessions)

    response = await _get(app, "/metrics")

    assert response.status_code == 404
