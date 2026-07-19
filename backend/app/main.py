"""Punto de entrada de la API FastAPI."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.errors import register_exception_handlers
from app.api.v1.realtime_outbox import CanonicalRealtimeOutboxBatchValidator
from app.api.v1.routers import auth, drivers, rides, saved_places
from app.api.v1.ws import negotiation
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.db.session import async_session_factory
from app.infrastructure.realtime.outbox_dispatcher import (
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

        if resolved_settings.realtime_outbox_dispatch_mode == "shadow":
            dispatcher = ShadowRealtimeOutboxDispatcher(
                resolved_session_factory,
                CanonicalRealtimeOutboxBatchValidator(),
                poll_interval_seconds=(
                    resolved_settings.realtime_outbox_poll_interval_seconds
                ),
                retry_base_seconds=(
                    resolved_settings.realtime_outbox_retry_base_seconds
                ),
                retry_max_seconds=resolved_settings.realtime_outbox_retry_max_seconds,
            )
            # Con el flag activo, una base sin 0018–0020 es un error de despliegue y
            # debe impedir que la API aparente estar lista.
            await dispatcher.preflight()
            dispatcher_task = asyncio.create_task(
                dispatcher.run(),
                name="realtime-outbox-shadow-dispatcher",
            )
            app.state.realtime_outbox_dispatcher = dispatcher

        try:
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
                        "El dispatcher sombra excedió el tiempo de apagado; "
                        "se cancelará la tarea."
                    )
                    dispatcher_task.cancel()
                    await asyncio.gather(dispatcher_task, return_exceptions=True)

    app = FastAPI(title="ViajaYa API", version="0.1.0", lifespan=lifespan)

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
