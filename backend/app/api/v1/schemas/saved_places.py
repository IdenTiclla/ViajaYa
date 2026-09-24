"""Pydantic schemas of the saved places API (HTTP contract)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.api.v1.schemas.rides import PointInputSchema, PointSchema
from app.domain.entities import SavedPlace, SavedPlaceCategory


class SaveSavedPlaceRequest(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    category: SavedPlaceCategory
    location: PointInputSchema


class SavedPlaceResponse(BaseModel):
    id: uuid.UUID
    label: str
    category: SavedPlaceCategory
    location: PointSchema
    created_at: datetime | None
    updated_at: datetime | None

    @classmethod
    def from_entity(cls, place: SavedPlace) -> SavedPlaceResponse:
        return cls(
            id=place.id,
            label=place.label,
            category=place.category,
            location=PointSchema.from_location(place.location),
            created_at=place.created_at,
            updated_at=place.updated_at,
        )
