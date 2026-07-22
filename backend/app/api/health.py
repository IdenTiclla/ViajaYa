"""Probes operativos y estado sanitario sin datos sensibles."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import (
    RealtimeOutboxOperationalSnapshotDep,
    SessionFactoryDep,
    SettingsDep,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessChecksResponse(BaseModel):
    database: Literal["ok", "error"]
    scheduled_actions_worker: Literal["ok", "error", "disabled"]
    realtime_outbox_dispatcher: Literal["ok", "error", "disabled"]
    realtime_outbox_process_lock: Literal["ok", "error", "disabled"]
    realtime_outbox_retention: Literal["ok", "error", "disabled"]


class ReadinessResponse(BaseModel):
    status: Literal["ok", "unavailable"]
    checks: ReadinessChecksResponse


class QuarantinedBatchCountResponse(BaseModel):
    code: str
    batch_count: int


class RealtimeHealthResponse(BaseModel):
    status: Literal["ok", "disabled", "unavailable"]
    mode: Literal["off", "shadow", "live_local"]
    retention_days: int
    captured_at: datetime | None = None
    pending_event_count: int | None = None
    pending_batch_count: int | None = None
    retrying_batch_count: int | None = None
    quarantined_batches: list[QuarantinedBatchCountResponse] | None = None
    max_pending_age_seconds: float | None = None
    latest_publish_delay_seconds: float | None = None
    latest_published_at: datetime | None = None
    retention_deleted_batch_count: int | None = None
    retention_deleted_event_count: int | None = None


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Contrato de liveness histórico, conservado sin cambios."""
    return HealthResponse()


@router.get("/health/live", response_model=HealthResponse)
async def liveness() -> HealthResponse:
    """Solo certifica que el proceso puede responder; no consulta dependencias."""
    return HealthResponse()


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse}},
)
async def readiness(
    request: Request,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
) -> ReadinessResponse | JSONResponse:
    """Comprueba PostgreSQL y los workers habilitados, sin filtrar errores."""
    database_ready = True
    try:
        async with asyncio.timeout(2):
            async with session_factory() as session:
                await session.execute(text("SELECT 1"))
                await session.rollback()
    except Exception as error:  # noqa: BLE001 - probe sanitario
        database_ready = False
        logger.warning(
            "Falló el probe de readiness de PostgreSQL (%s).",
            type(error).__name__,
        )

    mode = settings.realtime_outbox_dispatch_mode
    dispatcher_ready = True
    dispatcher_status: Literal["ok", "error", "disabled"] = "disabled"
    dispatcher = None
    if mode in {"shadow", "live_local"}:
        dispatcher = request.app.state.realtime_outbox_dispatcher
        dispatcher_task = request.app.state.realtime_outbox_dispatcher_task
        dispatcher_ready = bool(
            dispatcher is not None
            and dispatcher.running
            and dispatcher_task is not None
            and not dispatcher_task.done()
        )
        dispatcher_status = "ok" if dispatcher_ready else "error"

    process_lock_ready = True
    process_lock_status: Literal["ok", "error", "disabled"] = "disabled"
    if mode in {"shadow", "live_local"}:
        process_lock = request.app.state.live_local_process_lock
        try:
            process_lock_ready = bool(
                process_lock is not None
                and await asyncio.wait_for(process_lock.check(), timeout=2)
            )
        except Exception:  # noqa: BLE001 - probe sanitario fail-closed
            process_lock_ready = False
        process_lock_status = "ok" if process_lock_ready else "error"
        if not process_lock_ready and dispatcher is not None:
            # La pérdida de la sesión libera el advisory lock en PostgreSQL.
            # Detener el consumidor evita dos claims mientras el pod se repone.
            dispatcher.stop()

    retention_ready = True
    retention_status: Literal["ok", "error", "disabled"] = "disabled"
    if settings.realtime_outbox_published_retention_days > 0:
        retention_worker = request.app.state.realtime_outbox_retention_worker
        retention_task = request.app.state.realtime_outbox_retention_task
        retention_ready = bool(
            retention_worker is not None
            and retention_worker.running
            and retention_task is not None
            and not retention_task.done()
        )
        retention_status = "ok" if retention_ready else "error"

    scheduled_ready = True
    scheduled_status: Literal["ok", "error", "disabled"] = "disabled"
    if settings.scheduled_actions_mode == "live":
        scheduled_worker = request.app.state.scheduled_actions_worker
        scheduled_task = request.app.state.scheduled_actions_task
        scheduled_ready = bool(
            scheduled_worker is not None
            and scheduled_worker.running
            and scheduled_task is not None
            and not scheduled_task.done()
        )
        scheduled_status = "ok" if scheduled_ready else "error"

    ready = (
        database_ready
        and dispatcher_ready
        and process_lock_ready
        and retention_ready
        and scheduled_ready
    )
    response = ReadinessResponse(
        status="ok" if ready else "unavailable",
        checks=ReadinessChecksResponse(
            database="ok" if database_ready else "error",
            scheduled_actions_worker=scheduled_status,
            realtime_outbox_dispatcher=dispatcher_status,
            realtime_outbox_process_lock=process_lock_status,
            realtime_outbox_retention=retention_status,
        ),
    )
    if ready:
        return response
    return JSONResponse(status_code=503, content=response.model_dump(mode="json"))


@router.get(
    "/health/realtime",
    response_model=RealtimeHealthResponse,
    response_model_exclude_none=True,
    responses={503: {"model": RealtimeHealthResponse}},
)
async def realtime_health(
    request: Request,
    settings: SettingsDep,
    use_case: RealtimeOutboxOperationalSnapshotDep,
) -> RealtimeHealthResponse | JSONResponse:
    """Expone métricas acotadas de outbox sin topics, payloads ni errores."""
    mode = settings.realtime_outbox_dispatch_mode
    retention_days = settings.realtime_outbox_published_retention_days
    if mode == "off" and retention_days == 0:
        return RealtimeHealthResponse(
            status="disabled",
            mode=mode,
            retention_days=retention_days,
        )

    try:
        async with asyncio.timeout(2):
            snapshot = await use_case.execute(datetime.now(UTC))
    except Exception as error:  # noqa: BLE001 - probe sanitario
        logger.warning(
            "Falló el snapshot operativo de la outbox (%s).",
            type(error).__name__,
        )
        response = RealtimeHealthResponse(
            status="unavailable",
            mode=mode,
            retention_days=retention_days,
        )
        return JSONResponse(
            status_code=503,
            content=response.model_dump(mode="json", exclude_none=True),
        )

    retention_worker = request.app.state.realtime_outbox_retention_worker
    return RealtimeHealthResponse(
        status="ok",
        mode=mode,
        captured_at=snapshot.captured_at,
        pending_event_count=snapshot.pending_event_count,
        pending_batch_count=snapshot.pending_batch_count,
        retrying_batch_count=snapshot.retrying_batch_count,
        quarantined_batches=[
            QuarantinedBatchCountResponse(
                code=item.code,
                batch_count=item.batch_count,
            )
            for item in snapshot.quarantined_batches
        ],
        max_pending_age_seconds=snapshot.max_pending_age_seconds,
        latest_publish_delay_seconds=snapshot.latest_publish_delay_seconds,
        latest_published_at=snapshot.latest_published_at,
        retention_days=retention_days,
        retention_deleted_batch_count=(
            retention_worker.deleted_batch_count
            if retention_worker is not None
            else 0
        ),
        retention_deleted_event_count=(
            retention_worker.deleted_event_count
            if retention_worker is not None
            else 0
        ),
    )
