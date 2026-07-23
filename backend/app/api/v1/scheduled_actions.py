"""Adaptador que enruta acciones durables hacia casos de uso de aplicación."""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import (
    build_execute_cancel_absent_ride_scheduled_action,
    build_execute_expire_offer_scheduled_action,
)
from app.api.v1 import events
from app.application.dto import ScheduledAction
from app.application.exceptions import UnsupportedScheduledActionError
from app.application.interfaces import PassengerPresenceLeaseStore, ScheduledActionExecutor
from app.domain.entities import Offer
from app.infrastructure.config import Settings
from app.infrastructure.db.clock import DatabaseClock, database_utc_now

logger = logging.getLogger(__name__)
_SHADOW_PUBLICATION_TASKS: set[asyncio.Task[None]] = set()


async def _publish_shadow_offer_expired(offer: Offer) -> None:
    try:
        await events.publish_offer_expired(offer)
    except Exception:  # noqa: BLE001 - entrega legacy best-effort
        logger.exception(
            "No se pudo publicar la expiración shadow de la oferta %s.",
            offer.id,
        )


def _schedule_shadow_offer_expired(offer: Offer) -> None:
    task = asyncio.create_task(
        _publish_shadow_offer_expired(offer),
        name=f"scheduled-action-shadow-publish-{offer.id}",
    )
    _SHADOW_PUBLICATION_TASKS.add(task)
    task.add_done_callback(_SHADOW_PUBLICATION_TASKS.discard)


async def shutdown_shadow_scheduled_action_publications(
    timeout_seconds: float,
) -> None:
    """Drena publicaciones desacopladas del timeout transaccional del handler."""
    tasks = set(_SHADOW_PUBLICATION_TASKS)
    if not tasks:
        return
    try:
        await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=timeout_seconds,
        )
    except TimeoutError:
        logger.error("Las publicaciones legacy shadow excedieron el apagado.")
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


class ApplicationScheduledActionExecutor(ScheduledActionExecutor):
    """Abre una sesión nueva y mantiene efecto + ack en la misma transacción."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        clock: DatabaseClock = database_utc_now,
        passenger_presence: PassengerPresenceLeaseStore | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self._clock = clock
        self._passenger_presence = passenger_presence

    async def execute(
        self,
        action: ScheduledAction,
    ) -> Literal["succeeded", "deferred", "lost_lease"]:
        async with self._session_factory() as session:
            completed_at = await self._clock(session)
            if action.action_type == "cancel_absent_ride":
                if self._passenger_presence is None:
                    raise UnsupportedScheduledActionError(
                        "cancel_absent_ride requiere presencia compartida."
                    )
                result = await build_execute_cancel_absent_ride_scheduled_action(
                    session,
                    self._settings,
                    self._passenger_presence,
                ).execute(action, completed_at)
                return result.status
            if action.action_type != "expire_offer":
                raise UnsupportedScheduledActionError(
                    f"Tipo de acción no soportado: {action.action_type}."
                )
            result = await build_execute_expire_offer_scheduled_action(
                session,
                self._settings,
            ).execute(action, completed_at)
            if (
                self._settings.scheduled_actions_mode == "shadow"
                and result.expired_offer is not None
            ):
                # Shadow conserva la entrega legacy visible. Si el worker durable
                # gana la carrera al timer local, él debe publicar el mismo evento;
                # la mutación y el ack ya quedaron confirmados antes de este envío
                # best-effort, igual que en el camino HTTP histórico.
                _schedule_shadow_offer_expired(result.expired_offer)
            return result.status
