"""Input/output DTOs for the use cases.

Independent of the HTTP layer: the API's Pydantic schemas map
to/from these DTOs.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Generic, Literal, TypeAlias, TypeVar

from app.domain.entities import (
    AuthProvider,
    DriverVehicle,
    Offer,
    PaymentMethod,
    RideRequest,
    RideStatus,
    SavedPlaceCategory,
    ServiceType,
    User,
    VehicleType,
)
from app.domain.repositories import OpenRideDetail, WithdrawnOfferReference

T = TypeVar("T")

RealtimeOutboxQuarantineCode: TypeAlias = Literal[
    "empty_batch",
    "mixed_batch",
    "invalid_sequence",
    "duplicate_event_id",
    "unsafe_version",
    "invalid_topic",
    "stream_gap",
    "event_type_mismatch",
    "invalid_payload",
    "invalid_routing",
    "transport_limit",
]

ScheduledActionStatus: TypeAlias = Literal[
    "pending",
    "running",
    "succeeded",
    "cancelled",
    "dead",
]


@dataclass(frozen=True, slots=True)
class PendingScheduledAction:
    """Deferred action that must be persisted together with the producing mutation."""

    dedupe_key: str
    action_type: str
    aggregate_id: uuid.UUID
    generation: int
    execute_at: datetime
    payload: dict[str, object]


@dataclass(frozen=True, slots=True)
class RenewableScheduledAction:
    """Action whose next generation is assigned atomically when renewed."""

    dedupe_key: str
    action_type: str
    aggregate_id: uuid.UUID
    execute_at: datetime
    payload: dict[str, object]


@dataclass(frozen=True, slots=True)
class PassengerPresenceObservation:
    """Redis presence cut without exposing connections or internal keys."""

    live: bool
    present: bool
    retry_after_seconds: float


@dataclass(frozen=True, slots=True)
class ScheduledAction:
    """Durable state of an action, including its lease when claimed."""

    id: uuid.UUID
    dedupe_key: str
    action_type: str
    aggregate_id: uuid.UUID
    generation: int
    execute_at: datetime
    payload: dict[str, object]
    status: ScheduledActionStatus
    attempts: int
    next_attempt_at: datetime
    locked_at: datetime | None
    lock_token: uuid.UUID | None
    last_error: str | None
    terminal_at: datetime | None
    created_at: datetime
    updated_at: datetime
    lease_recovered: bool = False


@dataclass(frozen=True, slots=True)
class DispatchScheduledActionResult:
    """Sanitized result of processing at most one deferred action."""

    status: Literal[
        "empty",
        "succeeded",
        "deferred",
        "retried",
        "dead",
        "lost_lease",
    ]
    action_id: uuid.UUID | None = None
    action_type: str | None = None
    attempts: int = 0
    lease_recovered: bool = False


@dataclass(frozen=True, slots=True)
class ExecuteExpireOfferScheduledActionResult:
    """Confirmed effect of ``expire_offer`` and the result of its fencing."""

    status: Literal["succeeded", "lost_lease"]
    expired_offer: Offer | None = None


@dataclass(frozen=True, slots=True)
class ExecuteCancelAbsentRideScheduledActionResult:
    """Fenced result of durably closing an absent search."""

    status: Literal["succeeded", "deferred", "lost_lease"]
    cancelled_ride: CancelRideResult | None = None


@dataclass(frozen=True, slots=True)
class ScheduledActionDeadCount:
    """Cantidad de acciones terminales agrupada por tipo estable."""

    action_type: str
    action_count: int


@dataclass(frozen=True, slots=True)
class ScheduledActionsOperationalState:
    """Persisted scheduler aggregates, without payloads or identifiers."""

    pending_count: int
    due_count: int
    running_count: int
    stale_count: int
    retrying_count: int
    dead_counts: tuple[ScheduledActionDeadCount, ...]
    oldest_due_at: datetime | None = None
    next_due_at: datetime | None = None
    latest_succeeded_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ScheduledActionsOperationalSnapshot:
    """Corte operativo derivado con edades no negativas."""

    captured_at: datetime
    pending_count: int
    due_count: int
    running_count: int
    stale_count: int
    retrying_count: int
    dead_counts: tuple[ScheduledActionDeadCount, ...]
    oldest_due_age_seconds: float
    next_due_at: datetime | None = None
    latest_succeeded_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class PendingRealtimeEvent:
    """Event ready to be persisted, still without delivery metadata.

    The outbox assigns id, batch, sequence and aggregate/stream versions within
    the same transaction as the business mutation.
    """

    event_type: str
    topic: str
    aggregate_type: str
    aggregate_id: uuid.UUID
    correlation_id: uuid.UUID | None
    payload: dict[str, object]


@dataclass(frozen=True, slots=True)
class RealtimeOutboxEvent:
    """Durable event claimed or just added to the outbox."""

    id: uuid.UUID
    batch_id: uuid.UUID
    correlation_id: uuid.UUID
    sequence: int
    batch_size: int
    event_type: str
    topic: str
    aggregate_type: str
    aggregate_id: uuid.UUID
    aggregate_version: int
    stream_version: int
    payload: dict[str, object]
    created_at: datetime
    next_attempt_at: datetime
    published_at: datetime | None
    attempts: int
    last_error: str | None
    quarantined_at: datetime | None = None
    quarantine_code: RealtimeOutboxQuarantineCode | None = None


@dataclass(frozen=True, slots=True)
class DispatchRealtimeOutboxResult:
    """Result of processing at most one pending outbox batch."""

    status: Literal["empty", "published", "failed", "quarantined"]
    batch_id: uuid.UUID | None = None
    event_count: int = 0
    quarantine_code: RealtimeOutboxQuarantineCode | None = None
    affected_streams: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RealtimeOutboxQuarantineCount:
    """Number of terminal batches grouped by quarantine code."""

    code: str
    batch_count: int


@dataclass(frozen=True, slots=True)
class RealtimeOutboxOperationalState:
    """Persisted state needed to observe the outbox health.

    Timestamps are kept in this read DTO so that the application layer
    derives durations using an explicit, testable clock.
    """

    pending_event_count: int
    pending_batch_count: int
    retrying_batch_count: int
    quarantined_batches: tuple[RealtimeOutboxQuarantineCount, ...]
    oldest_pending_created_at: datetime | None = None
    latest_published_created_at: datetime | None = None
    latest_published_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class RealtimeOutboxOperationalSnapshot:
    """Operational metrics derived from a read cut of the outbox.

    ``latest_publish_delay_seconds`` measures ``created_at → published_at``. It is
    a conservative upper bound of the commit → publish delay because
    PostgreSQL assigns ``created_at`` inside the producing transaction.
    """

    captured_at: datetime
    pending_event_count: int
    pending_batch_count: int
    retrying_batch_count: int
    quarantined_batches: tuple[RealtimeOutboxQuarantineCount, ...]
    max_pending_age_seconds: float
    latest_publish_delay_seconds: float | None
    latest_published_at: datetime | None


@dataclass(frozen=True, slots=True)
class PublishedRealtimeOutboxRetentionResult:
    """Published batches deleted in a bounded transaction."""

    batch_count: int
    event_count: int


@dataclass(frozen=True)
class PageCursor:
    """Stable position to resume an ordered descending read."""

    created_at: datetime
    id: uuid.UUID


@dataclass(frozen=True)
class Page(Generic[T]):
    """A slice of a collection and the next page's position, if any."""

    items: list[T]
    next_cursor: PageCursor | None = None


@dataclass(frozen=True)
class SocialProfile:
    """Normalized profile returned by an OAuth provider after verifying the token."""

    provider: AuthProvider
    provider_id: str
    email: str
    full_name: str


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@dataclass(frozen=True)
class LocationInput:
    latitude: float
    longitude: float
    name: str
    address: str
    country_code: str | None = None


@dataclass(frozen=True)
class CreateRideRequestInput:
    origin: LocationInput
    destination: LocationInput
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod = PaymentMethod.CASH


@dataclass(frozen=True)
class SaveSavedPlaceInput:
    label: str
    category: SavedPlaceCategory
    location: LocationInput


@dataclass(frozen=True)
class CreateOfferInput:
    """A driver's offer on a ride.

    ``accept_at_fare=True`` means accepting at the passenger's price; in that case
    ``price`` is ignored and the ride's ``fare`` is used. If ``False`` it is a
    counter-offer with its own ``price`` and an estimated ``eta_min``.
    """

    accept_at_fare: bool = True
    price: Decimal | None = None
    eta_min: int | None = None
    expected_pool_version: int | None = None


@dataclass(frozen=True)
class UpdateRideStatusInput:
    status: RideStatus


@dataclass(frozen=True)
class OfferDetail:
    """Offer enriched with the data of the driver who made it."""

    offer: Offer
    driver: User


@dataclass(frozen=True)
class CreateOfferResult:
    """Result of offering: the created offer and, if the driver **improved** a
    previous offer on the same ride, the id of the replaced offer (the API layer
    uses it to remove the old card from the passenger's screen).
    """

    detail: OfferDetail
    superseded_offer_id: uuid.UUID | None = None


@dataclass(frozen=True)
class DriverAvailabilityResult:
    """Availability change and the offers withdrawn when going offline."""

    driver: User
    withdrawn_offers: list[Offer]


@dataclass(frozen=True)
class RideDetail:
    """Ride enriched with its participants and the accepted offer (if any)."""

    ride: RideRequest
    rider: User | None = None
    driver: User | None = None
    accepted_offer: Offer | None = None


@dataclass(frozen=True, slots=True)
class RealtimeStreamCheckpoint:
    """Stream position included in a consistent realtime capture."""

    stream: str
    stream_version: int


@dataclass(frozen=True, slots=True)
class PassengerRealtimeSnapshot:
    """Full projection the passenger recovers when connecting their socket."""

    snapshot_id: uuid.UUID
    ride: RideDetail
    offers: list[OfferDetail]
    watermarks: tuple[RealtimeStreamCheckpoint, ...]
    captured_at: datetime


@dataclass(frozen=True, slots=True)
class DriverRealtimeSnapshot:
    """Unified projection the driver recovers when connecting their socket."""

    snapshot_id: uuid.UUID
    open_rides: Page[OpenRideDetail]
    paused_rides: list[OpenRideDetail]
    offers: list[OfferDetail]
    active_ride: RideDetail | None
    watermarks: tuple[RealtimeStreamCheckpoint, ...]
    captured_at: datetime


@dataclass(frozen=True)
class RidePausedResult:
    """Result of pausing a request to edit it (Modify request): the
    ride marked ``paused`` and the live offers that were withdrawn, to notify
    those drivers and tell the passenger to remove the cards.
    """

    ride: RideRequest
    paused_offers: list[Offer]
    open_detail: OpenRideDetail


@dataclass(frozen=True)
class RideRepublishedResult:
    """Updated request announced again in the pool.

    Keeps in a single result the passenger's private detail and the
    enriched public projection that drivers consume.
    """

    detail: RideDetail
    open_detail: OpenRideDetail

    @property
    def ride(self) -> RideRequest:
        return self.detail.ride


@dataclass(frozen=True)
class CancelRideResult:
    """Enriched cancellation and its rejected live offers.

    The detail is captured before the commit so that the HTTP response, the outbox
    and the direct publication share exactly the same terminal state.
    """

    detail: RideDetail
    cancelled_offers: list[Offer]

    @property
    def ride(self) -> RideRequest:
        """Compatible shortcut for rules that only need the entity."""
        return self.detail.ride


@dataclass(frozen=True)
class AcceptOfferResult:
    """Result of the passenger accepting an offer (ride assignment):
    the assigned ride, the exact identities of the same driver's other live offers
    that were withdrawn, and the ``driver_id`` of the ride's other drivers
    who lost the race (the API layer broadcasts
    ``offer_withdrawn`` / ``offer_rejected`` with them).
    """

    detail: RideDetail
    withdrawn_offers: list[WithdrawnOfferReference]
    losing_driver_ids: list[uuid.UUID]

    @property
    def withdrawn_ride_ids(self) -> list[uuid.UUID]:
        """Temporary compatibility with the legacy per-ride summary contract."""
        return [offer.ride_id for offer in self.withdrawn_offers]


@dataclass(frozen=True)
class RideHistoryItem:
    """Finished/cancelled ride, enriched for the history cards.

    ``counterpart`` is the driver (passenger view) or the passenger (driver
    view); ``price`` is the agreed price (accepted offer or ``fare``);
    ``my_rating`` is the score the current user gave that ride, if any.
    """

    ride: RideRequest
    counterpart: User | None
    price: Decimal
    my_rating: int | None = None


@dataclass(frozen=True)
class EarningsItem:
    """One earnings line: a completed ride and what it earned."""

    ride_id: uuid.UUID
    destination_name: str
    price: Decimal
    completed_at: datetime | None


@dataclass(frozen=True)
class DriverEarnings:
    """Driver earnings summary: today, all-time and recent rides."""

    total_today: Decimal
    trips_today: int
    total_all_time: Decimal
    trips_all_time: int
    recent: list[EarningsItem]


@dataclass(frozen=True)
class DriverVehicleInput:
    """What a user fills in to register (or update) one of their driver vehicles.

    ``services`` must be a non-empty subset of what ``vehicle_type`` allows
    (see ``services_for_vehicle``): a taxi may serve ``taxi`` and/or
    ``delivery``, a moto ``moto`` and/or ``delivery``, a truck only ``moving``.
    """

    vehicle_type: VehicleType
    plate: str
    vehicle_model: str
    services: tuple[ServiceType, ...]


@dataclass(frozen=True)
class DriverVehicleRegistration:
    """Result of registering a vehicle: the vehicle and the account it updated."""

    user: User
    vehicle: DriverVehicle
