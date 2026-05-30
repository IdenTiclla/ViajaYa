"""Caso de uso: actualizar un lugar guardado del usuario."""

from __future__ import annotations

import uuid

from app.application.dto import SaveSavedPlaceInput
from app.domain.entities import Location, SavedPlace
from app.domain.exceptions import SavedPlaceNotFoundError
from app.domain.repositories import SavedPlaceRepository
from app.domain.value_objects import GeoPoint


class UpdateSavedPlace:
    def __init__(self, places: SavedPlaceRepository) -> None:
        self._places = places

    async def execute(
        self, user_id: uuid.UUID, place_id: uuid.UUID, data: SaveSavedPlaceInput
    ) -> SavedPlace:
        existing = await self._places.get_by_id(place_id)
        if existing is None or existing.user_id != user_id:
            raise SavedPlaceNotFoundError("El lugar guardado no existe.")

        point = GeoPoint(data.location.latitude, data.location.longitude)
        existing.label = data.label.strip()
        existing.category = data.category
        existing.location = Location(
            latitude=point.latitude,
            longitude=point.longitude,
            name=data.location.name.strip(),
            address=data.location.address.strip(),
        )
        return await self._places.update(existing)
