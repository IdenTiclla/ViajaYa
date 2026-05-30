"""Tests unitarios de los casos de uso de viajes con dobles en memoria."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.application.dto import CreateRideRequestInput, LocationInput
from app.application.use_cases.create_ride_request import CreateRideRequest
from app.application.use_cases.list_recent_destinations import ListRecentDestinations
from app.domain.entities import RideStatus, ServiceType
from app.domain.exceptions import InvalidFareError, InvalidLocationError
from tests.fakes import InMemoryRideRequestRepository


def _input(**over) -> CreateRideRequestInput:
    base = {
        "origin": LocationInput(-16.5, -68.13, "Casa", "Calle 1"),
        "destination": LocationInput(-16.49, -68.14, "Trabajo", "Av. 2"),
        "service_type": ServiceType.TAXI,
        "fare": Decimal("25.00"),
    }
    base.update(over)
    return CreateRideRequestInput(**base)


async def test_create_ride_request_persists_searching():
    repo = InMemoryRideRequestRepository()
    rider_id = uuid.uuid4()

    ride = await CreateRideRequest(repo).execute(rider_id, _input())

    assert ride.rider_id == rider_id
    assert ride.status is RideStatus.SEARCHING
    assert ride.service_type is ServiceType.TAXI
    assert ride.fare == Decimal("25.00")
    assert ride.destination.name == "Trabajo"
    assert len(repo.rides) == 1


async def test_create_ride_request_rejects_invalid_coordinates():
    repo = InMemoryRideRequestRepository()
    with pytest.raises(InvalidLocationError):
        await CreateRideRequest(repo).execute(
            uuid.uuid4(), _input(destination=LocationInput(200.0, -68.0, "X", "Y"))
        )


async def test_create_ride_request_rejects_non_positive_fare():
    repo = InMemoryRideRequestRepository()
    with pytest.raises(InvalidFareError):
        await CreateRideRequest(repo).execute(uuid.uuid4(), _input(fare=Decimal("0")))


async def test_recent_destinations_dedupes_and_orders():
    repo = InMemoryRideRequestRepository()
    rider_id = uuid.uuid4()
    create = CreateRideRequest(repo)

    await create.execute(rider_id, _input(destination=LocationInput(-16.49, -68.14, "A", "dir A")))
    await create.execute(rider_id, _input(destination=LocationInput(-16.40, -68.20, "B", "dir B")))
    # Repite A: no debe duplicarse, pero pasa al frente por ser el más reciente.
    await create.execute(rider_id, _input(destination=LocationInput(-16.49, -68.14, "A", "dir A")))

    destinations = await ListRecentDestinations(repo).execute(rider_id)

    assert [d.name for d in destinations] == ["A", "B"]


async def test_recent_destinations_isolated_per_rider():
    repo = InMemoryRideRequestRepository()
    rider_a, rider_b = uuid.uuid4(), uuid.uuid4()
    await CreateRideRequest(repo).execute(rider_a, _input())

    assert await ListRecentDestinations(repo).execute(rider_b) == []
