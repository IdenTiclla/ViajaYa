"""Tests of the "golden rule": atomic dispatch when accepting an offer.

The passenger has the final say: accepting a ``PENDING`` offer assigns
the ride to the driver in an atomic transaction. The driver's other live offers
on **other** rides are withdrawn, and if the ride was already assigned (race)
the dispatch returns ``None`` → 409.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.application.dto import CreateOfferInput
from app.domain.entities import (
    Location,
    OfferStatus,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.ride_policy import OFFER_TTL
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
    accept_offer_use_case,
    create_offer_use_case,
)

_LOC = Location(-16.5, -68.13, "Casa", "Calle 1")
_DEST = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _passenger() -> User:
    return User(full_name="Pasa", email=f"p-{uuid.uuid4().hex[:6]}@x.com", role=UserRole.PASSENGER)


def _driver() -> User:
    return User(
        full_name="Condu",
        email=f"d-{uuid.uuid4().hex[:6]}@x.com",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        is_online=True,
    )


def _ride(rider_id: uuid.UUID) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=_LOC,
        destination=_DEST,
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
    )


def _wire() -> tuple:
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    return rides, users, offers


async def test_accept_withdraws_drivers_other_offers():
    """The driver offers to two passengers; when one wins, their offer to the other is withdrawn."""
    rides, users, offers = _wire()
    rider_a, rider_b, driver = _passenger(), _passenger(), _driver()
    await users.add(driver)
    ride_a = await rides.add(_ride(rider_a.id))
    ride_b = await rides.add(_ride(rider_b.id))

    offer_a = await create_offer_use_case(rides, offers).execute(
        driver, ride_a.id, CreateOfferInput(accept_at_fare=True)
    )
    offer_b = await create_offer_use_case(rides, offers).execute(
        driver, ride_b.id, CreateOfferInput(accept_at_fare=True)
    )

    # Passenger A accepts: the driver is assigned to them.
    result = await accept_offer_use_case(rides, offers).execute(
        rider_a,
        offer_a.detail.offer.id,
    )

    assert result.detail.ride.driver_id == driver.id
    # The driver's offer to passenger B was withdrawn and B shows up in the list.
    assert ride_b.id in result.withdrawn_ride_ids
    assert [(item.ride_id, item.offer_id) for item in result.withdrawn_offers] == [
        (ride_b.id, offer_b.detail.offer.id)
    ]
    assert (await offers.get_by_id(offer_b.detail.offer.id)).status is OfferStatus.REJECTED


async def test_accept_returns_none_when_ride_already_assigned():
    """Race: the ride was already assigned by an earlier accept; the second one aborts."""
    rides, users, offers = _wire()
    rider, d1, d2 = _passenger(), _driver(), _driver()
    await users.add(d1)
    await users.add(d2)
    ride = await rides.add(_ride(rider.id))

    o1 = await create_offer_use_case(rides, offers).execute(
        d1, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    o2 = await create_offer_use_case(rides, offers).execute(
        d2, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    # The first accept assigns the ride (and rejects o2 in the same transaction).
    await accept_offer_use_case(rides, offers).execute(rider, o1.detail.offer.id)

    # We reopen o2 as PENDING to simulate the window before the atomic check:
    # the ride is already ACCEPTED → accept_atomically returns None.
    (await offers.get_by_id(o2.detail.offer.id)).status = OfferStatus.PENDING

    acceptance = await offers.accept_atomically(o2.detail.offer.id)
    assert acceptance is None


async def test_accept_revalidates_paused_ride_atomically():
    rides, users, offers = _wire()
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    created = await create_offer_use_case(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    ride.paused = True

    acceptance = await offers.accept_atomically(created.detail.offer.id)

    assert acceptance is None
    assert (await offers.get_by_id(created.detail.offer.id)).status is OfferStatus.PENDING


async def test_accept_revalidates_driver_online_atomically():
    rides, users, offers = _wire()
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    created = await create_offer_use_case(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    await users.set_online(driver.id, False)
    acceptance = await offers.accept_atomically(created.detail.offer.id)

    assert acceptance is None
    assert (await offers.get_by_id(created.detail.offer.id)).status is OfferStatus.PENDING
    assert ride.status is RideStatus.SEARCHING
    assert ride.driver_id is None


async def test_accept_revalidates_offer_ttl_atomically():
    rides, users, offers = _wire()
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    created = await create_offer_use_case(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    offer = await offers.get_by_id(created.detail.offer.id)
    offer.created_at = datetime.now(UTC) - OFFER_TTL - timedelta(seconds=1)

    acceptance = await offers.accept_atomically(offer.id)

    assert acceptance is None
    assert (await offers.get_by_id(offer.id)).status is OfferStatus.EXPIRED


async def test_reject_if_pending_cannot_reject_accepted_offer():
    rides, users, offers = _wire()
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    created = await create_offer_use_case(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    await offers.accept_atomically(created.detail.offer.id)

    rejected = await offers.reject_if_pending(created.detail.offer.id)

    assert rejected is None
    assert (await offers.get_by_id(created.detail.offer.id)).status is OfferStatus.ACCEPTED
