"""Unit tests: driver vehicles (register/remove) and the passenger/driver mode switch."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.application.dto import DriverVehicleInput
from app.application.use_cases.register_driver_vehicle import RegisterDriverVehicle
from app.application.use_cases.remove_driver_vehicle import RemoveDriverVehicle
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
    DriverVehicleNotFoundError,
    InvalidDriverApplicationError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
)
from tests.fakes import (
    InMemoryDriverVehicleRepository,
    InMemoryRideRequestRepository,
    InMemoryUserRepository,
)


class _World:
    def __init__(self, *, auto_approve: bool = True) -> None:
        self.users = InMemoryUserRepository()
        self.vehicles = InMemoryDriverVehicleRepository()
        self.rides = InMemoryRideRequestRepository(self.users)
        self.register = RegisterDriverVehicle(self.users, self.vehicles, auto_approve=auto_approve)
        self.remove = RemoveDriverVehicle(self.users, self.vehicles)
        self.switch = SwitchAccountMode(self.users, self.rides, self.vehicles)


def _passenger() -> User:
    return User(full_name="Ana", email=None, phone="+59170000001")


def _vehicle(
    vehicle: VehicleType = VehicleType.TAXI,
    services: tuple[ServiceType, ...] = (ServiceType.TAXI, ServiceType.DELIVERY),
    plate: str = " abc-123 ",
    model: str = "Toyota  Corolla ",
) -> DriverVehicleInput:
    return DriverVehicleInput(
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


async def test_first_vehicle_stays_pending_and_becomes_the_active_one() -> None:
    world = _World(auto_approve=False)
    user = await world.users.add(_passenger())

    result = await world.register.execute(user, _vehicle())

    assert result.vehicle.status is DriverStatus.PENDING
    assert result.vehicle.plate == "ABC-123"
    assert result.vehicle.vehicle_model == "Toyota Corolla"
    assert result.user.role is UserRole.PASSENGER
    assert result.user.driver_status is DriverStatus.PENDING
    assert result.user.vehicle_type is VehicleType.TAXI
    assert result.user.offered_services == (ServiceType.TAXI, ServiceType.DELIVERY)
    assert not result.user.is_approved_driver


async def test_driver_registers_up_to_one_vehicle_per_type() -> None:
    world = _World()
    user = await world.users.add(_passenger())

    await world.register.execute(user, _vehicle(VehicleType.TAXI, (ServiceType.TAXI,)))
    await world.register.execute(user, _vehicle(VehicleType.MOTO, (ServiceType.MOTO,)))
    result = await world.register.execute(
        user, _vehicle(VehicleType.TRUCK, (ServiceType.MOVING,), plate="C-1", model="Hilux")
    )
    # Re-registering a type updates it instead of adding a fourth vehicle.
    again = await world.register.execute(
        user, _vehicle(VehicleType.TAXI, (ServiceType.TAXI, ServiceType.DELIVERY), plate="NEW-1")
    )

    vehicles = await world.vehicles.list_by_user(user.id)
    assert sorted(v.vehicle_type for v in vehicles) == [
        VehicleType.MOTO,
        VehicleType.TAXI,
        VehicleType.TRUCK,
    ]
    assert again.vehicle.plate == "NEW-1"
    assert again.vehicle.services == (ServiceType.TAXI, ServiceType.DELIVERY)
    # The active vehicle is still the first one (taxi), refreshed with its edit.
    assert result.user.vehicle_type is VehicleType.TAXI
    assert again.user.plate == "NEW-1"
    assert again.user.driver_status is DriverStatus.APPROVED


async def test_entering_driver_mode_picks_the_vehicle() -> None:
    world = _World()
    user = await world.users.add(_passenger())
    await world.register.execute(user, _vehicle(VehicleType.TAXI, (ServiceType.TAXI,)))
    await world.register.execute(
        user, _vehicle(VehicleType.MOTO, (ServiceType.MOTO, ServiceType.DELIVERY), plate="M-1")
    )

    driver = await world.switch.execute(user, UserRole.DRIVER, VehicleType.MOTO)
    assert driver.is_driver
    assert driver.vehicle_type is VehicleType.MOTO
    assert driver.plate == "M-1"
    assert driver.offered_services == (ServiceType.MOTO, ServiceType.DELIVERY)

    # Changing vehicle while in driver mode requires being offline.
    online = await world.users.set_online(driver.id, True)
    with pytest.raises(DriverUnavailableError):
        await world.switch.execute(online, UserRole.DRIVER, VehicleType.TAXI)
    offline = await world.users.set_online(driver.id, False)
    taxi = await world.switch.execute(offline, UserRole.DRIVER, VehicleType.TAXI)
    assert taxi.vehicle_type is VehicleType.TAXI
    assert taxi.offered_services == (ServiceType.TAXI,)

    # Driver fields survive switching back to passenger mode.
    passenger = await world.switch.execute(taxi, UserRole.PASSENGER)
    assert passenger.role is UserRole.PASSENGER
    assert passenger.vehicle_type is VehicleType.TAXI
    assert passenger.driver_status is DriverStatus.APPROVED


async def test_single_approved_vehicle_is_chosen_by_default() -> None:
    world = _World()
    user = await world.users.add(_passenger())
    await world.register.execute(
        user, _vehicle(VehicleType.TRUCK, (ServiceType.MOVING,), model="Camioneta")
    )
    driver = await world.switch.execute(user, UserRole.DRIVER)
    assert driver.vehicle_type is VehicleType.TRUCK
    assert driver.offered_services == (ServiceType.MOVING,)


async def test_driver_mode_requires_an_approved_vehicle_of_that_type() -> None:
    world = _World(auto_approve=False)
    user = await world.users.add(_passenger())
    with pytest.raises(NotAuthorizedActionError):
        await world.switch.execute(user, UserRole.DRIVER)

    await world.register.execute(user, _vehicle())
    with pytest.raises(NotAuthorizedActionError):
        await world.switch.execute(user, UserRole.DRIVER)

    approved = _World()
    other = await approved.users.add(_passenger())
    await approved.register.execute(other, _vehicle(VehicleType.TAXI, (ServiceType.TAXI,)))
    with pytest.raises(NotAuthorizedActionError):
        await approved.switch.execute(other, UserRole.DRIVER, VehicleType.MOTO)


async def test_vehicle_validation() -> None:
    world = _World()
    user = await world.users.add(_passenger())
    with pytest.raises(InvalidDriverApplicationError):
        await world.register.execute(user, _vehicle(VehicleType.TRUCK, (ServiceType.DELIVERY,)))
    with pytest.raises(InvalidDriverApplicationError):
        await world.register.execute(user, _vehicle(VehicleType.TAXI, (ServiceType.MOVING,)))
    with pytest.raises(InvalidDriverApplicationError):
        await world.register.execute(user, _vehicle(services=()))
    for plate in ("ab", "a" * 21, "ab$1"):
        with pytest.raises(InvalidDriverApplicationError):
            await world.register.execute(user, _vehicle(plate=plate))


async def test_active_vehicle_cannot_be_edited_or_removed_in_driver_mode() -> None:
    world = _World()
    user = await world.users.add(_passenger())
    await world.register.execute(user, _vehicle(VehicleType.TAXI, (ServiceType.TAXI,)))
    driver = await world.switch.execute(user, UserRole.DRIVER)

    with pytest.raises(NotAuthorizedActionError):
        await world.register.execute(driver, _vehicle(VehicleType.TAXI, (ServiceType.TAXI,)))
    with pytest.raises(NotAuthorizedActionError):
        await world.remove.execute(driver, VehicleType.TAXI)
    # Other vehicles can still be added while driving with the taxi.
    result = await world.register.execute(
        driver, _vehicle(VehicleType.MOTO, (ServiceType.MOTO,), plate="M-1")
    )
    assert result.user.vehicle_type is VehicleType.TAXI


async def test_removing_the_active_vehicle_falls_back_to_another() -> None:
    world = _World()
    user = await world.users.add(_passenger())
    await world.register.execute(user, _vehicle(VehicleType.TAXI, (ServiceType.TAXI,)))
    await world.register.execute(user, _vehicle(VehicleType.MOTO, (ServiceType.MOTO,), plate="M-1"))

    updated = await world.remove.execute(user, VehicleType.TAXI)
    assert updated.vehicle_type is VehicleType.MOTO
    assert updated.driver_status is DriverStatus.APPROVED

    last = await world.remove.execute(updated, VehicleType.MOTO)
    assert last.vehicle_type is None
    assert last.driver_status is None
    assert last.offered_services == ()
    with pytest.raises(DriverVehicleNotFoundError):
        await world.remove.execute(last, VehicleType.MOTO)


async def test_switching_modes_waits_for_active_rides_and_offline() -> None:
    world = _World()
    user = await world.users.add(_passenger())
    await world.register.execute(user, _vehicle())

    searching = await world.rides.add(_ride(user.id, None, RideStatus.SEARCHING))
    with pytest.raises(InvalidRideTransitionError):
        await world.switch.execute(user, UserRole.DRIVER)
    searching.status = RideStatus.CANCELLED

    driver = await world.switch.execute(user, UserRole.DRIVER)
    online = await world.users.set_online(driver.id, True)
    with pytest.raises(DriverUnavailableError):
        await world.switch.execute(online, UserRole.PASSENGER)

    offline = await world.users.set_online(driver.id, False)
    other_rider = await world.users.add(User(full_name="Rider", email=None))
    driving = await world.rides.add(_ride(other_rider.id, offline.id, RideStatus.IN_PROGRESS))
    with pytest.raises(InvalidRideTransitionError):
        await world.switch.execute(offline, UserRole.PASSENGER)
    driving.status = RideStatus.COMPLETED

    back = await world.switch.execute(offline, UserRole.PASSENGER)
    assert back.role is UserRole.PASSENGER


async def test_switching_to_the_same_mode_is_a_no_op() -> None:
    world = _World()
    user = await world.users.add(_passenger())
    assert await world.switch.execute(user, UserRole.PASSENGER) is user
    with pytest.raises(NotAuthorizedActionError):
        await world.switch.execute(user, UserRole.DELIVERY)
