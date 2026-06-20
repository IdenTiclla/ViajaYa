"""Tests unitarios de los casos de uso de viajes con dobles en memoria."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.application.dto import CreateOfferInput, CreateRideRequestInput, LocationInput
from app.application.use_cases.create_offer import CreateOffer
from app.application.use_cases.create_ride_request import CreateRideRequest
from app.application.use_cases.edit_ride import EditRide
from app.application.use_cases.list_recent_destinations import ListRecentDestinations
from app.application.use_cases.pause_ride_for_edit import PauseRideForEdit
from app.application.use_cases.update_ride_fare import UpdateRideFare
from app.domain.entities import (
    OfferStatus,
    PaymentMethod,
    RideStatus,
    ServiceType,
    User,
    UserRole,
)
from app.domain.exceptions import (
    InvalidFareError,
    InvalidLocationError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
)
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
)


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
    assert ride.payment_method is PaymentMethod.CASH
    assert ride.fare == Decimal("25.00")
    assert ride.destination.name == "Trabajo"
    assert len(repo.rides) == 1


async def test_create_ride_request_keeps_chosen_payment_method():
    repo = InMemoryRideRequestRepository()

    ride = await CreateRideRequest(repo).execute(
        uuid.uuid4(), _input(payment_method=PaymentMethod.QR)
    )

    assert ride.payment_method is PaymentMethod.QR


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


def _rider() -> User:
    return User(full_name="Pasajero", email="rider@viajaya.com")


async def test_update_ride_fare_raises_offer():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider.id, _input(fare=Decimal("25.00")))

    updated = await UpdateRideFare(repo).execute(rider, ride.id, Decimal("30.00"))

    assert updated.fare == Decimal("30.00")
    assert updated.status is RideStatus.SEARCHING


async def test_update_ride_fare_rejects_non_increase():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider.id, _input(fare=Decimal("25.00")))

    with pytest.raises(InvalidFareError):
        await UpdateRideFare(repo).execute(rider, ride.id, Decimal("25.00"))


async def test_update_ride_fare_rejects_non_owner():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider.id, _input())
    stranger = _rider()

    with pytest.raises(NotAuthorizedActionError):
        await UpdateRideFare(repo).execute(stranger, ride.id, Decimal("99.00"))


async def test_update_ride_fare_rejects_when_not_searching():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider.id, _input())
    ride.status = RideStatus.ACCEPTED
    await repo.update(ride)

    with pytest.raises(InvalidRideTransitionError):
        await UpdateRideFare(repo).execute(rider, ride.id, Decimal("99.00"))


def _driver() -> User:
    return User(
        full_name="Condu",
        email="condu@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=ServiceType.TAXI,
    )


async def test_pause_ride_hides_from_pool_and_kills_offers():
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _rider(), _driver()
    await users.add(driver)
    ride = await CreateRideRequest(rides).execute(rider.id, _input())
    offer = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    result = await PauseRideForEdit(rides, offers).execute(rider, ride.id)

    assert result.ride.paused is True
    assert result.ride.status is RideStatus.SEARCHING
    # La oferta viva se retiró.
    assert (await offers.get_by_id(offer.detail.offer.id)).status is OfferStatus.REJECTED
    assert len(result.paused_offers) == 1
    # Y la solicitud ya no aparece en el pool.
    assert await rides.list_open_for_service(ServiceType.TAXI) == []


async def test_pause_ride_rejects_when_not_searching():
    rides = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(rides).execute(rider.id, _input())
    ride.status = RideStatus.ACCEPTED
    await rides.update(ride)

    with pytest.raises(InvalidRideTransitionError):
        await PauseRideForEdit(rides, InMemoryOfferRepository()).execute(rider, ride.id)


async def test_edit_ride_updates_fields_and_unpauses():
    rides = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(rides).execute(rider.id, _input(fare=Decimal("25.00")))
    await PauseRideForEdit(rides, InMemoryOfferRepository()).execute(rider, ride.id)

    updated = await EditRide(rides).execute(
        rider,
        ride.id,
        _input(
            destination=LocationInput(-16.40, -68.20, "Mercado", "Av. 3"),
            fare=Decimal("40.00"),
            payment_method=PaymentMethod.QR,
        ),
    )

    assert updated.paused is False
    assert updated.fare == Decimal("40.00")
    assert updated.destination.name == "Mercado"
    assert updated.payment_method is PaymentMethod.QR
    # Y vuelve a aparecer en el pool.
    open_rides = await rides.list_open_for_service(ServiceType.TAXI)
    assert [r.id for r in open_rides] == [ride.id]


async def test_edit_ride_requires_paused():
    rides = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(rides).execute(rider.id, _input())

    with pytest.raises(InvalidRideTransitionError):
        await EditRide(rides).execute(rider, ride.id, _input(fare=Decimal("40.00")))
