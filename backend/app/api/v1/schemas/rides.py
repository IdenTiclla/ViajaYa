"""Schemas Pydantic de la API de viajes (contrato HTTP).

Separados de las entidades de dominio.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.domain.entities import Location, RideRequest, RideStatus, ServiceType


class PointSchema(BaseModel):
    """Un punto del viaje en el contrato HTTP."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=512)

    @classmethod
    def from_location(cls, location: Location) -> PointSchema:
        return cls(
            latitude=location.latitude,
            longitude=location.longitude,
            name=location.name,
            address=location.address,
        )


class CreateRideRequestRequest(BaseModel):
    origin: PointSchema
    destination: PointSchema
    service_type: ServiceType
    fare: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class RideRequestResponse(BaseModel):
    id: uuid.UUID
    status: RideStatus
    service_type: ServiceType
    fare: Decimal
    origin: PointSchema
    destination: PointSchema
    created_at: datetime | None

    @classmethod
    def from_entity(cls, ride: RideRequest) -> RideRequestResponse:
        return cls(
            id=ride.id,
            status=ride.status,
            service_type=ride.service_type,
            fare=ride.fare,
            origin=PointSchema.from_location(ride.origin),
            destination=PointSchema.from_location(ride.destination),
            created_at=ride.created_at,
        )


class RecentDestinationResponse(BaseModel):
    latitude: float
    longitude: float
    name: str
    address: str

    @classmethod
    def from_location(cls, location: Location) -> RecentDestinationResponse:
        return cls(
            latitude=location.latitude,
            longitude=location.longitude,
            name=location.name,
            address=location.address,
        )
