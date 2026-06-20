"""Schemas Pydantic para las calificaciones de viaje."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.domain.entities import RideRating


class RatingCreate(BaseModel):
    """Cuerpo para calificar un viaje completado (1–5 + comentario opcional)."""

    score: int = Field(..., ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)


class RatingResponse(BaseModel):
    id: uuid.UUID
    ride_id: uuid.UUID
    rater_id: uuid.UUID
    ratee_id: uuid.UUID
    score: int
    comment: str | None = None
    created_at: datetime | None = None

    @classmethod
    def from_entity(cls, rating: RideRating) -> RatingResponse:
        return cls(
            id=rating.id,
            ride_id=rating.ride_id,
            rater_id=rating.rater_id,
            ratee_id=rating.ratee_id,
            score=rating.score,
            comment=rating.comment,
            created_at=rating.created_at,
        )
