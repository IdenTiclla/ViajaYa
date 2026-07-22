"""Adaptador que enruta acciones durables hacia casos de uso de aplicación."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import build_execute_expire_offer_scheduled_action
from app.application.dto import ScheduledAction
from app.application.exceptions import UnsupportedScheduledActionError
from app.application.interfaces import ScheduledActionExecutor
from app.infrastructure.config import Settings


def _utc_now() -> datetime:
    return datetime.now(UTC)


class ApplicationScheduledActionExecutor(ScheduledActionExecutor):
    """Abre una sesión nueva y mantiene efecto + ack en la misma transacción."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self._clock = clock

    async def execute(
        self,
        action: ScheduledAction,
    ) -> Literal["succeeded", "lost_lease"]:
        if action.action_type != "expire_offer":
            raise UnsupportedScheduledActionError(
                f"Tipo de acción no soportado: {action.action_type}."
            )
        async with self._session_factory() as session:
            return await build_execute_expire_offer_scheduled_action(
                session,
                self._settings,
            ).execute(action, self._clock())
