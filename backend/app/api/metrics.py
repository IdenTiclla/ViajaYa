"""Exposición OpenMetrics de señales operativas sanitizadas."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Literal, get_args

from fastapi import APIRouter, Request, Response
from prometheus_client.metrics_core import Metric
from prometheus_client.openmetrics.exposition import CONTENT_TYPE_LATEST, generate_latest

from app.api.deps import (
    RealtimeOutboxOperationalSnapshotDep,
    ScheduledActionsOperationalSnapshotDep,
    SettingsDep,
)
from app.application.dto import (
    RealtimeOutboxOperationalSnapshot,
    RealtimeOutboxQuarantineCode,
    ScheduledActionsOperationalSnapshot,
)
from app.infrastructure.realtime.hub import hub

logger = logging.getLogger(__name__)

router = APIRouter(tags=["metrics"])

OPENMETRICS_CONTENT_TYPE = CONTENT_TYPE_LATEST
_QUARANTINE_CODES = frozenset(get_args(RealtimeOutboxQuarantineCode))
_SCHEDULED_ACTION_TYPES = frozenset({"expire_offer"})


def _quarantine_code(value: str) -> str:
    return value if value in _QUARANTINE_CODES else "unknown"


class _OpenMetricsDocument:
    def __init__(self) -> None:
        self._metrics: list[Metric] = []

    def metric(
        self,
        name: str,
        help_text: str,
        metric_type: Literal["counter", "gauge", "info"],
        samples: list[tuple[dict[str, str], int | float]],
        *,
        sample_name: str | None = None,
    ) -> None:
        metric = Metric(name, help_text, metric_type)
        rendered_name = sample_name or name
        for labels, value in samples:
            metric.add_sample(rendered_name, labels, value)
        self._metrics.append(metric)

    def collect(self) -> Iterator[Metric]:
        yield from self._metrics

    def render(self) -> str:
        return generate_latest(self).decode("utf-8")


def render_realtime_openmetrics(
    *,
    mode: Literal["off", "shadow", "live_local", "live_redis"],
    retention_days: int,
    dispatcher_running: bool,
    dispatcher_error: bool,
    retention_running: bool,
    retention_error: bool,
    retention_deleted_batch_count: int,
    retention_deleted_event_count: int,
    snapshot: RealtimeOutboxOperationalSnapshot | None,
    scrape_success: bool,
    redis_connected: bool = False,
    redis_error: bool = False,
    redis_published_batch_count: int = 0,
    redis_received_batch_count: int = 0,
    redis_received_event_count: int = 0,
    redis_resync_message_count: int = 0,
    redis_reconnect_count: int = 0,
    redis_invalid_message_count: int = 0,
    redis_last_publish_subscriber_count: int = 0,
    redis_local_socket_count: int = 0,
    scheduled_mode: Literal["off", "shadow", "live"] = "off",
    scheduled_worker_running: bool = False,
    scheduled_worker_error: bool = False,
    scheduled_claimed_count: int = 0,
    scheduled_succeeded_count: int = 0,
    scheduled_retried_count: int = 0,
    scheduled_dead_count: int = 0,
    scheduled_recovered_lease_count: int = 0,
    scheduled_retention_running: bool = False,
    scheduled_retention_error: bool = False,
    scheduled_retention_days: int = 30,
    scheduled_retention_deleted_action_count: int = 0,
    scheduled_snapshot: ScheduledActionsOperationalSnapshot | None = None,
    scheduled_scrape_success: bool = True,
) -> str:
    """Renderiza solo agregados operativos, sin payloads, topics ni errores."""
    document = _OpenMetricsDocument()
    dispatcher_enabled = mode in {"shadow", "live_local", "live_redis"}
    document.metric(
        "viajaya_realtime_outbox",
        "Información estable del modo realtime activo.",
        "info",
        [({"mode": mode}, 1)],
        sample_name="viajaya_realtime_outbox_info",
    )
    document.metric(
        "viajaya_realtime_outbox_collection_success",
        "Indica si la lectura persistida requerida por este scrape tuvo éxito.",
        "gauge",
        [({}, int(scrape_success))],
    )
    document.metric(
        "viajaya_realtime_outbox_dispatcher_enabled",
        "Indica si la configuración requiere un dispatcher de outbox.",
        "gauge",
        [({}, int(dispatcher_enabled))],
    )
    document.metric(
        "viajaya_realtime_outbox_dispatcher_running",
        "Indica si el dispatcher requerido está ejecutándose en este proceso.",
        "gauge",
        [({}, int(dispatcher_running))],
    )
    document.metric(
        "viajaya_realtime_outbox_dispatcher_error",
        "Indica si el dispatcher conserva un fallo operativo sin recuperar.",
        "gauge",
        [({}, int(dispatcher_error))],
    )
    document.metric(
        "viajaya_realtime_redis_bridge_enabled",
        "Indica si el modo activo requiere fanout Redis entre procesos.",
        "gauge",
        [({}, int(mode == "live_redis"))],
    )
    document.metric(
        "viajaya_realtime_redis_bridge_connected",
        "Indica si este proceso mantiene su suscripción Redis realtime.",
        "gauge",
        [({}, int(redis_connected))],
    )
    document.metric(
        "viajaya_realtime_redis_bridge_error",
        "Indica si el bridge Redis conserva un fallo sin recuperar.",
        "gauge",
        [({}, int(redis_error))],
    )
    for name, help_text, value in (
        (
            "published_batches",
            "Batches publicados a Redis por este proceso desde su arranque.",
            redis_published_batch_count,
        ),
        (
            "received_batches",
            "Batches Redis recibidos por este proceso desde su arranque.",
            redis_received_batch_count,
        ),
        (
            "received_events",
            "Eventos Redis recibidos por este proceso desde su arranque.",
            redis_received_event_count,
        ),
        (
            "resync_messages",
            "Órdenes Redis de resnapshot recibidas desde el arranque.",
            redis_resync_message_count,
        ),
        (
            "reconnects",
            "Reconexiones Redis intentadas por este proceso desde el arranque.",
            redis_reconnect_count,
        ),
        (
            "invalid_messages",
            "Mensajes Redis inválidos descartados desde el arranque.",
            redis_invalid_message_count,
        ),
    ):
        document.metric(
            f"viajaya_realtime_redis_{name}",
            help_text,
            "counter",
            [({}, value)],
            sample_name=f"viajaya_realtime_redis_{name}_total",
        )
    document.metric(
        "viajaya_realtime_redis_last_publish_subscribers",
        "Suscriptores confirmados por el último PUBLISH de este proceso.",
        "gauge",
        [({}, redis_last_publish_subscriber_count)],
    )
    document.metric(
        "viajaya_realtime_local_sockets",
        "Sockets WebSocket locales únicos suscritos en este proceso.",
        "gauge",
        [({}, redis_local_socket_count)],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_enabled",
        "Indica si la configuración requiere el worker de retención.",
        "gauge",
        [({}, int(retention_days > 0))],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_running",
        "Indica si el worker de retención requerido está ejecutándose.",
        "gauge",
        [({}, int(retention_running))],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_error",
        "Indica si el worker de retención conserva un fallo sin recuperar.",
        "gauge",
        [({}, int(retention_error))],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_days",
        "TTL configurado para batches publicados; cero deshabilita la retención.",
        "gauge",
        [({}, retention_days)],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_deleted_batches",
        "Batches publicados eliminados por este proceso desde su arranque.",
        "counter",
        [({}, retention_deleted_batch_count)],
        sample_name="viajaya_realtime_outbox_retention_deleted_batches_total",
    )
    document.metric(
        "viajaya_realtime_outbox_retention_deleted_events",
        "Eventos publicados eliminados por este proceso desde su arranque.",
        "counter",
        [({}, retention_deleted_event_count)],
        sample_name="viajaya_realtime_outbox_retention_deleted_events_total",
    )

    document.metric(
        "viajaya_scheduled_actions",
        "Información estable del modo de acciones programadas.",
        "info",
        [({"mode": scheduled_mode}, 1)],
        sample_name="viajaya_scheduled_actions_info",
    )
    document.metric(
        "viajaya_scheduled_actions_collection_success",
        "Indica si el scrape persistido del scheduler tuvo éxito.",
        "gauge",
        [({}, int(scheduled_scrape_success))],
    )
    document.metric(
        "viajaya_scheduled_actions_worker_enabled",
        "Indica si la configuración requiere ejecutar el worker.",
        "gauge",
        [({}, int(scheduled_mode in {"shadow", "live"}))],
    )
    document.metric(
        "viajaya_scheduled_actions_worker_running",
        "Indica si el worker requerido está ejecutándose en este proceso.",
        "gauge",
        [({}, int(scheduled_worker_running))],
    )
    document.metric(
        "viajaya_scheduled_actions_worker_error",
        "Indica si el worker conserva un fallo operativo sin recuperar.",
        "gauge",
        [({}, int(scheduled_worker_error))],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_running",
        "Indica si la retención requerida está ejecutándose en este proceso.",
        "gauge",
        [({}, int(scheduled_retention_running))],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_error",
        "Indica si la retención conserva un fallo operativo sin recuperar.",
        "gauge",
        [({}, int(scheduled_retention_error))],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_days",
        "TTL de acciones succeeded/cancelled; las acciones dead se conservan.",
        "gauge",
        [({}, scheduled_retention_days)],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_deleted_actions",
        "Acciones terminales eliminadas por este proceso desde su arranque.",
        "counter",
        [({}, scheduled_retention_deleted_action_count)],
        sample_name="viajaya_scheduled_actions_retention_deleted_actions_total",
    )
    for name, help_text, value in (
        (
            "claimed",
            "Acciones reclamadas por este proceso desde su arranque.",
            scheduled_claimed_count,
        ),
        (
            "succeeded",
            "Acciones completadas por este proceso desde su arranque.",
            scheduled_succeeded_count,
        ),
        (
            "retried",
            "Acciones reprogramadas por este proceso desde su arranque.",
            scheduled_retried_count,
        ),
        (
            "dead",
            "Acciones agotadas por este proceso desde su arranque.",
            scheduled_dead_count,
        ),
        (
            "recovered_leases",
            "Leases abandonados recuperados por este proceso desde su arranque.",
            scheduled_recovered_lease_count,
        ),
    ):
        document.metric(
            f"viajaya_scheduled_actions_{name}",
            help_text,
            "counter",
            [({}, value)],
            sample_name=f"viajaya_scheduled_actions_{name}_total",
        )

    if scheduled_snapshot is not None:
        for name, help_text, value in (
            (
                "pending",
                "Acciones pendientes, vencidas o futuras.",
                scheduled_snapshot.pending_count,
            ),
            (
                "due",
                "Acciones pendientes cuyo deadline y retry ya vencieron.",
                scheduled_snapshot.due_count,
            ),
            (
                "running",
                "Acciones con lease reclamado.",
                scheduled_snapshot.running_count,
            ),
            (
                "stale",
                "Acciones running cuyo lease ya puede recuperarse.",
                scheduled_snapshot.stale_count,
            ),
            (
                "retrying",
                "Acciones pendientes que consumieron al menos un intento.",
                scheduled_snapshot.retrying_count,
            ),
        ):
            document.metric(
                f"viajaya_scheduled_actions_{name}",
                help_text,
                "gauge",
                [({}, value)],
            )
        dead_counts = dict.fromkeys((*_SCHEDULED_ACTION_TYPES, "unknown"), 0)
        for item in scheduled_snapshot.dead_counts:
            action_type = (
                item.action_type
                if item.action_type in _SCHEDULED_ACTION_TYPES
                else "unknown"
            )
            dead_counts[action_type] = (
                dead_counts.get(action_type, 0) + item.action_count
            )
        document.metric(
            "viajaya_scheduled_actions_dead_persisted",
            "Acciones terminales dead agrupadas por tipo acotado.",
            "gauge",
            [
                ({"action_type": action_type}, count)
                for action_type, count in sorted(dead_counts.items())
            ],
        )
        document.metric(
            "viajaya_scheduled_actions_oldest_due_age_seconds",
            "Edad de la acción vencida más antigua.",
            "gauge",
            [({}, scheduled_snapshot.oldest_due_age_seconds)],
        )
        if scheduled_snapshot.next_due_at is not None:
            document.metric(
                "viajaya_scheduled_actions_next_due_timestamp_seconds",
                "Instante Unix del próximo deadline pendiente.",
                "gauge",
                [({}, scheduled_snapshot.next_due_at.timestamp())],
            )
        if scheduled_snapshot.latest_succeeded_at is not None:
            document.metric(
                "viajaya_scheduled_actions_latest_succeeded_timestamp_seconds",
                "Instante Unix del último ack exitoso observado.",
                "gauge",
                [({}, scheduled_snapshot.latest_succeeded_at.timestamp())],
            )

    if snapshot is None:
        return document.render()

    document.metric(
        "viajaya_realtime_outbox_pending_events",
        "Eventos pendientes no terminales en la outbox.",
        "gauge",
        [({}, snapshot.pending_event_count)],
    )
    document.metric(
        "viajaya_realtime_outbox_pending_batches",
        "Batches pendientes no terminales en la outbox.",
        "gauge",
        [({}, snapshot.pending_batch_count)],
    )
    document.metric(
        "viajaya_realtime_outbox_retrying_batches",
        "Batches pendientes que ya consumieron al menos un intento.",
        "gauge",
        [({}, snapshot.retrying_batch_count)],
    )
    quarantine_counts = dict.fromkeys((*_QUARANTINE_CODES, "unknown"), 0)
    for item in snapshot.quarantined_batches:
        code = _quarantine_code(item.code)
        quarantine_counts[code] = quarantine_counts.get(code, 0) + item.batch_count
    document.metric(
        "viajaya_realtime_outbox_quarantined_batches",
        "Batches terminales en cuarentena agrupados por código estable.",
        "gauge",
        [
            ({"code": code}, count)
            for code, count in sorted(quarantine_counts.items())
        ],
    )
    document.metric(
        "viajaya_realtime_outbox_max_pending_age_seconds",
        "Edad máxima aproximada de los eventos pendientes.",
        "gauge",
        [({}, snapshot.max_pending_age_seconds)],
    )
    if snapshot.latest_publish_delay_seconds is not None:
        document.metric(
            "viajaya_realtime_outbox_latest_publish_delay_seconds",
            "Demora conservadora created_at a published_at del último evento publicado.",
            "gauge",
            [({}, snapshot.latest_publish_delay_seconds)],
        )
    if snapshot.latest_published_at is not None:
        document.metric(
            "viajaya_realtime_outbox_latest_published_timestamp_seconds",
            "Instante Unix del último evento publicado observado.",
            "gauge",
            [({}, snapshot.latest_published_at.timestamp())],
        )
    return document.render()


def _response(content: str) -> Response:
    return Response(
        content=content,
        headers={"Content-Type": OPENMETRICS_CONTENT_TYPE},
    )


@router.get("/metrics", include_in_schema=False)
async def metrics(
    request: Request,
    settings: SettingsDep,
    use_case: RealtimeOutboxOperationalSnapshotDep,
    scheduled_use_case: ScheduledActionsOperationalSnapshotDep,
) -> Response:
    """Expone métricas scrapeables sin convertir fallos internos en datos."""
    mode = settings.realtime_outbox_dispatch_mode
    retention_days = settings.realtime_outbox_published_retention_days
    dispatcher = request.app.state.realtime_outbox_dispatcher
    dispatcher_task = request.app.state.realtime_outbox_dispatcher_task
    dispatcher_running = bool(
        dispatcher is not None
        and dispatcher.running
        and dispatcher_task is not None
        and not dispatcher_task.done()
    )
    dispatcher_error = bool(dispatcher is not None and dispatcher.last_error is not None)
    retention_worker = request.app.state.realtime_outbox_retention_worker
    retention_task = request.app.state.realtime_outbox_retention_task
    retention_running = bool(
        retention_worker is not None
        and retention_worker.running
        and retention_task is not None
        and not retention_task.done()
    )
    retention_error = bool(
        retention_worker is not None and retention_worker.last_error is not None
    )
    deleted_batches = (
        retention_worker.deleted_batch_count if retention_worker is not None else 0
    )
    deleted_events = (
        retention_worker.deleted_event_count if retention_worker is not None else 0
    )
    scheduled_mode = settings.scheduled_actions_mode
    scheduled_worker = request.app.state.scheduled_actions_worker
    scheduled_task = request.app.state.scheduled_actions_task
    scheduled_worker_running = bool(
        scheduled_worker is not None
        and scheduled_worker.running
        and scheduled_task is not None
        and not scheduled_task.done()
    )
    scheduled_worker_error = bool(
        scheduled_worker is not None and scheduled_worker.last_error is not None
    )
    scheduled_retention_worker = request.app.state.scheduled_actions_retention_worker
    scheduled_retention_task = request.app.state.scheduled_actions_retention_task
    scheduled_retention_running = bool(
        scheduled_retention_worker is not None
        and scheduled_retention_worker.running
        and scheduled_retention_task is not None
        and not scheduled_retention_task.done()
    )
    scheduled_retention_error = bool(
        scheduled_retention_worker is not None
        and scheduled_retention_worker.last_error is not None
    )
    redis_bridge = request.app.state.realtime_redis_bridge
    redis_connected = bool(redis_bridge is not None and redis_bridge.connected)
    redis_error = bool(
        redis_bridge is not None and redis_bridge.last_error is not None
    )

    now = datetime.now(UTC)
    snapshot: RealtimeOutboxOperationalSnapshot | None = None
    scrape_success = True
    if mode != "off" or retention_days > 0:
        try:
            async with asyncio.timeout(2):
                snapshot = await use_case.execute(now)
        except Exception as error:  # noqa: BLE001 - scrape sanitizado
            scrape_success = False
            logger.warning(
                "Falló el scrape OpenMetrics de la outbox (%s).",
                type(error).__name__,
            )

    scheduled_snapshot: ScheduledActionsOperationalSnapshot | None = None
    scheduled_scrape_success = True
    if scheduled_mode != "off":
        try:
            async with asyncio.timeout(2):
                scheduled_snapshot = await scheduled_use_case.execute(
                    now,
                    lease_seconds=settings.scheduled_actions_lease_seconds,
                )
        except Exception as error:  # noqa: BLE001 - scrape sanitizado
            scheduled_scrape_success = False
            logger.warning(
                "Falló el scrape OpenMetrics de scheduled_actions (%s).",
                type(error).__name__,
            )

    return _response(
        render_realtime_openmetrics(
            mode=mode,
            retention_days=retention_days,
            dispatcher_running=dispatcher_running,
            dispatcher_error=dispatcher_error,
            retention_running=retention_running,
            retention_error=retention_error,
            retention_deleted_batch_count=deleted_batches,
            retention_deleted_event_count=deleted_events,
            snapshot=snapshot,
            scrape_success=scrape_success,
            redis_connected=redis_connected,
            redis_error=redis_error,
            redis_published_batch_count=(
                getattr(redis_bridge, "published_batch_count", 0)
                if redis_bridge is not None
                else 0
            ),
            redis_received_batch_count=(
                getattr(redis_bridge, "received_batch_count", 0)
                if redis_bridge is not None
                else 0
            ),
            redis_received_event_count=(
                getattr(redis_bridge, "received_event_count", 0)
                if redis_bridge is not None
                else 0
            ),
            redis_resync_message_count=(
                getattr(redis_bridge, "resync_message_count", 0)
                if redis_bridge is not None
                else 0
            ),
            redis_reconnect_count=(
                getattr(redis_bridge, "reconnect_count", 0)
                if redis_bridge is not None
                else 0
            ),
            redis_invalid_message_count=(
                getattr(redis_bridge, "invalid_message_count", 0)
                if redis_bridge is not None
                else 0
            ),
            redis_last_publish_subscriber_count=(
                getattr(redis_bridge, "last_publish_subscriber_count", 0)
                if redis_bridge is not None
                else 0
            ),
            redis_local_socket_count=hub.subscribed_socket_count,
            scheduled_mode=scheduled_mode,
            scheduled_worker_running=scheduled_worker_running,
            scheduled_worker_error=scheduled_worker_error,
            scheduled_claimed_count=(
                scheduled_worker.claimed_count if scheduled_worker is not None else 0
            ),
            scheduled_succeeded_count=(
                scheduled_worker.succeeded_count
                if scheduled_worker is not None
                else 0
            ),
            scheduled_retried_count=(
                scheduled_worker.retried_count if scheduled_worker is not None else 0
            ),
            scheduled_dead_count=(
                scheduled_worker.dead_count if scheduled_worker is not None else 0
            ),
            scheduled_recovered_lease_count=(
                scheduled_worker.recovered_lease_count
                if scheduled_worker is not None
                else 0
            ),
            scheduled_retention_running=scheduled_retention_running,
            scheduled_retention_error=scheduled_retention_error,
            scheduled_retention_days=(
                settings.scheduled_actions_terminal_retention_days
            ),
            scheduled_retention_deleted_action_count=(
                scheduled_retention_worker.deleted_action_count
                if scheduled_retention_worker is not None
                else 0
            ),
            scheduled_snapshot=scheduled_snapshot,
            scheduled_scrape_success=scheduled_scrape_success,
        )
    )
