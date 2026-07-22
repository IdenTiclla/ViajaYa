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

from app.api.deps import RealtimeOutboxOperationalSnapshotDep, SettingsDep
from app.application.dto import (
    RealtimeOutboxOperationalSnapshot,
    RealtimeOutboxQuarantineCode,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["metrics"])

OPENMETRICS_CONTENT_TYPE = CONTENT_TYPE_LATEST
_QUARANTINE_CODES = frozenset(get_args(RealtimeOutboxQuarantineCode))


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
    mode: Literal["off", "shadow", "live_local"],
    retention_days: int,
    dispatcher_running: bool,
    dispatcher_error: bool,
    retention_running: bool,
    retention_error: bool,
    retention_deleted_batch_count: int,
    retention_deleted_event_count: int,
    snapshot: RealtimeOutboxOperationalSnapshot | None,
    scrape_success: bool,
) -> str:
    """Renderiza solo agregados operativos, sin payloads, topics ni errores."""
    document = _OpenMetricsDocument()
    dispatcher_enabled = mode in {"shadow", "live_local"}
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

    if mode == "off" and retention_days == 0:
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
                snapshot=None,
                scrape_success=True,
            )
        )

    try:
        async with asyncio.timeout(2):
            snapshot = await use_case.execute(datetime.now(UTC))
    except Exception as error:  # noqa: BLE001 - endpoint operativo sanitizado
        logger.warning(
            "Falló el scrape OpenMetrics de la outbox (%s).",
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
                snapshot=None,
                scrape_success=False,
            )
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
            scrape_success=True,
        )
    )
