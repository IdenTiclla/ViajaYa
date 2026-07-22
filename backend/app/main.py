"""Punto de entrada de la API FastAPI."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api import health, metrics
from app.api.deps import get_session_factory
from app.api.errors import register_exception_handlers
from app.api.v1 import presence
from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    LocalHubRealtimeOutboxBatchPublisher,
)
from app.api.v1.routers import auth, drivers, rides, saved_places
from app.api.v1.ws import negotiation
from app.application.interfaces import (
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
)
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.db.advisory_lock import PostgreSQLLiveLocalProcessLock
from app.infrastructure.db.session import async_session_factory, get_session
from app.infrastructure.realtime.hub import hub
from app.infrastructure.realtime.outbox_dispatcher import (
    LocalRealtimeOutboxDispatcher,
    ShadowRealtimeOutboxDispatcher,
)
from app.infrastructure.realtime.outbox_retention import (
    PublishedRealtimeOutboxRetentionWorker,
)

logger = logging.getLogger(__name__)


def create_app(
    *,
    settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    realtime_outbox_batch_validator: RealtimeOutboxBatchValidator | None = None,
    realtime_outbox_batch_publisher: RealtimeOutboxBatchPublisher | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    resolved_session_factory = session_factory or async_session_factory
    if (
        realtime_outbox_batch_publisher is not None
        and resolved_settings.realtime_outbox_dispatch_mode != "live_local"
    ):
        raise ValueError(
            "Un publisher realtime inyectado requiere el modo live_local."
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        dispatcher: ShadowRealtimeOutboxDispatcher | None = None
        dispatcher_task: asyncio.Task[None] | None = None
        retention_worker: PublishedRealtimeOutboxRetentionWorker | None = None
        retention_task: asyncio.Task[None] | None = None
        process_lock: PostgreSQLLiveLocalProcessLock | None = None
        app.state.realtime_outbox_dispatcher = None
        app.state.realtime_outbox_dispatcher_task = None
        app.state.live_local_process_lock = None
        app.state.realtime_outbox_retention_worker = None
        app.state.realtime_outbox_retention_task = None
        previous_legacy_delivery = hub.legacy_delivery_enabled
        mode = resolved_settings.realtime_outbox_dispatch_mode
        try:
            if mode in {"shadow", "live_local"}:
                process_lock = PostgreSQLLiveLocalProcessLock(
                    resolved_session_factory,
                    exclusive=mode == "live_local",
                )
                app.state.live_local_process_lock = process_lock
                await process_lock.acquire()

            if mode == "live_local":
                # El mismo cambio de modo que activa snapshots/eventos v2 apaga
                # la ruta directa. Nunca se entregan ambos protocolos al socket.
                hub.set_legacy_delivery_enabled(False)

            if mode in {"shadow", "live_local"}:
                batch_validator = (
                    realtime_outbox_batch_validator
                    if realtime_outbox_batch_validator is not None
                    else CanonicalRealtimeOutboxBatchValidator()
                )
                dispatcher_options = {
                    "poll_interval_seconds": (
                        resolved_settings.realtime_outbox_poll_interval_seconds
                    ),
                    "retry_base_seconds": (
                        resolved_settings.realtime_outbox_retry_base_seconds
                    ),
                    "retry_max_seconds": (
                        resolved_settings.realtime_outbox_retry_max_seconds
                    ),
                    "process_guard": process_lock.check if process_lock else None,
                }
                if mode == "live_local":
                    dispatcher = LocalRealtimeOutboxDispatcher(
                        resolved_session_factory,
                        batch_validator,
                        (
                            realtime_outbox_batch_publisher
                            if realtime_outbox_batch_publisher is not None
                            else LocalHubRealtimeOutboxBatchPublisher()
                        ),
                        **dispatcher_options,
                    )
                else:
                    dispatcher = ShadowRealtimeOutboxDispatcher(
                        resolved_session_factory,
                        batch_validator,
                        **dispatcher_options,
                    )
                # Una base sin 0018–0021 es un error de despliegue y debe impedir
                # que la API aparente estar lista en cualquier modo consumidor.
                await dispatcher.preflight()
                dispatcher_task = asyncio.create_task(
                    dispatcher.run(),
                    name=f"realtime-outbox-{mode}-dispatcher",
                )
                app.state.realtime_outbox_dispatcher = dispatcher
                app.state.realtime_outbox_dispatcher_task = dispatcher_task
                # El servidor no queda listo antes de que la tarea haya podido
                # entrar a su loop y exponer ``running=True``.
                await asyncio.sleep(0)

            retention_days = (
                resolved_settings.realtime_outbox_published_retention_days
            )
            if retention_days > 0:
                retention_worker = PublishedRealtimeOutboxRetentionWorker(
                    resolved_session_factory,
                    retention_days=retention_days,
                    interval_seconds=(
                        resolved_settings.realtime_outbox_retention_interval_seconds
                    ),
                    batch_limit=(
                        resolved_settings.realtime_outbox_retention_batch_limit
                    ),
                )
                await retention_worker.preflight()
                retention_task = asyncio.create_task(
                    retention_worker.run(),
                    name="realtime-outbox-published-retention",
                )
                app.state.realtime_outbox_retention_worker = retention_worker
                app.state.realtime_outbox_retention_task = retention_task
                await asyncio.sleep(0)

            yield
        finally:
            # Los timers HTTP/WS pueden sobrevivir a su request original. Se
            # cierran antes del dispatcher para que ningún productor quede
            # escribiendo en la outbox durante el apagado.
            await rides.shutdown_expiry_tasks()
            await presence.shutdown_presence_tasks()
            if dispatcher is not None:
                dispatcher.stop()
            if retention_worker is not None:
                retention_worker.stop()

            background_tasks = [
                task
                for task in (dispatcher_task, retention_task)
                if task is not None
            ]
            if background_tasks:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(*background_tasks, return_exceptions=True),
                        timeout=(
                            resolved_settings.realtime_outbox_shutdown_timeout_seconds
                        ),
                    )
                except TimeoutError:
                    logger.error(
                        "Los workers de outbox excedieron el tiempo de apagado; "
                        "se cancelarán las tareas pendientes."
                    )
                    for task in background_tasks:
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(*background_tasks, return_exceptions=True)
            hub.set_legacy_delivery_enabled(previous_legacy_delivery)
            if process_lock is not None:
                await process_lock.release()

    app = FastAPI(title="ViajaYa API", version="0.1.0", lifespan=lifespan)
    app.state.realtime_outbox_dispatcher = None
    app.state.realtime_outbox_dispatcher_task = None
    app.state.live_local_process_lock = None
    app.state.realtime_outbox_retention_worker = None
    app.state.realtime_outbox_retention_task = None

    async def resolved_get_session() -> AsyncIterator[AsyncSession]:
        async with resolved_session_factory() as session:
            yield session

    # ``create_app`` es la raíz de composición. Sus argumentos deben gobernar
    # también las dependencias HTTP/WS; de otro modo el lifecycle podría estar
    # en live_local mientras los recorders y el handshake siguen en ``off``.
    app.dependency_overrides[get_settings] = lambda: resolved_settings
    app.dependency_overrides[get_session_factory] = lambda: resolved_session_factory
    app.dependency_overrides[get_session] = resolved_get_session

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(rides.router, prefix="/api/v1")
    app.include_router(drivers.router, prefix="/api/v1")
    app.include_router(saved_places.router, prefix="/api/v1")
    app.include_router(negotiation.router, prefix="/api/v1")
    app.include_router(health.router)
    if resolved_settings.openmetrics_enabled:
        app.include_router(metrics.router)

    return app


app = create_app()
