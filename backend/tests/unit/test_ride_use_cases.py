"""Tests unitarios de los casos de uso de viajes con dobles en memoria."""

from __future__ import annotations

from dataclasses import replace
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
    VehicleType,
)
from app.domain.exceptions import (
    InvalidFareError,
    InvalidLocationError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideAlreadyActiveError,
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


def _rider(email: str = "rider@viajaya.com") -> User:
    return User(full_name="Pasajero", email=email)


async def test_create_ride_request_persists_searching():
    repo = InMemoryRideRequestRepository()
    rider = _rider()

    ride = await CreateRideRequest(repo).execute(rider, _input())

    assert ride.rider_id == rider.id
    assert ride.status is RideStatus.SEARCHING
    assert ride.service_type is ServiceType.TAXI
    assert ride.payment_method is PaymentMethod.CASH
    assert ride.fare == Decimal("25.00")
    assert ride.destination.name == "Trabajo"
    assert len(repo.rides) == 1


async def test_create_ride_request_keeps_chosen_payment_method():
    repo = InMemoryRideRequestRepository()

    ride = await CreateRideRequest(repo).execute(
        _rider(), _input(payment_method=PaymentMethod.QR)
    )

    assert ride.payment_method is PaymentMethod.QR


async def test_create_ride_request_rejects_invalid_coordinates():
    repo = InMemoryRideRequestRepository()
    with pytest.raises(InvalidLocationError):
        await CreateRideRequest(repo).execute(
            _rider(), _input(destination=LocationInput(200.0, -68.0, "X", "Y"))
        )


@pytest.mark.parametrize("country_code", [None, "BO"])
async def test_create_ride_request_rejects_destination_outside_bolivia(
    country_code: str | None,
):
    repo = InMemoryRideRequestRepository()

    with pytest.raises(InvalidLocationError, match="Bolivia"):
        await CreateRideRequest(repo).execute(
            _rider(),
            _input(
                destination=LocationInput(
                    -19.008,
                    -57.652,
                    "Corumba",
                    "Brasil",
                    country_code,
                )
            ),
        )

    assert repo.rides == []


async def test_create_ride_request_rejects_non_positive_fare():
    repo = InMemoryRideRequestRepository()
    with pytest.raises(InvalidFareError):
        await CreateRideRequest(repo).execute(_rider(), _input(fare=Decimal("0")))


async def test_create_ride_request_rejects_second_active_ride():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    await CreateRideRequest(repo).execute(rider, _input())

    with pytest.raises(RideAlreadyActiveError):
        await CreateRideRequest(repo).execute(rider, _input(fare=Decimal("30.00")))


async def test_create_ride_request_allows_new_ride_after_terminal_state():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    first = await CreateRideRequest(repo).execute(rider, _input())

    cancelled = await repo.cancel_if_searching(first.id)
    second = await CreateRideRequest(repo).execute(rider, _input(fare=Decimal("30.00")))

    assert cancelled is not None
    assert cancelled.cancelled_at is not None
    assert second.id != first.id


async def test_create_ride_request_rejects_driver_role():
    repo = InMemoryRideRequestRepository()
    driver = _driver()

    with pytest.raises(NotAuthorizedActionError):
        await CreateRideRequest(repo).execute(driver, _input())


async def test_update_if_state_does_not_overwrite_newer_status():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input())
    candidate = replace(ride, status=RideStatus.CANCELLED)
    ride.status = RideStatus.IN_PROGRESS

    updated = await repo.update_if_state(candidate, RideStatus.SEARCHING)

    assert updated is None
    assert (await repo.get_by_id(ride.id)).status is RideStatus.IN_PROGRESS


async def test_update_if_state_compares_fare_when_status_is_unchanged():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input())
    candidate = replace(ride, fare=Decimal("30.00"))
    ride.fare = Decimal("28.00")

    updated = await repo.update_if_state(
        candidate,
        RideStatus.SEARCHING,
        expected_fare=Decimal("25.00"),
    )

    assert updated is None
    assert (await repo.get_by_id(ride.id)).fare == Decimal("28.00")


async def test_cancel_if_searching_ignores_paused_ride():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input())
    ride.paused = True

    assert await repo.cancel_if_searching(ride.id) is None
    assert (await repo.get_by_id(ride.id)).status is RideStatus.SEARCHING


async def test_recent_destinations_dedupes_and_orders():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    create = CreateRideRequest(repo)

    first = await create.execute(
        rider, _input(destination=LocationInput(-16.49, -68.14, "A", "dir A"))
    )
    first.status = RideStatus.CANCELLED
    await repo.update(first)
    second = await create.execute(
        rider, _input(destination=LocationInput(-16.40, -68.20, "B", "dir B"))
    )
    second.status = RideStatus.CANCELLED
    await repo.update(second)
    # Repite A: no debe duplicarse, pero pasa al frente por ser el más reciente.
    await create.execute(
        rider, _input(destination=LocationInput(-16.49, -68.14, "A", "dir A"))
    )

    destinations = await ListRecentDestinations(repo).execute(rider.id)

    assert [d.name for d in destinations] == ["A", "B"]


async def test_recent_destinations_isolated_per_rider():
    repo = InMemoryRideRequestRepository()
    rider_a, rider_b = _rider("a@viajaya.com"), _rider("b@viajaya.com")
    await CreateRideRequest(repo).execute(rider_a, _input())

    assert await ListRecentDestinations(repo).execute(rider_b.id) == []


async def test_update_ride_fare_adjusts_offer():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input(fare=Decimal("25.00")))

    updated = await UpdateRideFare(repo).execute(rider, ride.id, Decimal("30.00"))

    assert updated.fare == Decimal("30.00")
    assert updated.status is RideStatus.SEARCHING
    assert updated.pool_version == 2


async def test_update_ride_fare_allows_lower_offer():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input(fare=Decimal("25.00")))

    updated = await UpdateRideFare(repo).execute(rider, ride.id, Decimal("20.00"))

    assert updated.fare == Decimal("20.00")


async def test_update_ride_fare_rejects_unchanged_offer():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input(fare=Decimal("25.00")))

    with pytest.raises(InvalidFareError, match="diferente"):
        await UpdateRideFare(repo).execute(rider, ride.id, Decimal("25.00"))


async def test_update_ride_fare_rejects_non_owner():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input())
    stranger = _rider()

    with pytest.raises(NotAuthorizedActionError):
        await UpdateRideFare(repo).execute(stranger, ride.id, Decimal("99.00"))


async def test_update_ride_fare_rejects_when_not_searching():
    repo = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(repo).execute(rider, _input())
    ride.status = RideStatus.ACCEPTED
    await repo.update(ride)

    with pytest.raises(InvalidRideTransitionError):
        await UpdateRideFare(repo).execute(rider, ride.id, Decimal("99.00"))


def _driver() -> User:
    return User(
        full_name="Condu",
        email="condu@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        is_online=True,
    )


async def test_pause_ride_hides_from_pool_and_kills_offers():
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _rider(), _driver()
    await users.add(driver)
    ride = await CreateRideRequest(rides).execute(rider, _input())
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
    assert await rides.list_open_for_vehicle(VehicleType.TAXI) == []


async def test_pause_ride_does_not_overwrite_concurrent_fare_increase():
    class FareChangesBeforePause(InMemoryOfferRepository):
        async def pause_ride_atomically(self, ride_id, *, expected_fare):
            current = await rides.get_by_id(ride_id)
            assert current is not None
            current.fare = Decimal("30.00")
            return await super().pause_ride_atomically(
                ride_id,
                expected_fare=expected_fare,
            )

    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = FareChangesBeforePause(rides=rides, users=users)
    rider, driver = _rider(), _driver()
    await users.add(driver)
    ride = await CreateRideRequest(rides).execute(rider, _input(fare=Decimal("25.00")))
    offer = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    with pytest.raises(InvalidRideTransitionError):
        await PauseRideForEdit(rides, offers).execute(rider, ride.id)

    current = await rides.get_by_id(ride.id)
    assert current is not None
    assert current.fare == Decimal("30.00")
    assert current.paused is False
    assert (await offers.get_by_id(offer.detail.offer.id)).status is OfferStatus.PENDING


async def test_pause_ride_rejects_when_not_searching():
    rides = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(rides).execute(rider, _input())
    ride.status = RideStatus.ACCEPTED
    await rides.update(ride)

    with pytest.raises(InvalidRideTransitionError):
        await PauseRideForEdit(rides, InMemoryOfferRepository()).execute(rider, ride.id)


async def test_edit_ride_updates_fields_and_unpauses():
    rides = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(rides).execute(rider, _input(fare=Decimal("25.00")))
    await PauseRideForEdit(rides, InMemoryOfferRepository(rides=rides)).execute(
        rider, ride.id
    )

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
    assert updated.pool_version == 2
    # Y vuelve a aparecer en el pool.
    open_rides = await rides.list_open_for_vehicle(VehicleType.TAXI)
    assert [r.id for r in open_rides] == [ride.id]


async def test_edit_ride_requires_paused():
    rides = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(rides).execute(rider, _input())

    with pytest.raises(InvalidRideTransitionError):
        await EditRide(rides).execute(rider, ride.id, _input(fare=Decimal("40.00")))


async def test_edit_ride_rejects_destination_outside_bolivia_without_mutating_ride():
    rides = InMemoryRideRequestRepository()
    rider = _rider()
    ride = await CreateRideRequest(rides).execute(rider, _input())
    await PauseRideForEdit(rides, InMemoryOfferRepository(rides=rides)).execute(
        rider, ride.id
    )

    with pytest.raises(InvalidLocationError, match="Bolivia"):
        await EditRide(rides).execute(
            rider,
            ride.id,
            _input(
                destination=LocationInput(
                    -22.104,
                    -65.596,
                    "La Quiaca",
                    "Argentina",
                    "BO",
                )
            ),
        )

    stored = await rides.get_by_id(ride.id)
    assert stored is not None
    assert stored.paused is True
    assert stored.destination.name == "Trabajo"
