"""Caso de uso: listar los lugares guardados de un usuario."""

from __future__ import annotations

import uuid

from app.domain.entities import SavedPlace
from app.domain.repositories import SavedPlaceRepository


class ListSavedPlaces:
    def __init__(self, places: SavedPlaceRepository) -> None:
        self._places = places

    async def execute(self, user_id: uuid.UUID) -> list[SavedPlace]:
        return await self._places.list_by_user(user_id)
