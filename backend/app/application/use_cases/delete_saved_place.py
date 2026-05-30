"""Caso de uso: eliminar un lugar guardado del usuario."""

from __future__ import annotations

import uuid

from app.domain.exceptions import SavedPlaceNotFoundError
from app.domain.repositories import SavedPlaceRepository


class DeleteSavedPlace:
    def __init__(self, places: SavedPlaceRepository) -> None:
        self._places = places

    async def execute(self, user_id: uuid.UUID, place_id: uuid.UUID) -> None:
        existing = await self._places.get_by_id(place_id)
        if existing is None or existing.user_id != user_id:
            raise SavedPlaceNotFoundError("El lugar guardado no existe.")
        await self._places.delete(existing)
