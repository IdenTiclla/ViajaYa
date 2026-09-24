"""Domain entities. No framework dependencies."""

from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


class AuthProvider(enum.StrEnum):
    """Where the user's identity comes from."""

    LOCAL = "local"
    GOOGLE = "google"
    FACEBOOK = "facebook"


class UserRole(enum.StrEnum):
    """User role on the platform.

    Defines which navigation and actions the app shows: the passenger publishes requests,
    the driver answers with offers. ``DELIVERY`` is reserved for deliveries.
    """

    PASSENGER = "passenger"
    DRIVER = "driver"
    DELIVERY = "delivery"


class VehicleType(enum.StrEnum):
    """Physical vehicle registered by a driver (``TRUCK`` covers vans and trucks)."""

    TAXI = "taxi"
    MOTO = "moto"
    TRUCK = "truck"


class ServiceType(enum.StrEnum):
    """Service requested by a passenger (``MOVING`` is a house/office move)."""

    TAXI = "taxi"
    MOTO = "moto"
    DELIVERY = "delivery"
    MOVING = "moving"


class DriverStatus(enum.StrEnum):
    """Outcome of a driver application; only ``APPROVED`` can enter driver mode."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


_VEHICLE_SERVICES: dict[VehicleType, tuple[ServiceType, ...]] = {
    VehicleType.TAXI: (ServiceType.TAXI, ServiceType.DELIVERY),
    VehicleType.MOTO: (ServiceType.MOTO, ServiceType.DELIVERY),
    VehicleType.TRUCK: (ServiceType.MOVING,),
}


def services_for_vehicle(vehicle_type: VehicleType) -> tuple[ServiceType, ...]:
    """Services a vehicle is allowed to offer: taxi/moto may add deliveries, trucks move."""

    return _VEHICLE_SERVICES[vehicle_type]


def vehicle_can_serve(service_type: ServiceType, vehicle_type: VehicleType) -> bool:
    """Whether the vehicle may offer that service at all (regardless of the driver's choice)."""

    return service_type in services_for_vehicle(vehicle_type)


def offered_services(
    vehicle_type: VehicleType | None,
    driver_services: tuple[ServiceType, ...],
) -> tuple[ServiceType, ...]:
    """Services a driver actually serves.

    Drivers registered before per-driver services existed keep every service
    their vehicle allows; new applications persist an explicit subset.
    """

    if vehicle_type is None:
        return ()
    allowed = services_for_vehicle(vehicle_type)
    chosen = tuple(service for service in allowed if service in driver_services)
    return chosen or allowed


def driver_can_serve(driver: User, service_type: ServiceType) -> bool:
    """Whether the driver chose to serve rides of that type."""

    return service_type in driver.offered_services


@dataclass
class DriverVehicle:
    """One vehicle a driver registered; a driver has at most one per ``VehicleType``.

    ``services`` is the non-empty subset of ``services_for_vehicle`` the driver
    serves with it and ``status`` its own review outcome. The vehicle chosen when
    entering driver mode is copied onto ``User`` as the *active* vehicle.
    """

    user_id: uuid.UUID
    vehicle_type: VehicleType
    plate: str
    vehicle_model: str
    services: tuple[ServiceType, ...]
    status: DriverStatus = DriverStatus.PENDING
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None

    @property
    def is_approved(self) -> bool:
        return self.status is DriverStatus.APPROVED


def aggregate_driver_status(vehicles: list[DriverVehicle]) -> DriverStatus | None:
    """Account-level status: approved if any vehicle is, else pending if any is, else rejected."""

    statuses = {vehicle.status for vehicle in vehicles}
    for status in (DriverStatus.APPROVED, DriverStatus.PENDING, DriverStatus.REJECTED):
        if status in statuses:
            return status
    return None


@dataclass
class User:
    """Usuario de la plataforma.

    Every account signs in through a verified phone (optionally linked to a
    social identity); there is no password. ``email`` is informational only
    (filled by Google) and ``provider_id`` keeps the historical provider id.

    ``role`` is the *active mode* of the account: an approved driver
    (``driver_status == APPROVED``, aggregated over its ``DriverVehicle``s)
    switches between ``PASSENGER`` and ``DRIVER`` and is never both at once.
    ``vehicle_type``/``plate``/``vehicle_model``/``driver_services`` describe the
    **active vehicle** (the one chosen when entering driver mode) and survive
    while the account rides as a passenger.
    """

    full_name: str
    email: str | None
    phone: str | None = None
    auth_provider: AuthProvider = AuthProvider.LOCAL
    provider_id: str | None = None
    role: UserRole = UserRole.PASSENGER
    vehicle_type: VehicleType | None = None
    plate: str | None = None
    vehicle_model: str | None = None
    driver_services: tuple[ServiceType, ...] = ()
    driver_status: DriverStatus | None = None
    rating: float | None = None
    is_online: bool = False
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
    phone_verified_at: datetime | None = None
    is_active: bool = True

    @property
    def is_social(self) -> bool:
        return self.auth_provider is not AuthProvider.LOCAL

    @property
    def is_driver(self) -> bool:
        """The account is currently in driver mode."""

        return self.role is UserRole.DRIVER

    @property
    def is_approved_driver(self) -> bool:
        return self.driver_status is DriverStatus.APPROVED and self.vehicle_type is not None

    @property
    def offered_services(self) -> tuple[ServiceType, ...]:
        return offered_services(self.vehicle_type, self.driver_services)

    def activate_vehicle(self, vehicle: DriverVehicle | None) -> None:
        """Copy the vehicle onto the account (the pool and offers read it from here)."""

        self.vehicle_type = vehicle.vehicle_type if vehicle else None
        self.plate = vehicle.plate if vehicle else None
        self.vehicle_model = vehicle.vehicle_model if vehicle else None
        self.driver_services = vehicle.services if vehicle else ()


class PaymentMethod(enum.StrEnum):
    """Payment method chosen for the ride.

    For now the app supports QR payment and cash.
    """

    QR = "qr"
    CASH = "cash"


class RideStatus(enum.StrEnum):
    """Lifecycle status of a ride request.

    Flow: ``SEARCHING`` (published, waiting for offers) → ``ACCEPTED`` (the
    passenger picked an offer and a driver is assigned) → ``ARRIVING`` (the
    driver is heading to the origin) → ``IN_PROGRESS`` (ride underway) → ``COMPLETED``.
    ``CANCELLED`` is possible before ``IN_PROGRESS``.
    """

    SEARCHING = "searching"
    ACCEPTED = "accepted"
    ARRIVING = "arriving"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class Location:
    """A point of the ride: coordinates + human-readable label (name and address)."""

    latitude: float
    longitude: float
    name: str
    address: str


class SavedPlaceCategory(enum.StrEnum):
    """Category of a saved place; sets the icon in the app."""

    HOME = "home"
    WORK = "work"
    GYM = "gym"
    OTHER = "other"


@dataclass
class SavedPlace:
    """Passenger's favorite place, persisted to sync across devices.

    Reuses ``Location`` for the point (coordinates + labels) and adds the
    name the user gives it (``label``) and its ``category`` (home, work…).
    """

    user_id: uuid.UUID
    label: str
    category: SavedPlaceCategory
    location: Location
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class RideVehicleSnapshot:
    """Vehicle identity fixed at assignment, independent of later profile changes."""

    vehicle_id: uuid.UUID | None
    vehicle_type: VehicleType | None
    plate: str | None
    vehicle_model: str | None


@dataclass
class RideRequest:
    """Ride request created by a passenger.

    Captures what the mobile origin/destination flow produces: from where to where,
    with which service and how much they offer to pay. Starts in ``SEARCHING``. When
    the passenger accepts an offer, ``driver_id`` and ``accepted_offer_id`` are set.

    ``paused`` temporarily hides the request from the driver pool while the
    passenger edits it (Modify request): it stays ``SEARCHING`` but receives no
    new offers, and live ones are withdrawn when pausing.
    """

    rider_id: uuid.UUID
    origin: Location
    destination: Location
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod = PaymentMethod.CASH
    status: RideStatus = RideStatus.SEARCHING
    driver_id: uuid.UUID | None = None
    accepted_offer_id: uuid.UUID | None = None
    vehicle_snapshot: RideVehicleSnapshot | None = None
    rider_on_the_way_at: datetime | None = None
    paused: bool = False
    # Generation of the listing the driver evaluates before offering.
    # It advances when the proposal changes and on every reopening after a pause.
    pool_version: int = 1
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None


class OfferStatus(enum.StrEnum):
    """Status of a driver's offer on a ride request.

    The passenger has the final say: accepting a ``PENDING`` offer moves it
    to ``ACCEPTED`` and assigns the ride to that driver (atomic
    transaction); the ride's other live offers become ``REJECTED``. ``EXPIRED``
    applies when the 30 s TTL runs out without the passenger accepting it.
    """

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"


# Status in which an offer is still "live" in the negotiation.
ACTIVE_OFFER_STATUSES = frozenset({OfferStatus.PENDING})


@dataclass
class Offer:
    """A driver's offer on a ride request.

    The driver can **accept** at the passenger's price (``price == ride.fare``)
    or **counter-offer** with their own ``price`` and an estimated ``eta_min``. It starts
    ``PENDING`` and lives 30 s (``OFFER_TTL`` from ``created_at``); when the
    passenger accepts it the ride is assigned (it becomes ``ACCEPTED``) and the ride's
    other offers are rejected in the same transaction.
    """

    ride_id: uuid.UUID
    driver_id: uuid.UUID
    price: Decimal
    eta_min: int | None = None
    status: OfferStatus = OfferStatus.PENDING
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None


@dataclass
class RideRating:
    """Rating from one party of the ride to the other, once completed.

    When a ride reaches ``COMPLETED``, the passenger rates the driver and the
    driver rates the passenger (``score`` 1–5 + optional comment). Only one
    rating per ``(ride_id, rater_id)`` is allowed. Each vote recalculates the
    average ``User.rating`` of the rated person.
    """

    ride_id: uuid.UUID
    rater_id: uuid.UUID
    ratee_id: uuid.UUID
    score: int
    comment: str | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None


@dataclass
class RideRatingSkip:
    """A participant's decision to close the ride without rating it."""

    ride_id: uuid.UUID
    rater_id: uuid.UUID
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
