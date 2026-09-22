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
from app.api.deps import build_driver_location_channel, get_session_factory
from app.api.errors import register_exception_handlers
from app.api.v1 import presence
from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    LocalHubRealtimeOutboxBatchPublisher,
)
from app.api.v1.redis_realtime import RedisRealtimeBridge
from app.api.v1.routers import auth, drivers, rides, saved_places
from app.api.v1.routers import driver_location as driver_location_router
from app.api.v1.routers.account_access import router as account_access_router
from app.api.v1.routers.phone_verification import create_phone_verification_router
from app.api.v1.scheduled_actions import (
    ApplicationScheduledActionExecutor,
    shutdown_shadow_scheduled_action_publications,
)
from app.api.v1.ws import driver_location as driver_location_ws
from app.api.v1.ws import negotiation
from app.application.interfaces import (
    RealtimeDeliveryBridge,
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
)
from app.application.use_cases.reconcile_missing_scheduled_actions import (
    ReconcileMissingScheduledActions,
)
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.correlation import REQUEST_ID_HEADER, CorrelationIdMiddleware
from app.infrastructure.db.advisory_lock import PostgreSQLLiveLocalProcessLock
from app.infrastructure.db.scheduled_actions_reconciliation import (
    CompositeMissingScheduledActionsReconciler,
    SqlAlchemyMissingOfferScheduledActionsReconciler,
    SqlAlchemyMissingPassengerPresenceActionsReconciler,
)
from app.infrastructure.db.session import async_session_factory, get_session
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.environment_boundary import (
    ENVIRONMENT_HEADER,
    EnvironmentBoundaryMiddleware,
)
from app.infrastructure.realtime.hub import hub
from app.infrastructure.realtime.outbox_dispatcher import (
    LocalRealtimeOutboxDispatcher,
    ShadowRealtimeOutboxDispatcher,
)
from app.infrastructure.realtime.outbox_retention import (
    PublishedRealtimeOutboxRetentionWorker,
)
from app.infrastructure.realtime.passenger_presence import (
    RedisPassengerPresenceStore,
)
from app.infrastructure.scheduled_actions.retention import (
    TerminalScheduledActionsRetentionWorker,
)
from app.infrastructure.scheduled_actions.worker import ScheduledActionsWorker

logger = logging.getLogger(__name__)


def create_app(
    *,
    settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    realtime_outbox_batch_validator: RealtimeOutboxBatchValidator | None = None,
    realtime_outbox_batch_publisher: RealtimeOutboxBatchPublisher | None = None,
    realtime_redis_bridge: RealtimeDeliveryBridge | None = None,
    passenger_presence_store: RedisPassengerPresenceStore | None = None,
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
    if (
        realtime_redis_bridge is not None
        and resolved_settings.realtime_outbox_dispatch_mode != "live_redis"
    ):
        raise ValueError("Un bridge Redis inyectado requiere el modo live_redis.")
    if (
        realtime_outbox_batch_publisher is not None
        and realtime_redis_bridge is not None
    ):
        raise ValueError("No se pueden inyectar dos transportes realtime live.")
    if (
        passenger_presence_store is not None
        and not resolved_settings.realtime_shared_presence_enabled
    ):
        raise ValueError(
            "Un almacén de presencia inyectado requiere presencia compartida."
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        dispatcher: ShadowRealtimeOutboxDispatcher | None = None
        dispatcher_task: asyncio.Task[None] | None = None
        redis_bridge: RealtimeDeliveryBridge | None = None
        redis_bridge_task: asyncio.Task[None] | None = None
        retention_worker: PublishedRealtimeOutboxRetentionWorker | None = None
        retention_task: asyncio.Task[None] | None = None
        scheduled_worker: ScheduledActionsWorker | None = None
        scheduled_task: asyncio.Task[None] | None = None
        scheduled_retention_worker: TerminalScheduledActionsRetentionWorker | None = None
        scheduled_retention_task: asyncio.Task[None] | None = None
        process_lock: PostgreSQLLiveLocalProcessLock | None = None
        shared_presence: RedisPassengerPresenceStore | None = None
        app.state.realtime_outbox_dispatcher = None
        app.state.realtime_outbox_dispatcher_task = None
        app.state.realtime_redis_bridge = None
        app.state.realtime_redis_bridge_task = None
        app.state.live_local_process_lock = None
        app.state.realtime_outbox_retention_worker = None
        app.state.realtime_outbox_retention_task = None
        app.state.scheduled_actions_worker = None
        app.state.scheduled_actions_task = None
        app.state.scheduled_actions_retention_worker = None
        app.state.scheduled_actions_retention_task = None
        app.state.passenger_presence_store = None
        previous_legacy_delivery = hub.legacy_delivery_enabled
        previous_shared_transport_health = hub.shared_transport_healthy
        mode = resolved_settings.realtime_outbox_dispatch_mode
        try:
            if mode in {"shadow", "live_local", "live_redis"}:
                process_lock = PostgreSQLLiveLocalProcessLock(
                    resolved_session_factory,
                    mode=mode,
                    allow_live_redis_multiworker=(
                        resolved_settings.realtime_shared_presence_enabled
                    ),
                )
                app.state.live_local_process_lock = process_lock
                await process_lock.acquire()

            if mode in {"live_local", "live_redis"}:
                # El mismo cambio de modo que activa snapshots/eventos v2 apaga
                # la ruta directa. Nunca se entregan ambos protocolos al socket.
                hub.set_legacy_delivery_enabled(False)

            if mode == "live_redis":
                redis_bridge = (
                    realtime_redis_bridge
                    if realtime_redis_bridge is not None
                    else RedisRealtimeBridge.from_url(
                        resolved_settings.realtime_redis_url,
                        channel=resolved_settings.realtime_redis_channel,
                        connect_timeout_seconds=(
                            resolved_settings.realtime_redis_connect_timeout_seconds
                        ),
                        reconnect_base_seconds=(
                            resolved_settings.realtime_redis_reconnect_base_seconds
                        ),
                        reconnect_max_seconds=(
                            resolved_settings.realtime_redis_reconnect_max_seconds
                        ),
                    )
                )
                await redis_bridge.preflight()
                redis_bridge_task = asyncio.create_task(
                    redis_bridge.run(),
                    name="realtime-redis-bridge",
                )
                app.state.realtime_redis_bridge = redis_bridge
                app.state.realtime_redis_bridge_task = redis_bridge_task
                await redis_bridge.wait_until_ready(
                    resolved_settings.realtime_redis_connect_timeout_seconds
                )

            if resolved_settings.realtime_shared_presence_enabled:
                shared_presence = (
                    passenger_presence_store
                    if passenger_presence_store is not None
                    else RedisPassengerPresenceStore.from_url(
                        resolved_settings.realtime_redis_url,
                        key_prefix=resolved_settings.realtime_presence_key_prefix,
                        lease_seconds=(
                            resolved_settings.realtime_presence_lease_seconds
                        ),
                        grace_seconds=(
                            resolved_settings.realtime_presence_grace_seconds
                        ),
                        timeout_seconds=(
                            resolved_settings.realtime_redis_connect_timeout_seconds
                        ),
                    )
                )
                await shared_presence.preflight()
                app.state.passenger_presence_store = shared_presence

            if mode in {"shadow", "live_local", "live_redis"}:
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
                if mode in {"live_local", "live_redis"}:
                    publisher = (
                        redis_bridge
                        if mode == "live_redis"
                        else (
                            realtime_outbox_batch_publisher
                            if realtime_outbox_batch_publisher is not None
                            else LocalHubRealtimeOutboxBatchPublisher()
                        )
                    )
                    assert publisher is not None
                    dispatcher = LocalRealtimeOutboxDispatcher(
                        resolved_session_factory,
                        batch_validator,
                        publisher,
                        mode_label=mode,
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

            scheduled_mode = resolved_settings.scheduled_actions_mode

            # La cola se escribe incluso en off; su esquema, reconciliación y
            # retención son obligatorios en los tres modos. Repetir la reparación
            # al arrancar cierra ofertas creadas por la versión anterior después
            # del backfill de 0022.
            scheduled_retention_worker = TerminalScheduledActionsRetentionWorker(
                resolved_session_factory,
                retention_days=(
                    resolved_settings.scheduled_actions_terminal_retention_days
                ),
                interval_seconds=(
                    resolved_settings.scheduled_actions_retention_interval_seconds
                ),
                action_limit=(
                    resolved_settings.scheduled_actions_retention_batch_limit
                ),
            )
            await scheduled_retention_worker.preflight()

            def build_scheduled_actions_reconciler(
                reconciliation_session: AsyncSession,
            ) -> CompositeMissingScheduledActionsReconciler:
                reconcilers = []
                if resolved_settings.realtime_shared_presence_enabled:
                    reconcilers.append(
                        SqlAlchemyMissingPassengerPresenceActionsReconciler(
                            reconciliation_session,
                            grace_seconds=(
                                resolved_settings.realtime_presence_grace_seconds
                            ),
                        )
                    )
                reconcilers.append(
                    SqlAlchemyMissingOfferScheduledActionsReconciler(
                        reconciliation_session
                    )
                )
                return CompositeMissingScheduledActionsReconciler(*reconcilers)

            async with resolved_session_factory() as reconciliation_session:
                await ReconcileMissingScheduledActions(
                    build_scheduled_actions_reconciler(reconciliation_session),
                    SqlAlchemyUnitOfWork(reconciliation_session),
                ).execute(resolved_settings.scheduled_actions_retention_batch_limit)

            if scheduled_mode in {"shadow", "live"}:
                scheduled_worker = ScheduledActionsWorker(
                    resolved_session_factory,
                    ApplicationScheduledActionExecutor(
                        resolved_session_factory,
                        resolved_settings,
                        passenger_presence=shared_presence,
                    ),
                    poll_interval_seconds=(
                        resolved_settings.scheduled_actions_poll_interval_seconds
                    ),
                    lease_seconds=resolved_settings.scheduled_actions_lease_seconds,
                    handler_timeout_seconds=(
                        resolved_settings.scheduled_actions_handler_timeout_seconds
                    ),
                    max_attempts=resolved_settings.scheduled_actions_max_attempts,
                    retry_base_seconds=(
                        resolved_settings.scheduled_actions_retry_base_seconds
                    ),
                    retry_max_seconds=(
                        resolved_settings.scheduled_actions_retry_max_seconds
                    ),
                    reconciler_factory=build_scheduled_actions_reconciler,
                    reconciliation_batch_limit=(
                        resolved_settings.scheduled_actions_retention_batch_limit
                    ),
                )
                await scheduled_worker.preflight()
                # Shadow conserva el timer legacy, pero también ejecuta la copia
                # durable. La carrera es idempotente y evita acumular un backlog
                # que bloquearía la promoción o un rollback desde live.
                scheduled_task = asyncio.create_task(
                    scheduled_worker.run(),
                    name=f"scheduled-actions-{scheduled_mode}-worker",
                )
                app.state.scheduled_actions_worker = scheduled_worker
                app.state.scheduled_actions_task = scheduled_task
                await asyncio.sleep(0)

            scheduled_retention_task = asyncio.create_task(
                scheduled_retention_worker.run(),
                name="scheduled-actions-terminal-retention",
            )
            app.state.scheduled_actions_retention_worker = scheduled_retention_worker
            app.state.scheduled_actions_retention_task = scheduled_retention_task
            await asyncio.sleep(0)

            yield
        finally:
            # Los timers HTTP/WS pueden sobrevivir a su request original. Se
            # cierran antes del dispatcher para que ningún productor quede
            # escribiendo en la outbox durante el apagado.
            await rides.shutdown_expiry_tasks()
            await presence.shutdown_presence_tasks()
            # El scheduler puede producir outbox: se detiene y espera antes de
            # cerrar el dispatcher que entrega sus eventos.
            if scheduled_worker is not None:
                scheduled_worker.stop()
            if scheduled_retention_worker is not None:
                scheduled_retention_worker.stop()
            scheduled_background_tasks = [
                task
                for task in (scheduled_task, scheduled_retention_task)
                if task is not None
            ]
            if scheduled_background_tasks:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(
                            *scheduled_background_tasks,
                            return_exceptions=True,
                        ),
                        timeout=(
                            resolved_settings.scheduled_actions_shutdown_timeout_seconds
                        ),
                    )
                except TimeoutError:
                    logger.error(
                        "Los workers de scheduled_actions excedieron el tiempo de apagado."
                    )
                    for task in scheduled_background_tasks:
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(
                        *scheduled_background_tasks,
                        return_exceptions=True,
                    )
            await shutdown_shadow_scheduled_action_publications(
                resolved_settings.scheduled_actions_shutdown_timeout_seconds
            )
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
            if redis_bridge is not None:
                redis_bridge.stop()
            if redis_bridge_task is not None:
                try:
                    await asyncio.wait_for(
                        redis_bridge_task,
                        timeout=(
                            resolved_settings.realtime_outbox_shutdown_timeout_seconds
                        ),
                    )
                except TimeoutError:
                    logger.error("El bridge Redis excedió el tiempo de apagado.")
                    redis_bridge_task.cancel()
                    await asyncio.gather(redis_bridge_task, return_exceptions=True)
            if redis_bridge is not None:
                await redis_bridge.aclose()
            if shared_presence is not None:
                await shared_presence.aclose()
            await app.state.driver_location_channel.aclose()
            hub.set_shared_transport_healthy(previous_shared_transport_health)
            hub.set_legacy_delivery_enabled(previous_legacy_delivery)
            if process_lock is not None:
                await process_lock.release()

    app = FastAPI(title="ViajaYa API", version="0.1.0", lifespan=lifespan)
    app.state.driver_location_channel = build_driver_location_channel(resolved_settings)
    app.state.realtime_outbox_dispatcher = None
    app.state.realtime_outbox_dispatcher_task = None
    app.state.realtime_redis_bridge = None
    app.state.realtime_redis_bridge_task = None
    app.state.live_local_process_lock = None
    app.state.realtime_outbox_retention_worker = None
    app.state.realtime_outbox_retention_task = None
    app.state.scheduled_actions_worker = None
    app.state.scheduled_actions_task = None
    app.state.scheduled_actions_retention_worker = None
    app.state.scheduled_actions_retention_task = None
    app.state.passenger_presence_store = None

    async def resolved_get_session() -> AsyncIterator[AsyncSession]:
        async with resolved_session_factory() as session:
            yield session

    # ``create_app`` es la raíz de composición. Sus argumentos deben gobernar
    # también las dependencias HTTP/WS; de otro modo el lifecycle podría estar
    # en live mientras los recorders y el handshake siguen en ``off``.
    app.dependency_overrides[get_settings] = lambda: resolved_settings
    app.dependency_overrides[get_session_factory] = lambda: resolved_session_factory
    app.dependency_overrides[get_session] = resolved_get_session

    app.add_middleware(EnvironmentBoundaryMiddleware, environment=resolved_settings.app_env)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER, ENVIRONMENT_HEADER],
    )
    app.add_middleware(CorrelationIdMiddleware)

    register_exception_handlers(app)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(account_access_router, prefix="/api/v1")
    app.include_router(create_phone_verification_router(
        include_test_code=resolved_settings.app_env != "production",
    ), prefix="/api/v1")
    app.include_router(rides.router, prefix="/api/v1")
    app.include_router(drivers.router, prefix="/api/v1")
    app.include_router(saved_places.router, prefix="/api/v1")
    app.include_router(negotiation.router, prefix="/api/v1")
    app.include_router(driver_location_ws.router, prefix="/api/v1")
    app.include_router(driver_location_router.router, prefix="/api/v1")
    app.include_router(health.router)
    if resolved_settings.openmetrics_enabled:
        app.include_router(metrics.router)

    return app


app = create_app()
