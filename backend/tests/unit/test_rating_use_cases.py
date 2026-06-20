"""Tests unitarios de los casos de uso de cierre del viaje."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.application.use_cases.get_driver_earnings import GetDriverEarnings
from app.application.use_cases.list_ride_history import ListRideHistory
from app.application.use_cases.rate_ride import RateRide
from app.domain.entities import (
    Location,
    Offer,
    OfferStatus,
    PaymentMethod,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
    UserRole,
)
from app.domain.exceptions import (
    AlreadyRatedError,
    InvalidRatingError,
    NotAuthorizedActionError,
    RideNotCompletedError,
)
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRatingRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
)


def _loc(name: str = "Centro") -> Location:
    return Location(latitude=-17.4, longitude=-66.1, name=name, address=f"{name} 123")


def _passenger() -> User:
    return User(full_name="Pasa Jero", email="p@x.com", role=UserRole.PASSENGER)


def _driver() -> User:
    return User(
        full_name="Con Ductor",
        email="d@x.com",
        role=UserRole.DRIVER,
        vehicle_type=ServiceType.TAXI,
        rating=None,
    )


def _ride(rider_id, driver_id=None, status=RideStatus.COMPLETED) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=_loc("Origen"),
        destination=_loc("Destino"),
        service_type=ServiceType.TAXI,
        fare=Decimal("20"),
        payment_method=PaymentMethod.CASH,
        status=status,
        driver_id=driver_id,
    )


async def _setup_completed():
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository()
    users = InMemoryUserRepository()
    ratings = InMemoryRatingRepository()
    rider, driver = _passenger(), _driver()
    await users.add(rider)
    await users.add(driver)
    ride = _ride(rider.id, driver.id)
    await rides.add(ride)
    return rides, offers, users, ratings, rider, driver, ride


async def test_passenger_rates_driver_and_recomputes_rating():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    use_case = RateRide(rides, ratings, users)

    saved = await use_case.execute(rider, ride.id, 4, "Buen viaje")

    assert saved.ratee_id == driver.id
    assert saved.score == 4
    refreshed = await users.get_by_id(driver.id)
    assert refreshed.rating == 4.0


async def test_driver_rates_passenger_does_not_touch_driver_rating():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    use_case = RateRide(rides, ratings, users)

    saved = await use_case.execute(driver, ride.id, 5, None)

    assert saved.ratee_id == rider.id
    # El pasajero no tiene rating recalculado (no es conductor).
    assert (await users.get_by_id(rider.id)).rating is None


async def test_cannot_rate_uncompleted_ride():
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    ratings = InMemoryRatingRepository()
    rider, driver = _passenger(), _driver()
    await users.add(rider)
    await users.add(driver)
    ride = _ride(rider.id, driver.id, status=RideStatus.IN_PROGRESS)
    await rides.add(ride)

    with pytest.raises(RideNotCompletedError):
        await RateRide(rides, ratings, users).execute(rider, ride.id, 5)


async def test_cannot_rate_twice():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    use_case = RateRide(rides, ratings, users)
    await use_case.execute(rider, ride.id, 4)

    with pytest.raises(AlreadyRatedError):
        await use_case.execute(rider, ride.id, 3)


async def test_foreign_user_cannot_rate():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    stranger = _passenger()
    await users.add(stranger)

    with pytest.raises(NotAuthorizedActionError):
        await RateRide(rides, ratings, users).execute(stranger, ride.id, 5)


async def test_invalid_score_rejected():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()

    with pytest.raises(InvalidRatingError):
        await RateRide(rides, ratings, users).execute(rider, ride.id, 6)


async def test_driver_earnings_aggregates_completed():
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository()
    users = InMemoryUserRepository()
    rider, driver = _passenger(), _driver()
    await users.add(rider)
    await users.add(driver)

    # Dos viajes completados: uno al fare, otro con oferta aceptada de 30.
    r1 = _ride(rider.id, driver.id)
    await rides.add(r1)
    r2 = _ride(rider.id, driver.id)
    offer = Offer(
        ride_id=r2.id, driver_id=driver.id, price=Decimal("30"), status=OfferStatus.ACCEPTED
    )
    await offers.add(offer)
    r2.accepted_offer_id = offer.id
    await rides.add(r2)
    # Un viaje cancelado no cuenta.
    await rides.add(_ride(rider.id, driver.id, status=RideStatus.CANCELLED))

    earnings = await GetDriverEarnings(rides, offers).execute(driver)

    assert earnings.trips_all_time == 2
    assert earnings.total_all_time == Decimal("50")  # 20 (fare) + 30 (oferta)


async def test_history_lists_terminal_rides_for_passenger():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    await rides.add(_ride(rider.id, driver.id, status=RideStatus.CANCELLED))
    use_case = ListRideHistory(rides, offers, users, ratings)

    completed = await use_case.execute(rider, RideStatus.COMPLETED)
    assert len(completed) == 1
    assert completed[0].counterpart.id == driver.id

    all_terminal = await use_case.execute(rider, None)
    assert len(all_terminal) == 2
