"""Caso de uso: historial de viajes del usuario (pasajero o conductor)."""

from __future__ import annotations

from app.application.dto import Page, PageCursor, RideHistoryItem
from app.application.interfaces import RideReadRepository
from app.domain.entities import RideStatus, User

# Estados terminales que aparecen en el historial.
_TERMINAL = {RideStatus.COMPLETED, RideStatus.CANCELLED}


class ListRideHistory:
    def __init__(self, ride_reads: RideReadRepository) -> None:
        self._ride_reads = ride_reads

    async def execute(
        self,
        user: User,
        status: RideStatus | None = None,
        cursor: PageCursor | None = None,
        limit: int = 20,
    ) -> Page[RideHistoryItem]:
        statuses = {status} if status in _TERMINAL else set(_TERMINAL)
        return await self._ride_reads.list_history_items(
            user.id,
            user.role,
            statuses,
            cursor,
            limit,
        )
