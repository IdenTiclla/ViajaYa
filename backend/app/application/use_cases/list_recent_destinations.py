"""Caso de uso: listar los destinos recientes de un pasajero."""

from __future__ import annotations

import uuid

from app.domain.entities import Location
from app.domain.repositories import RideRequestRepository


class ListRecentDestinations:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(self, rider_id: uuid.UUID, limit: int = 10) -> list[Location]:
        return await self._rides.list_recent_destinations(rider_id, limit)
