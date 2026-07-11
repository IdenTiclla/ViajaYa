"""Tests unitarios de los casos de uso de ofertas y ciclo de vida del viaje."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.application.dto import CreateOfferInput
from app.application.use_cases.accept_offer import AcceptOffer
from app.application.use_cases.cancel_ride import CancelRide
from app.application.use_cases.create_offer import CreateOffer
from app.application.use_cases.expire_offer import ExpireOffer
from app.application.use_cases.list_offers_for_ride import ListOffersForRide
from app.application.use_cases.list_open_rides import ListOpenRides
from app.application.use_cases.set_driver_online import SetDriverOnline
from app.application.use_cases.update_ride_status import UpdateRideStatus
from app.application.use_cases.withdraw_offer import WithdrawOffer
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
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
)
from app.domain.ride_policy import OFFER_TTL
from tests.fakes import (
    InMemoryOfferRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
)

_LOC = Location(-16.5, -68.13, "Casa", "Calle 1")
_DEST = Location(-16.49, -68.14, "Trabajo", "Av. 2")


def _passenger() -> User:
    return User(full_name="Pasa", email="pasa@x.com", role=UserRole.PASSENGER)


def _driver(vehicle: VehicleType = VehicleType.TAXI) -> User:
    return User(
        full_name="Condu",
        email=f"condu-{uuid.uuid4().hex[:6]}@x.com",
        role=UserRole.DRIVER,
        vehicle_type=vehicle,
        is_online=True,
    )


def _ride(rider_id: uuid.UUID, service: ServiceType = ServiceType.TAXI) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=_LOC,
        destination=_DEST,
        service_type=service,
        fare=Decimal("25.00"),
    )


async def test_create_offer_accept_at_fare():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    ride = await rides.add(_ride(rider.id))

    result = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True, eta_min=5)
    )

    assert result.detail.offer.price == Decimal("25.00")
    assert result.detail.offer.eta_min == 5
    assert result.detail.offer.status is OfferStatus.PENDING
    assert result.detail.driver.id == driver.id
    assert result.superseded_offer_id is None


async def test_create_offer_counteroffer_uses_own_price():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    ride = await rides.add(_ride(rider.id))

    result = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=False, price=Decimal("30.00"), eta_min=8)
    )

    assert result.detail.offer.price == Decimal("30.00")


@pytest.mark.parametrize("vehicle", [VehicleType.TAXI, VehicleType.MOTO])
async def test_taxi_and_moto_can_offer_and_be_assigned_delivery(
    vehicle: VehicleType,
):
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _passenger(), _driver(vehicle)
    await users.add(driver)
    ride = await rides.add(_ride(rider.id, service=ServiceType.DELIVERY))

    created = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    accepted = await AcceptOffer(rides, offers).execute(
        rider, created.detail.offer.id
    )

    assert accepted.detail.ride.driver_id == driver.id
    assert accepted.detail.ride.service_type is ServiceType.DELIVERY
    assert accepted.detail.accepted_offer is not None
    assert accepted.detail.accepted_offer.price == ride.fare


async def test_create_offer_supersedes_previous_pending_offer():
    """Mejorar la oferta: la nueva reemplaza a la anterior del mismo conductor."""
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    ride = await rides.add(_ride(rider.id))

    first = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=False, price=Decimal("30.00"))
    )
    improved = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=False, price=Decimal("26.00"))
    )

    assert improved.superseded_offer_id == first.detail.offer.id
    assert (await offers.get_by_id(first.detail.offer.id)).status is OfferStatus.REJECTED
    assert improved.detail.offer.price == Decimal("26.00")
    assert improved.detail.offer.status is OfferStatus.PENDING


async def test_create_offer_blocked_after_ride_assigned():
    """Tras aceptar una oferta el viaje deja de buscar: re-ofertar falla."""
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    first = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    await AcceptOffer(rides, offers).execute(rider, first.detail.offer.id)

    with pytest.raises(InvalidRideTransitionError):
        await CreateOffer(rides, offers).execute(
            driver, ride.id, CreateOfferInput(accept_at_fare=False, price=Decimal("20.00"))
        )


async def test_create_offer_rejects_mismatched_vehicle():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider = _passenger()
    moto_driver = _driver(VehicleType.MOTO)
    ride = await rides.add(_ride(rider.id, service=ServiceType.TAXI))

    with pytest.raises(NotAuthorizedActionError):
        await CreateOffer(rides, offers).execute(
            moto_driver, ride.id, CreateOfferInput(accept_at_fare=True)
        )


async def test_create_offer_rejects_non_searching_ride():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    ride = _ride(rider.id)
    ride.status = RideStatus.ACCEPTED
    await rides.add(ride)

    with pytest.raises(InvalidRideTransitionError):
        await CreateOffer(rides, offers).execute(
            driver, ride.id, CreateOfferInput(accept_at_fare=True)
        )


async def test_create_offer_rejects_offline_driver():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    driver.is_online = False
    ride = await rides.add(_ride(rider.id))

    with pytest.raises(DriverUnavailableError):
        await CreateOffer(rides, offers).execute(
            driver, ride.id, CreateOfferInput(accept_at_fare=True)
        )


async def test_create_offer_rejects_paused_ride():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    ride = _ride(rider.id)
    ride.paused = True
    await rides.add(ride)

    with pytest.raises(InvalidRideTransitionError):
        await CreateOffer(rides, offers).execute(
            driver, ride.id, CreateOfferInput(accept_at_fare=True)
        )


async def test_create_offer_rejects_busy_driver():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider_a, rider_b, driver = _passenger(), _passenger(), _driver()
    active = _ride(rider_a.id)
    active.status = RideStatus.ACCEPTED
    active.driver_id = driver.id
    await rides.add(active)
    target = await rides.add(_ride(rider_b.id))

    with pytest.raises(DriverUnavailableError):
        await CreateOffer(rides, offers).execute(
            driver, target.id, CreateOfferInput(accept_at_fare=True)
        )


async def test_accept_offer_assigns_ride_and_rejects_others():
    """Aceptar asigna el viaje y rechaza las demás ofertas vivas del mismo ride."""
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, d1, d2 = _passenger(), _driver(), _driver()
    await users.add(d1)
    await users.add(d2)
    ride = await rides.add(_ride(rider.id))

    o1 = await CreateOffer(rides, offers).execute(
        d1, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    o2 = await CreateOffer(rides, offers).execute(
        d2, ride.id, CreateOfferInput(accept_at_fare=False, price=Decimal("30.00"))
    )

    result = await AcceptOffer(rides, offers).execute(rider, o1.detail.offer.id)

    assert result.detail.ride.status is RideStatus.ACCEPTED
    assert result.detail.ride.driver_id == d1.id
    assert result.detail.ride.accepted_offer_id == o1.detail.offer.id
    assert result.detail.driver.id == d1.id
    assert result.losing_driver_ids == [d2.id]
    assert (await offers.get_by_id(o1.detail.offer.id)).status is OfferStatus.ACCEPTED
    assert (await offers.get_by_id(o2.detail.offer.id)).status is OfferStatus.REJECTED


async def test_accept_second_offer_after_assignment_fails():
    """Tras asignar, aceptar otra oferta del mismo viaje da error (ya no busca)."""
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, d1, d2 = _passenger(), _driver(), _driver()
    await users.add(d1)
    await users.add(d2)
    ride = await rides.add(_ride(rider.id))

    o1 = await CreateOffer(rides, offers).execute(
        d1, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    o2 = await CreateOffer(rides, offers).execute(
        d2, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    await AcceptOffer(rides, offers).execute(rider, o1.detail.offer.id)

    with pytest.raises(InvalidRideTransitionError):
        await AcceptOffer(rides, offers).execute(rider, o2.detail.offer.id)


async def test_accept_rejects_foreign_passenger():
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, intruder, driver = _passenger(), _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    offer = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    with pytest.raises(NotAuthorizedActionError):
        await AcceptOffer(rides, offers).execute(intruder, offer.detail.offer.id)


async def test_accept_rejects_expired_offer():
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    offer = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    # La oferta venció (30 s) aunque la solicitud sigue viva.
    (await offers.get_by_id(offer.detail.offer.id)).created_at = datetime.now(UTC) - (
        OFFER_TTL + timedelta(seconds=1)
    )

    with pytest.raises(InvalidRideTransitionError):
        await AcceptOffer(rides, offers).execute(rider, offer.detail.offer.id)


async def test_accept_fails_when_driver_already_busy():
    """Carrera: el conductor ya tiene un viaje activo; aceptar su otra oferta da 409."""
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider_a, rider_b, driver = _passenger(), _passenger(), _driver()
    await users.add(driver)
    ride_a = await rides.add(_ride(rider_a.id))
    ride_b = await rides.add(_ride(rider_b.id))

    offer_a = await CreateOffer(rides, offers).execute(
        driver, ride_a.id, CreateOfferInput(accept_at_fare=True)
    )
    offer_b = await CreateOffer(rides, offers).execute(
        driver, ride_b.id, CreateOfferInput(accept_at_fare=True)
    )

    # El pasajero A acepta: el conductor queda con un viaje activo y su oferta al
    # pasajero B se retiró (REJECTED) en la misma transacción.
    await AcceptOffer(rides, offers).execute(rider_a, offer_a.detail.offer.id)
    assert (await offers.get_by_id(offer_b.detail.offer.id)).status is OfferStatus.REJECTED

    # Simulamos la ventana de carrera: reabrimos la oferta B como PENDING (vigente)
    # justo antes del check atómico. El conductor sigue ocupado → 409.
    (await offers.get_by_id(offer_b.detail.offer.id)).status = OfferStatus.PENDING

    with pytest.raises(DriverUnavailableError):
        await AcceptOffer(rides, offers).execute(rider_b, offer_b.detail.offer.id)


async def test_withdraw_offer_kills_pending_offer():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    ride = await rides.add(_ride(rider.id))
    offer = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    withdrawn = await WithdrawOffer(offers).execute(driver, offer.detail.offer.id)

    assert withdrawn.status is OfferStatus.REJECTED


async def test_withdraw_offer_rejects_foreign_driver():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver, other = _passenger(), _driver(), _driver()
    ride = await rides.add(_ride(rider.id))
    offer = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    with pytest.raises(NotAuthorizedActionError):
        await WithdrawOffer(offers).execute(other, offer.detail.offer.id)


async def test_update_ride_status_valid_progression():
    rides = InMemoryRideRequestRepository()
    rider, driver = _passenger(), _driver()
    ride = _ride(rider.id)
    ride.status = RideStatus.ACCEPTED
    ride.driver_id = driver.id
    await rides.add(ride)

    use_case = UpdateRideStatus(rides)
    updated = await use_case.execute(driver, ride.id, RideStatus.ARRIVING)
    assert updated.status is RideStatus.ARRIVING
    updated = await use_case.execute(driver, ride.id, RideStatus.IN_PROGRESS)
    assert updated.status is RideStatus.IN_PROGRESS
    updated = await use_case.execute(driver, ride.id, RideStatus.COMPLETED)
    assert updated.status is RideStatus.COMPLETED
    assert updated.completed_at is not None


async def test_update_ride_status_rejects_invalid_jump():
    rides = InMemoryRideRequestRepository()
    rider, driver = _passenger(), _driver()
    ride = _ride(rider.id)
    ride.status = RideStatus.ACCEPTED
    ride.driver_id = driver.id
    await rides.add(ride)

    with pytest.raises(InvalidRideTransitionError):
        await UpdateRideStatus(rides).execute(driver, ride.id, RideStatus.COMPLETED)


async def test_update_ride_status_rejects_other_driver():
    rides = InMemoryRideRequestRepository()
    rider, driver, other = _passenger(), _driver(), _driver()
    ride = _ride(rider.id)
    ride.status = RideStatus.ACCEPTED
    ride.driver_id = driver.id
    await rides.add(ride)

    with pytest.raises(NotAuthorizedActionError):
        await UpdateRideStatus(rides).execute(other, ride.id, RideStatus.ARRIVING)


async def test_set_driver_online_toggles():
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    driver = _driver()
    driver.rating = 4.75
    await users.add(driver)

    result = await SetDriverOnline(users, offers).execute(driver, True)
    assert result.driver.is_online is True
    assert result.driver.rating == 4.75
    assert result.withdrawn_offers == []
    result = await SetDriverOnline(users, offers).execute(driver, False)
    assert result.driver.is_online is False
    assert result.driver.rating == 4.75
    assert result.withdrawn_offers == []


async def test_set_driver_offline_rejects_pending_offers():
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    created = await CreateOffer(rides, offers).execute(
        driver,
        ride.id,
        CreateOfferInput(accept_at_fare=False, price=Decimal("30.00")),
    )

    result = await SetDriverOnline(users, offers).execute(driver, False)

    assert result.driver.is_online is False
    assert [offer.id for offer in result.withdrawn_offers] == [created.detail.offer.id]
    stored = await offers.get_by_id(created.detail.offer.id)
    assert stored is not None
    assert stored.status is OfferStatus.REJECTED


async def test_set_driver_offline_rejects_active_ride():
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = _ride(rider.id)
    ride.status = RideStatus.ACCEPTED
    ride.driver_id = driver.id
    await rides.add(ride)

    with pytest.raises(DriverUnavailableError):
        await SetDriverOnline(users, offers).execute(driver, False)

    stored = await users.get_by_id(driver.id)
    assert stored is not None
    assert stored.is_online is True


async def test_set_driver_online_rejects_passenger():
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository()
    passenger = _passenger()
    await users.add(passenger)

    with pytest.raises(NotAuthorizedActionError):
        await SetDriverOnline(users, offers).execute(passenger, True)


@pytest.mark.parametrize(
    ("vehicle", "expected_services"),
    [
        (VehicleType.TAXI, {ServiceType.TAXI, ServiceType.DELIVERY}),
        (VehicleType.MOTO, {ServiceType.MOTO, ServiceType.DELIVERY}),
    ],
)
async def test_list_open_rides_filters_by_vehicle_type_and_includes_delivery(
    vehicle: VehicleType,
    expected_services: set[ServiceType],
):
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository(users=users)
    rider = _passenger()
    await users.add(rider)
    await rides.add(_ride(rider.id, service=ServiceType.TAXI))
    await rides.add(_ride(rider.id, service=ServiceType.MOTO))
    await rides.add(_ride(rider.id, service=ServiceType.DELIVERY))

    open_rides = await ListOpenRides(rides).execute(_driver(vehicle))

    assert {detail.ride.service_type for detail in open_rides} == expected_services
    assert all(detail.rider.full_name == "Pasa" for detail in open_rides)
    assert all(detail.rider.trips_completed == 0 for detail in open_rides)


async def test_list_offers_hides_expired_offers():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    users = InMemoryUserRepository()
    rider, d1, d2 = _passenger(), _driver(), _driver()
    await users.add(d1)
    await users.add(d2)
    ride = await rides.add(_ride(rider.id))

    fresh = await CreateOffer(rides, offers).execute(
        d1, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    old = await CreateOffer(rides, offers).execute(
        d2, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    # Envejecemos una oferta más allá de su TTL (30 s).
    (await offers.get_by_id(old.detail.offer.id)).created_at = datetime.now(UTC) - (
        OFFER_TTL + timedelta(seconds=1)
    )

    listed = await ListOffersForRide(rides, offers, users).execute(rider, ride.id)
    assert [d.offer.id for d in listed] == [fresh.detail.offer.id]


async def test_list_offers_empty_after_accept():
    """Tras aceptar, todas las ofertas del viaje están resueltas: ninguna viva."""
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, d1, d2 = _passenger(), _driver(), _driver()
    await users.add(d1)
    await users.add(d2)
    ride = await rides.add(_ride(rider.id))

    o1 = await CreateOffer(rides, offers).execute(
        d1, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    await CreateOffer(rides, offers).execute(d2, ride.id, CreateOfferInput(accept_at_fare=True))
    await AcceptOffer(rides, offers).execute(rider, o1.detail.offer.id)

    listed = await ListOffersForRide(rides, offers, users).execute(rider, ride.id)
    assert listed == []


async def test_cancel_ride_kills_active_offers():
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, d1, d2 = _passenger(), _driver(), _driver()
    await users.add(d1)
    await users.add(d2)
    ride = await rides.add(_ride(rider.id))
    o1 = await CreateOffer(rides, offers).execute(
        d1, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    o2 = await CreateOffer(rides, offers).execute(
        d2, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    result = await CancelRide(rides, offers).execute(rider, ride.id)

    assert result.ride.cancelled_at is not None
    assert (await offers.get_by_id(o1.detail.offer.id)).status is OfferStatus.REJECTED
    assert (await offers.get_by_id(o2.detail.offer.id)).status is OfferStatus.REJECTED


async def test_cancel_ride_does_not_reject_offer_when_accept_wins_race():
    class AcceptWinsBeforeCancel(InMemoryOfferRepository):
        async def cancel_ride_atomically(
            self, ride_id, *, expected_status, expected_paused
        ):
            current = await rides.get_by_id(ride_id)
            assert current is not None
            current.status = RideStatus.ACCEPTED
            current.driver_id = driver.id
            self.offers[0].status = OfferStatus.ACCEPTED
            return await super().cancel_ride_atomically(
                ride_id,
                expected_status=expected_status,
                expected_paused=expected_paused,
            )

    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    offers = AcceptWinsBeforeCancel(rides=rides, users=users)
    ride = await rides.add(_ride(rider.id))
    created = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )

    with pytest.raises(InvalidRideTransitionError):
        await CancelRide(rides, offers).execute(rider, ride.id)

    current = await rides.get_by_id(ride.id)
    assert current.status is RideStatus.ACCEPTED
    assert (await offers.get_by_id(created.detail.offer.id)).status is OfferStatus.ACCEPTED


async def test_expire_offer_marks_expired_when_past_ttl():
    rides, offers = InMemoryRideRequestRepository(), InMemoryOfferRepository()
    rider, driver = _passenger(), _driver()
    ride = await rides.add(_ride(rider.id))
    created = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    offer = created.detail.offer
    # La envejecemos más allá del TTL (30 s).
    (await offers.get_by_id(offer.id)).created_at = datetime.now(UTC) - (
        OFFER_TTL + timedelta(seconds=1)
    )

    expired = await ExpireOffer(offers).execute(offer.id)

    assert expired is not None
    assert expired.status is OfferStatus.EXPIRED
    assert (await offers.get_by_id(offer.id)).status is OfferStatus.EXPIRED


async def test_expire_offer_skips_already_resolved_offer():
    """Una oferta ya aceptada (o no vencida) no se expira: race-safe."""
    rides = InMemoryRideRequestRepository()
    users = InMemoryUserRepository()
    offers = InMemoryOfferRepository(rides=rides, users=users)
    rider, driver = _passenger(), _driver()
    await users.add(driver)
    ride = await rides.add(_ride(rider.id))
    created = await CreateOffer(rides, offers).execute(
        driver, ride.id, CreateOfferInput(accept_at_fare=True)
    )
    await AcceptOffer(rides, offers).execute(rider, created.detail.offer.id)
    (await offers.get_by_id(created.detail.offer.id)).created_at = datetime.now(UTC) - (
        OFFER_TTL + timedelta(seconds=1)
    )

    assert await ExpireOffer(offers).execute(created.detail.offer.id) is None
    assert (await offers.get_by_id(created.detail.offer.id)).status is OfferStatus.ACCEPTED
