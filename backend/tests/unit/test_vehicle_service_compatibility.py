"""Contrato entre tipos fisicos de vehiculo y servicios solicitables."""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.api.v1.schemas.offers import OfferDriverSchema
from app.domain.entities import (
    ServiceType,
    User,
    UserRole,
    VehicleType,
    driver_can_serve,
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
    assert vehicle_enum.enums == ["taxi", "moto", "truck"]
    assert service_enum.native_enum is False
    assert service_enum.enums == ["taxi", "moto", "delivery", "moving"]


@pytest.mark.parametrize("vehicle", [VehicleType.TAXI, VehicleType.MOTO])
def test_taxi_and_moto_may_offer_delivery(vehicle: VehicleType) -> None:
    assert vehicle_can_serve(ServiceType.DELIVERY, vehicle)
    assert services_for_vehicle(vehicle) == (
        ServiceType(vehicle.value),
        ServiceType.DELIVERY,
    )


def test_truck_only_moves() -> None:
    assert services_for_vehicle(VehicleType.TRUCK) == (ServiceType.MOVING,)
    assert not vehicle_can_serve(ServiceType.DELIVERY, VehicleType.TRUCK)
    assert not vehicle_can_serve(ServiceType.MOVING, VehicleType.TAXI)


def test_driver_serves_only_the_services_they_chose() -> None:
    taxi_only = User(
        full_name="Taxi",
        email=None,
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        driver_services=(ServiceType.TAXI,),
    )
    assert taxi_only.offered_services == (ServiceType.TAXI,)
    assert driver_can_serve(taxi_only, ServiceType.TAXI)
    assert not driver_can_serve(taxi_only, ServiceType.DELIVERY)

    # Drivers registered before per-driver services keep every vehicle service.
    legacy = User(
        full_name="Legacy", email=None, role=UserRole.DRIVER, vehicle_type=VehicleType.MOTO
    )
    assert legacy.offered_services == (ServiceType.MOTO, ServiceType.DELIVERY)

    # Choices outside the vehicle are ignored rather than granted.
    odd = User(
        full_name="Odd",
        email=None,
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TRUCK,
        driver_services=(ServiceType.TAXI, ServiceType.MOVING),
    )
    assert odd.offered_services == (ServiceType.MOVING,)


def test_passenger_transport_requires_matching_physical_vehicle() -> None:
    assert vehicle_can_serve(ServiceType.TAXI, VehicleType.TAXI)
    assert vehicle_can_serve(ServiceType.MOTO, VehicleType.MOTO)
    assert not vehicle_can_serve(ServiceType.TAXI, VehicleType.MOTO)
    assert not vehicle_can_serve(ServiceType.MOTO, VehicleType.TAXI)
