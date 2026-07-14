"""Caso de uso: guardar un lugar nuevo del usuario."""

from __future__ import annotations

import uuid

from app.application.dto import SaveSavedPlaceInput
from app.domain.entities import Location, SavedPlace
from app.domain.repositories import SavedPlaceRepository
from app.domain.value_objects import ServiceAreaPoint


class CreateSavedPlace:
    def __init__(self, places: SavedPlaceRepository) -> None:
        self._places = places

    async def execute(self, user_id: uuid.UUID, data: SaveSavedPlaceInput) -> SavedPlace:
        # Valida el rango de las coordenadas (regla de dominio).
        point = ServiceAreaPoint(
            data.location.latitude,
            data.location.longitude,
            data.location.country_code,
        )
        place = SavedPlace(
            user_id=user_id,
            label=data.label.strip(),
            category=data.category,
            location=Location(
                latitude=point.latitude,
                longitude=point.longitude,
                name=data.location.name.strip(),
                address=data.location.address.strip(),
            ),
        )
        return await self._places.add(place)
