"""Punto de entrada de la API FastAPI."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_session_factory
from app.api.errors import register_exception_handlers
from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    LocalHubRealtimeOutboxBatchPublisher,
)
from app.api.v1.routers import auth, drivers, rides, saved_places
from app.api.v1.ws import negotiation
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.db.session import async_session_factory, get_session
from app.infrastructure.realtime.hub import hub
from app.infrastructure.realtime.outbox_dispatcher import (
    LocalRealtimeOutboxDispatcher,
    ShadowRealtimeOutboxDispatcher,
)

logger = logging.getLogger(__name__)


def create_app(
    *,
    settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    resolved_session_factory = session_factory or async_session_factory

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        dispatcher: ShadowRealtimeOutboxDispatcher | None = None
        dispatcher_task: asyncio.Task[None] | None = None
        app.state.realtime_outbox_dispatcher = None
        previous_legacy_delivery = hub.legacy_delivery_enabled
        mode = resolved_settings.realtime_outbox_dispatch_mode
        if mode == "live_local":
            # El mismo cambio de modo que activa snapshots/eventos v2 apaga la
            # ruta directa. Nunca se entregan ambos protocolos al mismo socket.
            hub.set_legacy_delivery_enabled(False)
        try:
            if mode in {"shadow", "live_local"}:
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
                }
                if mode == "live_local":
                    dispatcher = LocalRealtimeOutboxDispatcher(
                        resolved_session_factory,
                        CanonicalRealtimeOutboxBatchValidator(),
                        LocalHubRealtimeOutboxBatchPublisher(),
                        **dispatcher_options,
                    )
                else:
                    dispatcher = ShadowRealtimeOutboxDispatcher(
                        resolved_session_factory,
                        CanonicalRealtimeOutboxBatchValidator(),
                        **dispatcher_options,
                    )
                # Una base sin 0018–0020 es un error de despliegue y debe impedir
                # que la API aparente estar lista en cualquier modo consumidor.
                await dispatcher.preflight()
                dispatcher_task = asyncio.create_task(
                    dispatcher.run(),
                    name=f"realtime-outbox-{mode}-dispatcher",
                )
                app.state.realtime_outbox_dispatcher = dispatcher

            yield
        finally:
            if dispatcher is not None and dispatcher_task is not None:
                dispatcher.stop()
                try:
                    await asyncio.wait_for(
                        dispatcher_task,
                        timeout=(
                            resolved_settings.realtime_outbox_shutdown_timeout_seconds
                        ),
                    )
                except TimeoutError:
                    logger.error(
                        "El dispatcher %s excedió el tiempo de apagado; "
                        "se cancelará la tarea.",
                        mode,
                    )
                    dispatcher_task.cancel()
                    await asyncio.gather(dispatcher_task, return_exceptions=True)
            hub.set_legacy_delivery_enabled(previous_legacy_delivery)

    app = FastAPI(title="ViajaYa API", version="0.1.0", lifespan=lifespan)

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

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
