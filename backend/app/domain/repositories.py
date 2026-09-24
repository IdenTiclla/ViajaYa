"""Domain ports: interfaces the infrastructure must implement.

Use cases depend on these abstractions, not on SQLAlchemy
(dependency inversion).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from app.domain.entities import (
    AuthProvider,
    DriverVehicle,
    Location,
    Offer,
    RideRating,
    RideRatingSkip,
    RideRequest,
    RideStatus,
    SavedPlace,
    ServiceType,
    User,
    UserRole,
    VehicleType,
)


@dataclass(frozen=True)
class WithdrawnOfferReference:
    """Exact identity of an offer withdrawn during an atomic mutation."""

    ride_id: uuid.UUID
    offer_id: uuid.UUID


@dataclass(frozen=True)
class OfferAcceptance:
    """Result of a successful atomic dispatch.

    Bundles what the use case and the events layer need after assigning the
    driver: the updated ride, the accepted offer, the driver, the exact
    pairs of that driver's live offers that were withdrawn in
    **other** rides, and the ``driver_id`` of the **other** drivers of this
    ride whose offers were rejected (to tell them it was taken).
    """

    ride: RideRequest
    accepted_offer: Offer
    driver: User
    withdrawn_offers: list[WithdrawnOfferReference]
    losing_driver_ids: list[uuid.UUID]

    @property
    def withdrawn_ride_ids(self) -> list[uuid.UUID]:
        """Compatibility for consumers that still summarize by ride only."""
        return [offer.ride_id for offer in self.withdrawn_offers]


@dataclass(frozen=True)
class OfferCreation:
    """Atomic creation or replacement of an offer."""

    offer: Offer
    superseded_offer_id: uuid.UUID | None = None


@dataclass(frozen=True)
class DriverOfflineTransition:
    """Driver taken offline and pending offers withdrawn in a single commit."""

    driver: User
    withdrawn_offers: list[Offer]


@dataclass(frozen=True)
class RideAutoCancellation:
    """Atomic closing of an abandoned search and its live offers."""

    ride: RideRequest
    cancelled_offers: list[Offer]


@dataclass(frozen=True)
class RideOffersTransition:
    """Atomic mutation of a ride and the live offers it affects."""

    ride: RideRequest
    affected_offers: list[Offer]


@dataclass(frozen=True)
class RiderSummary:
    """Public passenger data the driver sees on an open request.

    ``rating`` is the average of the ratings received and can be ``None``
    if they have no votes yet. ``trips_completed`` counts their completed history.
    """

    full_name: str
    rating: float | None
    trips_completed: int


@dataclass(frozen=True)
class OpenRideDetail:
    """Open request enriched with the passenger summary, as a driver sees it
    in their list (REST and the WebSocket snapshot/``ride_created``).
    """

    ride: RideRequest
    rider: RiderSummary


class UserRepository(ABC):
    @abstractmethod
    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        """Return the user with that id, or ``None`` if it does not exist."""

    @abstractmethod
    async def get_by_email(self, email: str) -> User | None:
        """Return the user with that email, or ``None`` if it does not exist."""

    @abstractmethod
    async def get_by_provider(self, provider: AuthProvider, provider_id: str) -> User | None:
        """Return the user linked to an external identity, or ``None``."""

    @abstractmethod
    async def add(self, user: User) -> User:
        """Persist a new user and return it (with ``created_at`` populated)."""

    @abstractmethod
    async def update(self, user: User) -> User:
        """Update a user's general data and return it."""

    @abstractmethod
    async def set_online(self, user_id: uuid.UUID, is_online: bool) -> User:
        """Update availability only, without overwriting other concurrent fields."""


class RideRequestRepository(ABC):
    @abstractmethod
    async def add(self, ride: RideRequest) -> RideRequest:
        """Persist a ride request and return it (with ``created_at``)."""

    @abstractmethod
    async def add_if_no_active(self, ride: RideRequest) -> RideRequest | None:
        """Create the request only if the passenger has no other active ride.

        The check and the insert must run under mutual exclusion on the
        passenger so that two concurrent requests do not create two requests.
        """

    @abstractmethod
    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        """Return the request with that id, or ``None`` if it does not exist."""

    @abstractmethod
    async def get_active_by_rider(self, rider_id: uuid.UUID) -> RideRequest | None:
        """The passenger's most recent non-terminal ride, or ``None``."""

    @abstractmethod
    async def update(self, ride: RideRequest) -> RideRequest:
        """Update an existing request (status, assigned driver) and return it."""

    @abstractmethod
    async def update_if_state(
        self,
        ride: RideRequest,
        expected_status: RideStatus,
        *,
        expected_paused: bool | None = None,
        expected_fare: Decimal | None = None,
    ) -> RideRequest | None:
        """Update via compare-and-set and return ``None`` if the race was lost.

        It always compares ``status``; it optionally compares ``paused`` and ``fare``
        to protect mutations that keep the same ride status.
        """

    @abstractmethod
    async def mark_rider_on_the_way_if_arriving(
        self, ride_id: uuid.UUID, rider_id: uuid.UUID,
    ) -> tuple[RideRequest, bool] | None:
        """Lock the ride and set the pickup notice once; return (ride, changed)."""

    @abstractmethod
    async def cancel_if_searching(self, ride_id: uuid.UUID) -> RideRequest | None:
        """Atomically cancel only a ``SEARCHING``, non-paused ride."""

    @abstractmethod
    async def list_open_for_services(self, services: tuple[ServiceType, ...]) -> list[RideRequest]:
        """Requests compatible with the vehicle, newest first."""

    @abstractmethod
    async def list_open_with_rider_for_services(
        self,
        services: tuple[ServiceType, ...],
        *,
        driver_id: uuid.UUID | None = None,
        before_created_at: datetime | None = None,
        before_id: uuid.UUID | None = None,
        limit: int | None = None,
    ) -> list[OpenRideDetail]:
        """Compatible requests enriched with the passenger summary
        (name, rating and completed trips), in **a single query** (JOIN +
        count, no N+1). When ``driver_id`` is given, it excludes the versions that
        driver hid. ``before_created_at``/``before_id`` form the
        descending cursor and ``limit`` caps the rows. Total order: date and id.
        """

    @abstractmethod
    async def dismiss_open_ride_for_driver(
        self, driver_id: uuid.UUID, ride_id: uuid.UUID, pool_version: int
    ) -> None:
        """Record that the driver hid this version of the request."""

    @abstractmethod
    async def list_paused_with_rider_for_driver(self, driver_id: uuid.UUID) -> list[OpenRideDetail]:
        """Paused requests the driver had already offered on."""

    @abstractmethod
    async def rider_summary(self, rider_id: uuid.UUID) -> RiderSummary | None:
        """Public summary of a passenger, or ``None`` if it does not exist."""

    @abstractmethod
    async def open_ride_with_rider(self, ride_id: uuid.UUID) -> OpenRideDetail | None:
        """Enriched detail of a request (to publish ``ride_created`` with
        the passenger data), or ``None`` if it does not exist.
        """

    @abstractmethod
    async def lock_open_ride_with_rider_for_announcement(
        self, ride_id: uuid.UUID
    ) -> OpenRideDetail | None:
        """Lock and return a publishable request, or ``None``.

        The implementation must re-check under the lock that it is still ``SEARCHING`` and
        not paused. The caller keeps the transaction until it records the
        realtime announcement and confirms both effects in a single commit.
        """

    @abstractmethod
    async def list_by_driver(self, driver_id: uuid.UUID) -> list[RideRequest]:
        """Rides assigned to the driver, most recent first."""

    @abstractmethod
    async def list_recent_destinations(
        self, rider_id: uuid.UUID, limit: int = 10
    ) -> list[Location]:
        """The passenger's recent, unique destinations, newest first."""

    @abstractmethod
    async def list_history(
        self, user_id: uuid.UUID, role: UserRole, statuses: set[RideStatus]
    ) -> list[RideRequest]:
        """The user's terminal rides (by ``rider_id`` for a passenger, ``driver_id`` for a
        driver) with a status in ``statuses``, most recent first.
        """


class PendingRatingRepository(ABC):
    """Read query to recover closed rides that still need a rating."""

    @abstractmethod
    async def get_latest_for(
        self,
        user_id: uuid.UUID,
        role: UserRole,
    ) -> RideRequest | None:
        """The user's latest ``COMPLETED`` ride without a rating from them, or ``None``."""


class OfferRepository(ABC):
    @abstractmethod
    async def add(self, offer: Offer) -> Offer:
        """Persist a new offer and return it (with ``created_at`` populated)."""

    @abstractmethod
    async def create_or_supersede_atomically(
        self, offer: Offer, *, expected_ride_fare: Decimal,
        expected_pool_version: int | None = None,
    ) -> OfferCreation | None:
        """Create the offer and replace the previous one in a single transaction.

        Return ``None`` if the driver or the ride stopped being eligible when
        re-checked under the lock.
        """

    @abstractmethod
    async def get_by_id(self, offer_id: uuid.UUID) -> Offer | None:
        """Return the offer with that id, or ``None`` if it does not exist."""

    @abstractmethod
    async def update(self, offer: Offer) -> Offer:
        """Update an existing offer (status) and return it."""

    @abstractmethod
    async def reject_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        """Pasa ``PENDING`` a ``REJECTED`` mediante compare-and-set."""

    @abstractmethod
    async def list_by_ride(self, ride_id: uuid.UUID) -> list[Offer]:
        """Offers of a request, newest first."""

    @abstractmethod
    async def list_active_by_driver(self, driver_id: uuid.UUID) -> list[Offer]:
        """A driver's live (``PENDING``) offers, newest first."""

    @abstractmethod
    async def get_active_by_driver_and_ride(
        self, ride_id: uuid.UUID, driver_id: uuid.UUID
    ) -> Offer | None:
        """The driver's most recent live (``PENDING``) offer for that ride, or
        ``None`` (time-based expiry is decided by the use case).
        """

    @abstractmethod
    async def reject_others(self, ride_id: uuid.UUID, keep_offer_id: uuid.UUID) -> None:
        """Mark the ride's ``PENDING`` offers ``REJECTED`` except ``keep_offer_id``."""

    @abstractmethod
    async def reject_pending(self, ride_id: uuid.UUID) -> None:
        """Mark all live (``PENDING``) offers of the ride ``REJECTED``
        (the request died or was paused for editing).
        """

    @abstractmethod
    async def set_driver_offline_atomically(
        self, driver_id: uuid.UUID
    ) -> DriverOfflineTransition | None:
        """Take the driver offline and withdraw their offers in one transaction.

        It must lock the driver first, reject the change if they already have an
        active ride, and serialize against offer creation/acceptance. Return the
        unexpired offers so their withdrawal can be published to passengers.
        """

    @abstractmethod
    async def cancel_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_status: RideStatus,
        expected_paused: bool,
    ) -> RideOffersTransition | None:
        """Cancel the ride and reject its ``PENDING`` offers in a single commit.

        It must lock the ride and re-check its status and pause against the
        expected snapshot before mutating any row.
        """

    @abstractmethod
    async def pause_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_fare: Decimal,
    ) -> RideOffersTransition | None:
        """Pause a ``SEARCHING`` ride and reject its offers in a single commit.

        It must re-check under the lock that it is still unpaused and keeps ``expected_fare``.
        """

    @abstractmethod
    async def cancel_ride_on_disconnect_atomically(
        self, ride_id: uuid.UUID
    ) -> RideAutoCancellation | None:
        """Cancel an abandoned search and reject its offers in one transaction.

        It must lock and re-check that the ride is still ``SEARCHING`` and not paused.
        Return the offers that were still live when it closed so their events can be emitted.
        """

    @abstractmethod
    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        """Assign the driver atomically when the passenger accepts the offer.

        In **a single transaction** and with row locks (``SELECT … FOR UPDATE``
        on Postgres) it re-checks that the offer is still ``PENDING``, that the ride is still
        ``SEARCHING`` and that the driver is still online, enabled and **without an
        active ride**. If everything is still valid: it marks the offer ``ACCEPTED``, rejects
        the ride's other live offers and the driver's other live offers on other
        requests, assigns the driver and moves the ride to ``ACCEPTED``; it returns
        the :class:`OfferAcceptance`.

        Return ``None`` if the driver is no longer available or the ride/offer
        stopped being assignable (the use case translates it into ``DriverUnavailableError``).
        """

    @abstractmethod
    async def mark_expired_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        """Expire the offer (``EXPIRED``) only if it is still ``PENDING`` and past its TTL.

        Return the now ``EXPIRED`` offer, or ``None`` if it was no longer ``PENDING`` or had
        not expired (race-safe against accept/reject/withdraw/supersede: those take
        it out of ``PENDING`` and it is not touched here). This lets the backend notify the
        driver in real time when their offer dies of old age.
        """


class RatingRepository(ABC):
    @abstractmethod
    async def add_and_recompute(self, rating: RideRating) -> RideRating | None:
        """Persist the vote and update the rated user's average atomically.

        Transactional implementations must serialize ratings for the
        same ``ratee_id`` and write only ``User.rating``. Return
        ``None`` when a vote from the same author already exists for the ride.
        """

    @abstractmethod
    async def get_by_ride_and_rater(
        self, ride_id: uuid.UUID, rater_id: uuid.UUID
    ) -> RideRating | None:
        """Return the rating ``rater_id`` gave to that ride, or ``None``."""

    @abstractmethod
    async def list_by_ratee(self, ratee_id: uuid.UUID) -> list[RideRating]:
        """Ratings received by a user, newest first."""

    @abstractmethod
    async def average_for(self, ratee_id: uuid.UUID) -> float | None:
        """Promedio de las calificaciones recibidas, o ``None`` si no tiene ninguna."""


class RatingSkipRepository(ABC):
    @abstractmethod
    async def get_by_ride_and_rater(
        self,
        ride_id: uuid.UUID,
        rater_id: uuid.UUID,
    ) -> RideRatingSkip | None:
        """Return the participant's skip, or ``None`` if it does not exist yet."""

    @abstractmethod
    async def add_if_absent(self, skip: RideRatingSkip) -> RideRatingSkip:
        """Persist the skip, or return the existing one idempotently."""


class DriverVehicleRepository(ABC):
    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID) -> list[DriverVehicle]:
        """Vehicles of the driver in ``VehicleType`` order (taxi, moto, truck)."""

    @abstractmethod
    async def get(self, user_id: uuid.UUID, vehicle_type: VehicleType) -> DriverVehicle | None:
        """The driver's vehicle of that type, or ``None``."""

    @abstractmethod
    async def save(self, vehicle: DriverVehicle) -> DriverVehicle:
        """Inserts or updates the vehicle (unique per user and type) and returns it."""

    @abstractmethod
    async def delete(self, vehicle: DriverVehicle) -> None:
        """Removes the vehicle."""


class SavedPlaceRepository(ABC):
    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID) -> list[SavedPlace]:
        """The user's saved places, most recent first."""

    @abstractmethod
    async def get_by_id(self, place_id: uuid.UUID) -> SavedPlace | None:
        """Return the place with that id, or ``None`` if it does not exist."""

    @abstractmethod
    async def add(self, place: SavedPlace) -> SavedPlace:
        """Persist a new place and return it (with timestamps populated)."""

    @abstractmethod
    async def update(self, place: SavedPlace) -> SavedPlace:
        """Actualiza un lugar existente y lo devuelve."""

    @abstractmethod
    async def delete(self, place: SavedPlace) -> None:
        """Elimina el lugar."""
