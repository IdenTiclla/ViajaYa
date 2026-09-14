"""Unit tests: driver application and passenger/driver mode switch."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.application.dto import DriverApplicationInput
from app.application.use_cases.apply_as_driver import ApplyAsDriver
from app.application.use_cases.switch_account_mode import SwitchAccountMode
from app.domain.entities import (
    DriverStatus,
    Location,
    PaymentMethod,
    RideRequest,
    RideStatus,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidDriverApplicationError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
)
from tests.fakes import InMemoryRideRequestRepository, InMemoryUserRepository


def _passenger() -> User:
    return User(full_name="Ana", email=None, phone="+59170000001")


def _application(
    vehicle: VehicleType = VehicleType.TAXI,
    services: tuple[ServiceType, ...] = (ServiceType.TAXI, ServiceType.DELIVERY),
    plate: str = " abc-123 ",
    model: str = "Toyota  Corolla ",
) -> DriverApplicationInput:
    return DriverApplicationInput(
        vehicle_type=vehicle, plate=plate, vehicle_model=model, services=services
    )


def _location(name: str) -> Location:
    return Location(latitude=-16.5, longitude=-68.1, name=name, address=name)


def _ride(rider_id: uuid.UUID, driver_id: uuid.UUID | None, status: RideStatus) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=_location("A"),
        destination=_location("B"),
        service_type=ServiceType.TAXI,
        payment_method=PaymentMethod.CASH,
        fare=Decimal("20"),
        status=status,
        driver_id=driver_id,
    )


async def test_application_stays_pending_and_keeps_passenger_mode() -> None:
    users = InMemoryUserRepository()
    user = await users.add(_passenger())

    updated = await ApplyAsDriver(users, auto_approve=False).execute(user, _application())

    assert updated.role is UserRole.PASSENGER
    assert updated.driver_status is DriverStatus.PENDING
    assert updated.vehicle_type is VehicleType.TAXI
    assert updated.plate == "ABC-123"
    assert updated.vehicle_model == "Toyota Corolla"
    assert updated.offered_services == (ServiceType.TAXI, ServiceType.DELIVERY)
    assert not updated.is_approved_driver


async def test_auto_approve_lets_the_account_enter_driver_mode() -> None:
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository(users)
    user = await users.add(_passenger())

    applied = await ApplyAsDriver(users, auto_approve=True).execute(
        user, _application(VehicleType.MOTO, (ServiceType.MOTO,))
    )
    assert applied.driver_status is DriverStatus.APPROVED
    assert applied.offered_services == (ServiceType.MOTO,)

    driver = await SwitchAccountMode(users, rides).execute(applied, UserRole.DRIVER)
    assert driver.is_driver
    # Driver fields survive switching back to passenger mode.
    passenger = await SwitchAccountMode(users, rides).execute(driver, UserRole.PASSENGER)
    assert passenger.role is UserRole.PASSENGER
    assert passenger.vehicle_type is VehicleType.MOTO
    assert passenger.driver_status is DriverStatus.APPROVED


async def test_truck_only_offers_moving() -> None:
    users = InMemoryUserRepository()
    user = await users.add(_passenger())
    use_case = ApplyAsDriver(users, auto_approve=True)

    applied = await use_case.execute(
        user, _application(VehicleType.TRUCK, (ServiceType.MOVING,), model="Camioneta")
    )
    assert applied.offered_services == (ServiceType.MOVING,)

    with pytest.raises(InvalidDriverApplicationError):
        await use_case.execute(applied, _application(VehicleType.TRUCK, (ServiceType.DELIVERY,)))
    with pytest.raises(InvalidDriverApplicationError):
        await use_case.execute(applied, _application(VehicleType.TAXI, (ServiceType.MOVING,)))
    with pytest.raises(InvalidDriverApplicationError):
        await use_case.execute(applied, _application(services=()))


@pytest.mark.parametrize("plate", ["ab", "a" * 21, "ab$1"])
async def test_application_rejects_invalid_plates(plate: str) -> None:
    users = InMemoryUserRepository()
    user = await users.add(_passenger())
    with pytest.raises(InvalidDriverApplicationError):
        await ApplyAsDriver(users, auto_approve=True).execute(user, _application(plate=plate))


async def test_application_requires_passenger_mode() -> None:
    users = InMemoryUserRepository()
    user = await users.add(
        User(
            full_name="Luis",
            email=None,
            role=UserRole.DRIVER,
            vehicle_type=VehicleType.TAXI,
            driver_status=DriverStatus.APPROVED,
        )
    )
    with pytest.raises(NotAuthorizedActionError):
        await ApplyAsDriver(users, auto_approve=True).execute(user, _application())


async def test_pending_or_missing_application_cannot_enter_driver_mode() -> None:
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository(users)
    user = await users.add(_passenger())

    with pytest.raises(NotAuthorizedActionError):
        await SwitchAccountMode(users, rides).execute(user, UserRole.DRIVER)

    pending = await ApplyAsDriver(users, auto_approve=False).execute(user, _application())
    with pytest.raises(NotAuthorizedActionError):
        await SwitchAccountMode(users, rides).execute(pending, UserRole.DRIVER)


async def test_switching_modes_waits_for_active_rides_and_offline() -> None:
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository(users)
    user = await users.add(_passenger())
    approved = await ApplyAsDriver(users, auto_approve=True).execute(user, _application())

    searching = await rides.add(_ride(approved.id, None, RideStatus.SEARCHING))
    with pytest.raises(InvalidRideTransitionError):
        await SwitchAccountMode(users, rides).execute(approved, UserRole.DRIVER)
    searching.status = RideStatus.CANCELLED

    driver = await SwitchAccountMode(users, rides).execute(approved, UserRole.DRIVER)
    online = await users.set_online(driver.id, True)
    with pytest.raises(DriverUnavailableError):
        await SwitchAccountMode(users, rides).execute(online, UserRole.PASSENGER)

    offline = await users.set_online(driver.id, False)
    other_rider = await users.add(User(full_name="Rider", email=None))
    driving = await rides.add(_ride(other_rider.id, offline.id, RideStatus.IN_PROGRESS))
    with pytest.raises(InvalidRideTransitionError):
        await SwitchAccountMode(users, rides).execute(offline, UserRole.PASSENGER)
    driving.status = RideStatus.COMPLETED

    back = await SwitchAccountMode(users, rides).execute(offline, UserRole.PASSENGER)
    assert back.role is UserRole.PASSENGER


async def test_switching_to_the_same_mode_is_a_no_op() -> None:
    users = InMemoryUserRepository()
    rides = InMemoryRideRequestRepository(users)
    user = await users.add(_passenger())
    assert await SwitchAccountMode(users, rides).execute(user, UserRole.PASSENGER) is user
    with pytest.raises(NotAuthorizedActionError):
        await SwitchAccountMode(users, rides).execute(user, UserRole.DELIVERY)
