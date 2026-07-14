"""Tests unitarios de los casos de uso de cierre del viaje."""

from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from app.application.use_cases.get_driver_earnings import GetDriverEarnings
from app.application.use_cases.get_pending_rating_ride import GetPendingRatingRide
from app.application.use_cases.list_ride_history import ListRideHistory
from app.application.use_cases.rate_ride import RateRide
from app.application.use_cases.skip_ride_rating import SkipRideRating
from app.domain.entities import (
    Location,
    Offer,
    OfferStatus,
    PaymentMethod,
    RideRating,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.exceptions import (
    AlreadyRatedError,
    InvalidRatingError,
    NotAuthorizedActionError,
    RideNotCompletedError,
)
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryPendingRatingRepository,
    InMemoryRatingRepository,
    InMemoryRatingSkipRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
)


class _BarrierRatingRepository(InMemoryRatingRepository):
    """Hace que dos altas alcancen juntas el límite transaccional del puerto."""

    def __init__(self, users: InMemoryUserRepository) -> None:
        super().__init__(users)
        self._arrived = 0
        self._both_arrived = asyncio.Event()

    async def add_and_recompute(self, rating: RideRating) -> RideRating | None:
        self._arrived += 1
        if self._arrived == 2:
            self._both_arrived.set()
        await self._both_arrived.wait()
        return await super().add_and_recompute(rating)


def _loc(name: str = "Centro") -> Location:
    return Location(latitude=-17.4, longitude=-66.1, name=name, address=f"{name} 123")


def _passenger() -> User:
    return User(full_name="Pasa Jero", email="p@x.com", role=UserRole.PASSENGER)


def _driver() -> User:
    return User(
        full_name="Con Ductor",
        email="d@x.com",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
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
    ratings = InMemoryRatingRepository(users)
    rider, driver = _passenger(), _driver()
    await users.add(rider)
    await users.add(driver)
    ride = _ride(rider.id, driver.id)
    await rides.add(ride)
    return rides, offers, users, ratings, rider, driver, ride


async def test_passenger_rates_driver_and_recomputes_rating():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    driver.is_online = True
    use_case = RateRide(rides, ratings)

    saved = await use_case.execute(rider, ride.id, 4, "Buen viaje")

    assert saved.ratee_id == driver.id
    assert saved.score == 4
    refreshed = await users.get_by_id(driver.id)
    assert refreshed.rating == 4.0
    assert refreshed.is_online is True


async def test_driver_rates_passenger_and_recomputes_rating():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    use_case = RateRide(rides, ratings)

    saved = await use_case.execute(driver, ride.id, 5, None)

    assert saved.ratee_id == rider.id
    assert (await users.get_by_id(rider.id)).rating == 5.0


async def test_pending_rating_is_independent_for_each_participant():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    pending = InMemoryPendingRatingRepository(rides, ratings)
    use_case = GetPendingRatingRide(pending, offers, users)

    assert (await use_case.execute(rider)).ride.id == ride.id
    assert (await use_case.execute(driver)).ride.id == ride.id

    await RateRide(rides, ratings).execute(rider, ride.id, 5)

    assert await use_case.execute(rider) is None
    assert (await use_case.execute(driver)).ride.id == ride.id


async def test_skip_rating_is_idempotent_and_independent_by_participant():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    skips = InMemoryRatingSkipRepository()
    pending = GetPendingRatingRide(
        InMemoryPendingRatingRepository(rides, ratings, skips),
        offers,
        users,
    )
    use_case = SkipRideRating(rides, skips)

    first = await use_case.execute(rider, ride.id)
    repeated = await use_case.execute(rider, ride.id)
    assert repeated.id == first.id
    assert await pending.execute(rider) is None
    assert (await pending.execute(driver)).ride.id == ride.id

    await use_case.execute(driver, ride.id)
    assert await pending.execute(driver) is None
    assert (await users.get_by_id(rider.id)).rating is None
    assert (await users.get_by_id(driver.id)).rating is None
    assert await ratings.average_for(rider.id) is None
    assert await ratings.average_for(driver.id) is None


async def test_skip_rating_rejects_uncompleted_and_foreign_user():
    rides = InMemoryRideRequestRepository()
    skips = InMemoryRatingSkipRepository()
    rider, driver = _passenger(), _driver()
    in_progress = _ride(rider.id, driver.id, status=RideStatus.IN_PROGRESS)
    await rides.add(in_progress)

    with pytest.raises(RideNotCompletedError):
        await SkipRideRating(rides, skips).execute(rider, in_progress.id)

    completed = _ride(rider.id, driver.id)
    await rides.add(completed)
    stranger = _passenger()
    with pytest.raises(NotAuthorizedActionError):
        await SkipRideRating(rides, skips).execute(stranger, completed.id)


async def test_cannot_rate_uncompleted_ride():
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    ratings = InMemoryRatingRepository(users)
    rider, driver = _passenger(), _driver()
    await users.add(rider)
    await users.add(driver)
    ride = _ride(rider.id, driver.id, status=RideStatus.IN_PROGRESS)
    await rides.add(ride)

    with pytest.raises(RideNotCompletedError):
        await RateRide(rides, ratings).execute(rider, ride.id, 5)


async def test_cannot_rate_twice():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    use_case = RateRide(rides, ratings)
    await use_case.execute(rider, ride.id, 4)

    with pytest.raises(AlreadyRatedError):
        await use_case.execute(rider, ride.id, 3)


async def test_concurrent_duplicate_saves_once_and_maps_loser_to_already_rated():
    rides, offers, users, _, rider, driver, ride = await _setup_completed()
    ratings = _BarrierRatingRepository(users)
    use_case = RateRide(rides, ratings)

    results = await asyncio.gather(
        use_case.execute(rider, ride.id, 4),
        use_case.execute(rider, ride.id, 4),
        return_exceptions=True,
    )

    assert sum(isinstance(result, RideRating) for result in results) == 1
    assert sum(isinstance(result, AlreadyRatedError) for result in results) == 1
    assert len(await ratings.list_by_ratee(driver.id)) == 1
    assert (await users.get_by_id(driver.id)).rating == 4.0


async def test_concurrent_ratings_for_same_ratee_recompute_complete_average():
    rides, offers, users, _, rider, driver, ride = await _setup_completed()
    second_rider = _passenger()
    second_ride = _ride(second_rider.id, driver.id)
    await users.add(second_rider)
    await rides.add(second_ride)
    ratings = _BarrierRatingRepository(users)
    use_case = RateRide(rides, ratings)

    results = await asyncio.gather(
        use_case.execute(rider, ride.id, 5),
        use_case.execute(second_rider, second_ride.id, 3),
    )

    assert all(isinstance(result, RideRating) for result in results)
    assert len(await ratings.list_by_ratee(driver.id)) == 2
    assert (await users.get_by_id(driver.id)).rating == 4.0


async def test_foreign_user_cannot_rate():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()
    stranger = _passenger()
    await users.add(stranger)

    with pytest.raises(NotAuthorizedActionError):
        await RateRide(rides, ratings).execute(stranger, ride.id, 5)


async def test_invalid_score_rejected():
    rides, offers, users, ratings, rider, driver, ride = await _setup_completed()

    with pytest.raises(InvalidRatingError):
        await RateRide(rides, ratings).execute(rider, ride.id, 6)


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
