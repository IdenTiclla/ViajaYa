"""Schemas Pydantic de la API de viajes (contrato HTTP).

Separados de las entidades de dominio.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.application.dto import RideDetail, RideHistoryItem
from app.domain.entities import (
    Location,
    PaymentMethod,
    RideRequest,
    RideStatus,
    ServiceType,
    VehicleType,
)
from app.domain.repositories import OpenRideDetail
from app.domain.service_area import bolivia_covers


class PointSchema(BaseModel):
    """Un punto del viaje en el contrato HTTP."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(min_length=1, max_length=512)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)

    @classmethod
    def from_location(cls, location: Location) -> PointSchema:
        return cls(
            latitude=location.latitude,
            longitude=location.longitude,
            name=location.name,
            address=location.address,
            country_code=(
                "BO" if bolivia_covers(location.latitude, location.longitude) else None
            ),
        )


class CreateRideRequestRequest(BaseModel):
    origin: PointSchema
    destination: PointSchema
    service_type: ServiceType
    fare: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    payment_method: PaymentMethod = PaymentMethod.CASH


class RideEdit(CreateRideRequestRequest):
    """Cambios a guardar al modificar una solicitud pausada (mismos campos que al crear)."""


class RideRequestResponse(BaseModel):
    id: uuid.UUID
    status: RideStatus
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod
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
            payment_method=ride.payment_method,
            origin=PointSchema.from_location(ride.origin),
            destination=PointSchema.from_location(ride.destination),
            created_at=ride.created_at,
        )


class RideStatusUpdate(BaseModel):
    """Avance de estado del viaje solicitado por el conductor."""

    status: RideStatus


class RideFareUpdate(BaseModel):
    """Nuevo monto ofertado por el pasajero mientras busca conductor."""

    fare: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class OpenRideRiderResponse(BaseModel):
    """Datos públicos del pasajero que el conductor ve en una solicitud abierta."""

    id: uuid.UUID
    full_name: str
    rating: float | None = None
    trips_completed: int


class OpenRideResponse(BaseModel):
    """Solicitud abierta tal como la ve un conductor en su lista."""

    id: uuid.UUID
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod
    origin: PointSchema
    destination: PointSchema
    rider: OpenRideRiderResponse
    pool_version: int
    created_at: datetime | None

    @classmethod
    def from_open_ride(cls, detail: OpenRideDetail) -> OpenRideResponse:
        ride = detail.ride
        rider = detail.rider
        return cls(
            id=ride.id,
            service_type=ride.service_type,
            fare=ride.fare,
            payment_method=ride.payment_method,
            origin=PointSchema.from_location(ride.origin),
            destination=PointSchema.from_location(ride.destination),
            rider=OpenRideRiderResponse(
                id=ride.rider_id,
                full_name=rider.full_name,
                rating=rider.rating,
                trips_completed=rider.trips_completed,
            ),
            pool_version=ride.pool_version,
            created_at=ride.created_at,
        )


class RideDriverSchema(BaseModel):
    """Datos del conductor asignado, expuestos al pasajero durante el viaje."""

    id: uuid.UUID
    full_name: str
    phone: str | None
    rating: float | None
    vehicle_type: VehicleType | None
    plate: str | None
    vehicle_model: str | None


class RideRiderSchema(BaseModel):
    """Datos del pasajero, visibles para el conductor asignado."""

    id: uuid.UUID
    full_name: str
    phone: str | None
    rating: float | None


class RideResponse(BaseModel):
    """Detalle completo de un viaje (polling de estado para ambos lados)."""

    id: uuid.UUID
    rider_id: uuid.UUID
    status: RideStatus
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod
    origin: PointSchema
    destination: PointSchema
    paused: bool
    rider: RideRiderSchema
    driver: RideDriverSchema | None
    accepted_price: Decimal | None
    accepted_eta_min: int | None
    created_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None

    @classmethod
    def from_detail(cls, detail: RideDetail) -> RideResponse:
        ride = detail.ride
        if detail.rider is None:
            raise ValueError("RideDetail requiere el pasajero para responder por API.")
        r = detail.rider
        rider_schema = RideRiderSchema(
            id=r.id,
            full_name=r.full_name,
            phone=r.phone,
            rating=r.rating,
        )
        driver_schema = None
        if detail.driver is not None:
            d = detail.driver
            driver_schema = RideDriverSchema(
                id=d.id,
                full_name=d.full_name,
                phone=d.phone,
                rating=d.rating,
                vehicle_type=d.vehicle_type,
                plate=d.plate,
                vehicle_model=d.vehicle_model,
            )
        offer = detail.accepted_offer
        return cls(
            id=ride.id,
            rider_id=ride.rider_id,
            status=ride.status,
            service_type=ride.service_type,
            fare=ride.fare,
            payment_method=ride.payment_method,
            origin=PointSchema.from_location(ride.origin),
            destination=PointSchema.from_location(ride.destination),
            paused=ride.paused,
            rider=rider_schema,
            driver=driver_schema,
            accepted_price=offer.price if offer else None,
            accepted_eta_min=offer.eta_min if offer else None,
            created_at=ride.created_at,
            completed_at=ride.completed_at,
            cancelled_at=ride.cancelled_at,
        )


class RecentDestinationResponse(BaseModel):
    latitude: float
    longitude: float
    name: str
    address: str
    country_code: str | None = None

    @classmethod
    def from_location(cls, location: Location) -> RecentDestinationResponse:
        return cls(
            latitude=location.latitude,
            longitude=location.longitude,
            name=location.name,
            address=location.address,
            country_code=(
                "BO" if bolivia_covers(location.latitude, location.longitude) else None
            ),
        )


class HistoryCounterpartSchema(BaseModel):
    """La otra parte del viaje en el historial (conductor o pasajero)."""

    id: uuid.UUID
    full_name: str
    rating: float | None = None
    vehicle_type: VehicleType | None = None
    vehicle_model: str | None = None
    plate: str | None = None


class RideHistoryItemResponse(BaseModel):
    """Un viaje del historial, listo para pintar la tarjeta."""

    id: uuid.UUID
    status: RideStatus
    service_type: ServiceType
    payment_method: PaymentMethod
    origin: PointSchema
    destination: PointSchema
    price: Decimal
    my_rating: int | None = None
    counterpart: HistoryCounterpartSchema | None = None
    created_at: datetime | None = None

    @classmethod
    def from_item(cls, item: RideHistoryItem) -> RideHistoryItemResponse:
        ride = item.ride
        cp = item.counterpart
        return cls(
            id=ride.id,
            status=ride.status,
            service_type=ride.service_type,
            payment_method=ride.payment_method,
            origin=PointSchema.from_location(ride.origin),
            destination=PointSchema.from_location(ride.destination),
            price=item.price,
            my_rating=item.my_rating,
            counterpart=(
                HistoryCounterpartSchema(
                    id=cp.id,
                    full_name=cp.full_name,
                    rating=cp.rating,
                    vehicle_type=cp.vehicle_type,
                    vehicle_model=cp.vehicle_model,
                    plate=cp.plate,
                )
                if cp
                else None
            ),
            created_at=ride.completed_at or ride.cancelled_at or ride.created_at,
        )
