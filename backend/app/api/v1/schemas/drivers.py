"""Schemas Pydantic para conductores (`/drivers`)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.api.v1.schemas.auth import UserResponse
from app.application.dto import DriverEarnings, DriverVehicleInput, DriverVehicleRegistration
from app.domain.entities import DriverStatus, DriverVehicle, ServiceType, UserRole, VehicleType


class OnlineRequest(BaseModel):
    """Body to toggle the driver's availability."""

    is_online: bool


class DriverVehicleRequest(BaseModel):
    """One vehicle (at most one per type) and the services served with it."""

    vehicle_type: VehicleType
    plate: str = Field(min_length=3, max_length=20)
    vehicle_model: str = Field(min_length=2, max_length=120)
    services: list[ServiceType] = Field(min_length=1, max_length=4)

    def to_input(self) -> DriverVehicleInput:
        return DriverVehicleInput(
            vehicle_type=self.vehicle_type,
            plate=self.plate,
            vehicle_model=self.vehicle_model,
            services=tuple(self.services),
        )


class DriverVehicleResponse(BaseModel):
    id: uuid.UUID
    vehicle_type: VehicleType
    plate: str
    vehicle_model: str
    services: list[ServiceType]
    status: DriverStatus
    created_at: datetime | None

    @classmethod
    def from_entity(cls, vehicle: DriverVehicle) -> DriverVehicleResponse:
        return cls(
            id=vehicle.id,
            vehicle_type=vehicle.vehicle_type,
            plate=vehicle.plate,
            vehicle_model=vehicle.vehicle_model,
            services=list(vehicle.services),
            status=vehicle.status,
            created_at=vehicle.created_at,
        )


class DriverVehicleRegistrationResponse(BaseModel):
    """The registered vehicle plus the account (aggregate status, active vehicle)."""

    user: UserResponse
    vehicle: DriverVehicleResponse

    @classmethod
    def from_dto(cls, result: DriverVehicleRegistration) -> DriverVehicleRegistrationResponse:
        return cls(
            user=UserResponse.from_entity(result.user),
            vehicle=DriverVehicleResponse.from_entity(result.vehicle),
        )


class AccountModeRequest(BaseModel):
    """Active mode of the account; ``vehicle_type`` picks the vehicle to drive with."""

    mode: UserRole
    vehicle_type: VehicleType | None = None


class EarningsItemResponse(BaseModel):
    """One line of the earnings breakdown."""

    ride_id: uuid.UUID
    destination_name: str
    price: Decimal
    completed_at: datetime | None


class DriverEarningsResponse(BaseModel):
    """The driver's earnings summary (today, all-time and recent)."""

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
