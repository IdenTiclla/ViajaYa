"""Pruebas del adaptador DTO de aplicación → snapshot WebSocket v2."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from app.api.v1.realtime_snapshots import (
    build_driver_snapshot_message_v2,
    build_passenger_snapshot_message_v2,
)
from app.application.dto import (
    DriverRealtimeSnapshot,
    OfferDetail,
    Page,
    PageCursor,
    PassengerRealtimeSnapshot,
    RealtimeStreamCheckpoint,
    RideDetail,
)
from app.domain.entities import (
    Location,
    Offer,
    RideRequest,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)
from app.domain.repositories import OpenRideDetail, RiderSummary


def _user(
    *,
    role: UserRole,
    email: str,
    vehicle_type: VehicleType | None = None,
) -> User:
    return User(
        full_name="Conductor" if role is UserRole.DRIVER else "Pasajero",
        email=email,
        phone="70000000",
        role=role,
        vehicle_type=vehicle_type,
        plate="ABC-123" if vehicle_type is not None else None,
        vehicle_model="Sedán" if vehicle_type is not None else None,
        rating=4.8,
        is_online=role is UserRole.DRIVER,
    )


def _ride(
    rider: User,
    *,
    service_type: ServiceType = ServiceType.TAXI,
) -> RideRequest:
    return RideRequest(
        rider_id=rider.id,
        origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
        destination=Location(-16.49, -68.14, "Trabajo", "Calle 2"),
        service_type=service_type,
        fare=Decimal("25.00"),
        created_at=datetime.now(UTC),
    )


def _open_ride(ride: RideRequest, rider: User) -> OpenRideDetail:
    return OpenRideDetail(
        ride=ride,
        rider=RiderSummary(
            full_name=rider.full_name,
            rating=rider.rating,
            trips_completed=3,
        ),
    )


def test_build_passenger_snapshot_message_preserves_capture_and_decimal_json() -> None:
    rider = _user(role=UserRole.PASSENGER, email="rider@viajaya.com")
    driver = _user(
        role=UserRole.DRIVER,
        email="driver@viajaya.com",
        vehicle_type=VehicleType.TAXI,
    )
    ride = _ride(rider)
    offer = Offer(
        ride_id=ride.id,
        driver_id=driver.id,
        price=Decimal("27.50"),
        eta_min=5,
        created_at=datetime.now(UTC),
    )
    snapshot_id = uuid.uuid4()
    captured_at = datetime.now(UTC)
    snapshot = PassengerRealtimeSnapshot(
        snapshot_id=snapshot_id,
        ride=RideDetail(ride=ride, rider=rider),
        offers=[OfferDetail(offer=offer, driver=driver)],
        watermarks=(
            RealtimeStreamCheckpoint(
                stream=f"ride:{ride.id}",
                stream_version=8,
            ),
        ),
        captured_at=captured_at,
    )

    payload = build_passenger_snapshot_message_v2(snapshot).model_dump(mode="json")

    assert payload["snapshot_id"] == str(snapshot_id)
    assert payload["captured_at"] == captured_at.isoformat().replace("+00:00", "Z")
    assert payload["data"]["ride"]["id"] == str(ride.id)
    assert payload["data"]["offers"][0]["price"] == "27.50"
    assert payload["watermarks"] == [{"stream": f"ride:{ride.id}", "stream_version": 8}]


def test_build_driver_snapshot_message_unifies_page_and_nullable_active_ride() -> None:
    rider = _user(role=UserRole.PASSENGER, email="rider@viajaya.com")
    driver = _user(
        role=UserRole.DRIVER,
        email="driver@viajaya.com",
        vehicle_type=VehicleType.TAXI,
    )
    open_ride = _ride(rider)
    paused_ride = _ride(rider, service_type=ServiceType.DELIVERY)
    snapshot_id = uuid.uuid4()
    captured_at = datetime.now(UTC)
    snapshot = DriverRealtimeSnapshot(
        snapshot_id=snapshot_id,
        open_rides=Page(
            items=[_open_ride(open_ride, rider)],
            next_cursor=PageCursor(
                created_at=open_ride.created_at or captured_at,
                id=open_ride.id,
            ),
        ),
        paused_rides=[_open_ride(paused_ride, rider)],
        offers=[],
        active_ride=None,
        watermarks=(
            RealtimeStreamCheckpoint("pool:taxi", 4),
            RealtimeStreamCheckpoint("pool:delivery", 2),
            RealtimeStreamCheckpoint(f"driver:{driver.id}", 0),
        ),
        captured_at=captured_at,
    )

    payload = build_driver_snapshot_message_v2(snapshot).model_dump(mode="json")

    assert payload["snapshot_id"] == str(snapshot_id)
    assert payload["data"]["open_rides"]["items"][0]["id"] == str(open_ride.id)
    assert payload["data"]["open_rides"]["next_cursor"] is not None
    assert payload["data"]["paused_rides"][0]["id"] == str(paused_ride.id)
    assert payload["data"]["active_ride"] is None
    assert [item["stream"] for item in payload["watermarks"]] == [
        "pool:taxi",
        "pool:delivery",
        f"driver:{driver.id}",
    ]
