"""Contrato entre tipos fisicos de vehiculo y servicios solicitables."""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.api.v1.schemas.offers import OfferDriverSchema
from app.domain.entities import (
    ServiceType,
    VehicleType,
    services_for_vehicle,
    vehicle_can_serve,
)
from app.infrastructure.db.models import RideRequestModel, UserModel


def test_delivery_is_a_service_but_never_a_vehicle_type() -> None:
    assert ServiceType("delivery") is ServiceType.DELIVERY
    with pytest.raises(ValueError):
        VehicleType("delivery")


def test_api_rejects_delivery_as_driver_vehicle() -> None:
    with pytest.raises(ValidationError):
        OfferDriverSchema(
            id=uuid.uuid4(),
            full_name="Conductor",
            rating=None,
            vehicle_type="delivery",
            plate=None,
            vehicle_model=None,
        )


def test_orm_keeps_distinct_varchar_enums_without_delivery_vehicle() -> None:
    vehicle_enum = UserModel.__table__.c.vehicle_type.type
    service_enum = RideRequestModel.__table__.c.service_type.type

    assert vehicle_enum.native_enum is False
    assert vehicle_enum.enums == ["taxi", "moto"]
    assert service_enum.native_enum is False
    assert service_enum.enums == ["taxi", "moto", "delivery"]


@pytest.mark.parametrize("vehicle", [VehicleType.TAXI, VehicleType.MOTO])
def test_every_vehicle_can_serve_delivery(vehicle: VehicleType) -> None:
    assert vehicle_can_serve(ServiceType.DELIVERY, vehicle)
    assert services_for_vehicle(vehicle) == (
        ServiceType(vehicle.value),
        ServiceType.DELIVERY,
    )


def test_passenger_transport_requires_matching_physical_vehicle() -> None:
    assert vehicle_can_serve(ServiceType.TAXI, VehicleType.TAXI)
    assert vehicle_can_serve(ServiceType.MOTO, VehicleType.MOTO)
    assert not vehicle_can_serve(ServiceType.TAXI, VehicleType.MOTO)
    assert not vehicle_can_serve(ServiceType.MOTO, VehicleType.TAXI)
