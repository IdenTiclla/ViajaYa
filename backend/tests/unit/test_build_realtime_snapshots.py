"""Tests de los casos de uso que preparan snapshots realtime consistentes."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.application.dto import (
    DriverRealtimeSnapshot,
    Page,
    PassengerRealtimeSnapshot,
    RealtimeStreamCheckpoint,
    RideDetail,
)
from app.application.interfaces import RealtimeSnapshotReader
from app.application.use_cases.build_driver_realtime_snapshot import (
    BuildDriverRealtimeSnapshot,
)
from app.application.use_cases.build_passenger_realtime_snapshot import (
    BuildPassengerRealtimeSnapshot,
)
from app.domain.entities import (
    Location,
    RideRequest,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.exceptions import NotAuthorizedActionError, RideNotFoundError


class FakeRealtimeSnapshotReader(RealtimeSnapshotReader):
    def __init__(
        self,
        *,
        passenger: PassengerRealtimeSnapshot | None = None,
        driver: DriverRealtimeSnapshot | None = None,
    ) -> None:
        self.passenger = passenger
        self.driver = driver
        self.passenger_calls: list[tuple[uuid.UUID, tuple[str, ...]]] = []
        self.driver_calls: list[tuple[uuid.UUID, tuple[str, ...]]] = []

    async def read_passenger(
        self,
        ride_id: uuid.UUID,
        streams: Sequence[str],
    ) -> PassengerRealtimeSnapshot | None:
        self.passenger_calls.append((ride_id, tuple(streams)))
        return self.passenger

    async def read_driver(
        self,
        driver_id: uuid.UUID,
        streams: Sequence[str],
    ) -> DriverRealtimeSnapshot | None:
        self.driver_calls.append((driver_id, tuple(streams)))
        return self.driver


def _passenger(email: str = "pasajero@viajaya.com") -> User:
    return User(full_name="Pasajero", email=email, role=UserRole.PASSENGER)


def _driver(vehicle_type: VehicleType | None = VehicleType.TAXI) -> User:
    return User(
        full_name="Conductor",
        email="conductor@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=vehicle_type,
        is_online=False,
    )


def _ride(rider_id: uuid.UUID) -> RideRequest:
    return RideRequest(
        rider_id=rider_id,
        origin=Location(-16.5, -68.13, "Origen", "Calle 1"),
        destination=Location(-16.49, -68.14, "Destino", "Calle 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("25.00"),
        created_at=datetime.now(UTC),
    )


def _passenger_snapshot(ride: RideRequest) -> PassengerRealtimeSnapshot:
    return PassengerRealtimeSnapshot(
        snapshot_id=uuid.uuid4(),
        ride=RideDetail(ride=ride),
        offers=[],
        watermarks=(RealtimeStreamCheckpoint(f"ride:{ride.id}", 0),),
        captured_at=datetime.now(UTC),
    )


def _driver_snapshot(driver: User) -> DriverRealtimeSnapshot:
    return DriverRealtimeSnapshot(
        snapshot_id=uuid.uuid4(),
        open_rides=Page(items=[]),
        paused_rides=[],
        offers=[],
        active_ride=None,
        watermarks=(
            RealtimeStreamCheckpoint(f"pool:{driver.vehicle_type.value}", 0),
            RealtimeStreamCheckpoint("pool:delivery", 0),
            RealtimeStreamCheckpoint(f"driver:{driver.id}", 0),
        ),
        captured_at=datetime.now(UTC),
    )


async def test_passenger_snapshot_derives_exact_ride_stream() -> None:
    passenger = _passenger()
    ride = _ride(passenger.id)
    expected = _passenger_snapshot(ride)
    reader = FakeRealtimeSnapshotReader(passenger=expected)

    result = await BuildPassengerRealtimeSnapshot(reader).execute(passenger, ride.id)

    assert result is expected
    assert reader.passenger_calls == [(ride.id, (f"ride:{ride.id}",))]


async def test_passenger_snapshot_rejects_wrong_role_before_reading() -> None:
    driver = _driver()
    reader = FakeRealtimeSnapshotReader()

    with pytest.raises(NotAuthorizedActionError):
        await BuildPassengerRealtimeSnapshot(reader).execute(driver, uuid.uuid4())

    assert reader.passenger_calls == []


async def test_passenger_snapshot_rejects_foreign_ride() -> None:
    passenger = _passenger()
    foreign_ride = _ride(_passenger("otro@viajaya.com").id)
    reader = FakeRealtimeSnapshotReader(passenger=_passenger_snapshot(foreign_ride))

    with pytest.raises(NotAuthorizedActionError):
        await BuildPassengerRealtimeSnapshot(reader).execute(passenger, foreign_ride.id)


async def test_passenger_snapshot_reports_disappeared_ride() -> None:
    passenger = _passenger()
    reader = FakeRealtimeSnapshotReader()

    with pytest.raises(RideNotFoundError):
        await BuildPassengerRealtimeSnapshot(reader).execute(passenger, uuid.uuid4())


@pytest.mark.parametrize("vehicle_type", [VehicleType.TAXI, VehicleType.MOTO])
async def test_driver_snapshot_derives_exact_stream_vector(
    vehicle_type: VehicleType,
) -> None:
    driver = _driver(vehicle_type)
    expected = _driver_snapshot(driver)
    reader = FakeRealtimeSnapshotReader(driver=expected)

    result = await BuildDriverRealtimeSnapshot(reader).execute(driver)

    assert result is expected
    assert reader.driver_calls == [
        (
            driver.id,
            (
                f"pool:{vehicle_type.value}",
                "pool:delivery",
                f"driver:{driver.id}",
            ),
        )
    ]


@pytest.mark.parametrize(
    "actor",
    [
        _passenger(),
        _driver(vehicle_type=None),
    ],
)
async def test_driver_snapshot_rejects_actor_without_driver_vehicle(actor: User) -> None:
    reader = FakeRealtimeSnapshotReader()

    with pytest.raises(NotAuthorizedActionError):
        await BuildDriverRealtimeSnapshot(reader).execute(actor)

    assert reader.driver_calls == []


async def test_driver_snapshot_reports_disappeared_driver() -> None:
    driver = _driver()
    reader = FakeRealtimeSnapshotReader()

    with pytest.raises(NotAuthorizedActionError):
        await BuildDriverRealtimeSnapshot(reader).execute(driver)
