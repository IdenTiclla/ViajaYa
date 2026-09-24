"""OpenMetrics exposure of sanitized operational signals."""

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
_SCHEDULED_ACTION_TYPES = frozenset({"cancel_absent_ride", "expire_offer"})


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
    scheduled_deferred_count: int = 0,
    scheduled_retried_count: int = 0,
    scheduled_dead_count: int = 0,
    scheduled_recovered_lease_count: int = 0,
    scheduled_retention_running: bool = False,
    scheduled_retention_error: bool = False,
    scheduled_retention_days: int = 30,
    scheduled_retention_deleted_action_count: int = 0,
    scheduled_snapshot: ScheduledActionsOperationalSnapshot | None = None,
    scheduled_scrape_success: bool = True,
    shared_presence_enabled: bool = False,
    shared_presence_healthy: bool = False,
    presence_renewal_count: int = 0,
    presence_disconnect_count: int = 0,
    presence_observation_count: int = 0,
    presence_failure_count: int = 0,
) -> str:
    """Render only operational aggregates, without payloads, topics or errors."""
    document = _OpenMetricsDocument()
    dispatcher_enabled = mode in {"shadow", "live_local", "live_redis"}
    document.metric(
        "viajaya_realtime_outbox",
        "Stable information about the active realtime mode.",
        "info",
        [({"mode": mode}, 1)],
        sample_name="viajaya_realtime_outbox_info",
    )
    document.metric(
        "viajaya_realtime_outbox_collection_success",
        "Whether the persisted read required by this scrape succeeded.",
        "gauge",
        [({}, int(scrape_success))],
    )
    document.metric(
        "viajaya_realtime_outbox_dispatcher_enabled",
        "Whether the configuration requires an outbox dispatcher.",
        "gauge",
        [({}, int(dispatcher_enabled))],
    )
    document.metric(
        "viajaya_realtime_outbox_dispatcher_running",
        "Whether the required dispatcher is running in this process.",
        "gauge",
        [({}, int(dispatcher_running))],
    )
    document.metric(
        "viajaya_realtime_outbox_dispatcher_error",
        "Whether the dispatcher keeps an unrecovered operational failure.",
        "gauge",
        [({}, int(dispatcher_error))],
    )
    document.metric(
        "viajaya_realtime_redis_bridge_enabled",
        "Whether the active mode requires Redis fan-out between processes.",
        "gauge",
        [({}, int(mode == "live_redis"))],
    )
    document.metric(
        "viajaya_realtime_redis_bridge_connected",
        "Whether this process keeps its realtime Redis subscription.",
        "gauge",
        [({}, int(redis_connected))],
    )
    document.metric(
        "viajaya_realtime_redis_bridge_error",
        "Whether the Redis bridge keeps an unrecovered failure.",
        "gauge",
        [({}, int(redis_error))],
    )
    for name, help_text, value in (
        (
            "published_batches",
            "Batches published to Redis by this process since startup.",
            redis_published_batch_count,
        ),
        (
            "received_batches",
            "Redis batches received by this process since startup.",
            redis_received_batch_count,
        ),
        (
            "received_events",
            "Redis events received by this process since startup.",
            redis_received_event_count,
        ),
        (
            "resync_messages",
            "Redis resnapshot commands received since startup.",
            redis_resync_message_count,
        ),
        (
            "reconnects",
            "Redis reconnections attempted by this process since startup.",
            redis_reconnect_count,
        ),
        (
            "invalid_messages",
            "Invalid Redis messages discarded since startup.",
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
        "Subscribers confirmed by this process's last PUBLISH.",
        "gauge",
        [({}, redis_last_publish_subscriber_count)],
    )
    document.metric(
        "viajaya_realtime_local_sockets",
        "Unique local WebSocket sockets subscribed in this process.",
        "gauge",
        [({}, redis_local_socket_count)],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_enabled",
        "Whether the configuration requires the retention worker.",
        "gauge",
        [({}, int(retention_days > 0))],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_running",
        "Whether the required retention worker is running.",
        "gauge",
        [({}, int(retention_running))],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_error",
        "Whether the retention worker keeps an unrecovered failure.",
        "gauge",
        [({}, int(retention_error))],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_days",
        "TTL configured for published batches; zero disables retention.",
        "gauge",
        [({}, retention_days)],
    )
    document.metric(
        "viajaya_realtime_outbox_retention_deleted_batches",
        "Published batches deleted by this process since startup.",
        "counter",
        [({}, retention_deleted_batch_count)],
        sample_name="viajaya_realtime_outbox_retention_deleted_batches_total",
    )
    document.metric(
        "viajaya_realtime_outbox_retention_deleted_events",
        "Published events deleted by this process since startup.",
        "counter",
        [({}, retention_deleted_event_count)],
        sample_name="viajaya_realtime_outbox_retention_deleted_events_total",
    )

    document.metric(
        "viajaya_scheduled_actions",
        "Stable information about the scheduled actions mode.",
        "info",
        [({"mode": scheduled_mode}, 1)],
        sample_name="viajaya_scheduled_actions_info",
    )
    document.metric(
        "viajaya_scheduled_actions_collection_success",
        "Whether the scheduler's persisted scrape succeeded.",
        "gauge",
        [({}, int(scheduled_scrape_success))],
    )
    document.metric(
        "viajaya_scheduled_actions_worker_enabled",
        "Whether the configuration requires running the worker.",
        "gauge",
        [({}, int(scheduled_mode in {"shadow", "live"}))],
    )
    document.metric(
        "viajaya_scheduled_actions_worker_running",
        "Whether the required worker is running in this process.",
        "gauge",
        [({}, int(scheduled_worker_running))],
    )
    document.metric(
        "viajaya_scheduled_actions_worker_error",
        "Whether the worker keeps an unrecovered operational failure.",
        "gauge",
        [({}, int(scheduled_worker_error))],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_running",
        "Whether the required retention is running in this process.",
        "gauge",
        [({}, int(scheduled_retention_running))],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_error",
        "Whether retention keeps an unrecovered operational failure.",
        "gauge",
        [({}, int(scheduled_retention_error))],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_days",
        "TTL of succeeded/cancelled actions; dead actions are kept.",
        "gauge",
        [({}, scheduled_retention_days)],
    )
    document.metric(
        "viajaya_scheduled_actions_retention_deleted_actions",
        "Terminal actions deleted by this process since startup.",
        "counter",
        [({}, scheduled_retention_deleted_action_count)],
        sample_name="viajaya_scheduled_actions_retention_deleted_actions_total",
    )
    for name, help_text, value in (
        (
            "claimed",
            "Actions claimed by this process since startup.",
            scheduled_claimed_count,
        ),
        (
            "succeeded",
            "Actions completed by this process since startup.",
            scheduled_succeeded_count,
        ),
        (
            "deferred",
            "Actions safely postponed by this process.",
            scheduled_deferred_count,
        ),
        (
            "retried",
            "Actions rescheduled by this process since startup.",
            scheduled_retried_count,
        ),
        (
            "dead",
            "Actions exhausted by this process since startup.",
            scheduled_dead_count,
        ),
        (
            "recovered_leases",
            "Abandoned leases recovered by this process since startup.",
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
                "Actions with a claimed lease.",
                scheduled_snapshot.running_count,
            ),
            (
                "stale",
                "Running actions whose lease can already be recovered.",
                scheduled_snapshot.stale_count,
            ),
            (
                "retrying",
                "Pending actions that consumed at least one attempt.",
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
            "Terminal dead actions grouped by bounded type.",
            "gauge",
            [
                ({"action_type": action_type}, count)
                for action_type, count in sorted(dead_counts.items())
            ],
        )
        document.metric(
            "viajaya_scheduled_actions_oldest_due_age_seconds",
            "Age of the oldest due action.",
            "gauge",
            [({}, scheduled_snapshot.oldest_due_age_seconds)],
        )
        if scheduled_snapshot.next_due_at is not None:
            document.metric(
                "viajaya_scheduled_actions_next_due_timestamp_seconds",
                "Unix instant of the next pending deadline.",
                "gauge",
                [({}, scheduled_snapshot.next_due_at.timestamp())],
            )
        if scheduled_snapshot.latest_succeeded_at is not None:
            document.metric(
                "viajaya_scheduled_actions_latest_succeeded_timestamp_seconds",
                "Unix instant of the last successful ack observed.",
                "gauge",
                [({}, scheduled_snapshot.latest_succeeded_at.timestamp())],
            )

    document.metric(
        "viajaya_passenger_presence_enabled",
        "Whether this process uses shared Redis presence leases.",
        "gauge",
        [({}, int(shared_presence_enabled))],
    )
    document.metric(
        "viajaya_passenger_presence_healthy",
        "Whether the Redis presence client is healthy.",
        "gauge",
        [({}, int(shared_presence_healthy))],
    )
    for name, help_text, value in (
        (
            "renewals",
            "WebSocket leases or HTTP pulses renewed since startup.",
            presence_renewal_count,
        ),
        (
            "disconnects",
            "WebSocket leases closed since startup.",
            presence_disconnect_count,
        ),
        (
            "observations",
            "Requests evaluated by presence since startup.",
            presence_observation_count,
        ),
        (
            "failures",
            "Sanitized presence client failures since startup.",
            presence_failure_count,
        ),
    ):
        document.metric(
            f"viajaya_passenger_presence_{name}",
            help_text,
            "counter",
            [({}, value)],
            sample_name=f"viajaya_passenger_presence_{name}_total",
        )

    if snapshot is None:
        return document.render()

    document.metric(
        "viajaya_realtime_outbox_pending_events",
        "Pending non-terminal events in the outbox.",
        "gauge",
        [({}, snapshot.pending_event_count)],
    )
    document.metric(
        "viajaya_realtime_outbox_pending_batches",
        "Pending non-terminal batches in the outbox.",
        "gauge",
        [({}, snapshot.pending_batch_count)],
    )
    document.metric(
        "viajaya_realtime_outbox_retrying_batches",
        "Pending batches that already consumed at least one attempt.",
        "gauge",
        [({}, snapshot.retrying_batch_count)],
    )
    quarantine_counts = dict.fromkeys((*_QUARANTINE_CODES, "unknown"), 0)
    for item in snapshot.quarantined_batches:
        code = _quarantine_code(item.code)
        quarantine_counts[code] = quarantine_counts.get(code, 0) + item.batch_count
    document.metric(
        "viajaya_realtime_outbox_quarantined_batches",
        "Terminal quarantined batches grouped by stable code.",
        "gauge",
        [
            ({"code": code}, count)
            for code, count in sorted(quarantine_counts.items())
        ],
    )
    document.metric(
        "viajaya_realtime_outbox_max_pending_age_seconds",
        "Approximate maximum age of the pending events.",
        "gauge",
        [({}, snapshot.max_pending_age_seconds)],
    )
    if snapshot.latest_publish_delay_seconds is not None:
        document.metric(
            "viajaya_realtime_outbox_latest_publish_delay_seconds",
            "Conservative created_at to published_at delay of the last published event.",
            "gauge",
            [({}, snapshot.latest_publish_delay_seconds)],
        )
    if snapshot.latest_published_at is not None:
        document.metric(
            "viajaya_realtime_outbox_latest_published_timestamp_seconds",
            "Unix instant of the last published event observed.",
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
    """Expose scrapeable metrics without turning internal failures into data."""
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
    passenger_presence = request.app.state.passenger_presence_store

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
                "Outbox OpenMetrics scrape failed (%s).",
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
                "scheduled_actions OpenMetrics scrape failed (%s).",
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
            scheduled_deferred_count=(
                scheduled_worker.deferred_count
                if scheduled_worker is not None
                else 0
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
            shared_presence_enabled=settings.realtime_shared_presence_enabled,
            shared_presence_healthy=bool(
                passenger_presence is not None and passenger_presence.healthy
            ),
            presence_renewal_count=(
                passenger_presence.renewal_count
                if passenger_presence is not None
                else 0
            ),
            presence_disconnect_count=(
                passenger_presence.disconnect_count
                if passenger_presence is not None
                else 0
            ),
            presence_observation_count=(
                passenger_presence.observation_count
                if passenger_presence is not None
                else 0
            ),
            presence_failure_count=(
                passenger_presence.failure_count
                if passenger_presence is not None
                else 0
            ),
        )
    )
