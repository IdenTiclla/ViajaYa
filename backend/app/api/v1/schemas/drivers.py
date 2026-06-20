"""Schemas Pydantic para conductores (`/drivers`)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.application.dto import DriverEarnings


class OnlineRequest(BaseModel):
    """Cuerpo para alternar disponibilidad del conductor."""

    is_online: bool


class EarningsItemResponse(BaseModel):
    """Una línea del desglose de ganancias."""

    ride_id: uuid.UUID
    destination_name: str
    price: Decimal
    completed_at: datetime | None = None


class DriverEarningsResponse(BaseModel):
    """Resumen de ganancias del conductor (hoy, histórico y recientes)."""

    total_today: Decimal
    trips_today: int
    total_all_time: Decimal
    trips_all_time: int
    recent: list[EarningsItemResponse]

    @classmethod
    def from_dto(cls, earnings: DriverEarnings) -> DriverEarningsResponse:
        return cls(
            total_today=earnings.total_today,
            trips_today=earnings.trips_today,
            total_all_time=earnings.total_all_time,
            trips_all_time=earnings.trips_all_time,
            recent=[
                EarningsItemResponse(
                    ride_id=item.ride_id,
                    destination_name=item.destination_name,
                    price=item.price,
                    completed_at=item.completed_at,
                )
                for item in earnings.recent
            ],
        )
