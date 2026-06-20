"""Dobles de prueba en memoria para los puertos del dominio/aplicación."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.application.dto import SocialProfile
from app.application.interfaces import (
    PasswordHasher,
    SocialIdentityVerifier,
    TokenService,
)
from app.domain.entities import (
    ACTIVE_OFFER_STATUSES,
    AuthProvider,
    Location,
    Offer,
    OfferStatus,
    RideRating,
    RideRequest,
    RideStatus,
    SavedPlace,
    ServiceType,
    User,
    UserRole,
)
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import (
    OfferAcceptance,
    OfferRepository,
    OpenRideDetail,
    RatingRepository,
    RideRequestRepository,
    RiderSummary,
    SavedPlaceRepository,
    UserRepository,
)

_ACTIVE_RIDE_STATUSES = (
    RideStatus.ACCEPTED,
    RideStatus.ARRIVING,
    RideStatus.IN_PROGRESS,
)


class InMemoryUserRepository(UserRepository):
    def __init__(self) -> None:
        self.users: dict[uuid.UUID, User] = {}

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return self.users.get(user_id)

    async def get_by_email(self, email: str) -> User | None:
        return next((u for u in self.users.values() if u.email == email), None)

    async def get_by_provider(self, provider: AuthProvider, provider_id: str) -> User | None:
        return next(
            (
                u
                for u in self.users.values()
                if u.auth_provider == provider and u.provider_id == provider_id
            ),
            None,
        )

    async def add(self, user: User) -> User:
        self.users[user.id] = user
        return user

    async def update(self, user: User) -> User:
        self.users[user.id] = user
        return user


class InMemoryRideRequestRepository(RideRequestRepository):
    def __init__(self, users: InMemoryUserRepository | None = None) -> None:
        self.rides: list[RideRequest] = []
        # Opcional: para construir el resumen del pasajero con sus datos reales.
        self._users = users

    async def add(self, ride: RideRequest) -> RideRequest:
        self.rides.append(ride)
        return ride

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        return next((r for r in self.rides if r.id == ride_id), None)

    async def update(self, ride: RideRequest) -> RideRequest:
        for i, existing in enumerate(self.rides):
            if existing.id == ride.id:
                self.rides[i] = ride
                return ride
        raise ValueError("ride request not found")

    async def list_open_for_service(self, service_type: ServiceType) -> list[RideRequest]:
        return [
            r
            for r in reversed(self.rides)
            if r.service_type == service_type
            and r.status is RideStatus.SEARCHING
            and not r.paused
        ]

    async def list_open_with_rider(self, service_type: ServiceType) -> list[OpenRideDetail]:
        return [
            self._detail_for(r)
            for r in reversed(self.rides)
            if r.service_type == service_type
            and r.status is RideStatus.SEARCHING
            and not r.paused
        ]

    async def rider_summary(self, rider_id: uuid.UUID) -> RiderSummary | None:
        if self._users is None:
            return None
        user = await self._users.get_by_id(rider_id)
        if user is None:
            return None
        return RiderSummary(
            full_name=user.full_name,
            rating=user.rating,
            trips_completed=self._count_completed(rider_id),
        )

    async def open_ride_with_rider(self, ride_id: uuid.UUID) -> OpenRideDetail | None:
        ride = await self.get_by_id(ride_id)
        if ride is None:
            return None
        return self._detail_for(ride)

    def _count_completed(self, rider_id: uuid.UUID) -> int:
        return sum(
            1
            for r in self.rides
            if r.rider_id == rider_id and r.status is RideStatus.COMPLETED
        )

    def _detail_for(self, ride: RideRequest) -> OpenRideDetail:
        # Con usuarios cableados usamos los datos reales; sin ellos, un resumen de
        # respaldo para los tests que no necesitan el nombre del pasajero.
        full_name = "Pasajero"
        rating: float | None = None
        if self._users is not None:
            user = self._users.users.get(ride.rider_id)
            if user is not None:
                full_name = user.full_name
                rating = user.rating
        return OpenRideDetail(
            ride=ride,
            rider=RiderSummary(
                full_name=full_name,
                rating=rating,
                trips_completed=self._count_completed(ride.rider_id),
            ),
        )

    async def list_by_driver(self, driver_id: uuid.UUID) -> list[RideRequest]:
        return [r for r in reversed(self.rides) if r.driver_id == driver_id]

    async def list_recent_destinations(
        self, rider_id: uuid.UUID, limit: int = 10
    ) -> list[Location]:
        seen: set[tuple[float, float]] = set()
        out: list[Location] = []
        for ride in reversed(self.rides):  # del más reciente al más antiguo
            if ride.rider_id != rider_id:
                continue
            key = (round(ride.destination.latitude, 5), round(ride.destination.longitude, 5))
            if key in seen:
                continue
            seen.add(key)
            out.append(ride.destination)
            if len(out) >= limit:
                break
        return out


    async def list_history(
        self, user_id: uuid.UUID, role: UserRole, statuses: set[RideStatus]
    ) -> list[RideRequest]:
        def owns(r: RideRequest) -> bool:
            return r.driver_id == user_id if role is UserRole.DRIVER else r.rider_id == user_id

        return [r for r in reversed(self.rides) if owns(r) and r.status in statuses]


class InMemoryOfferRepository(OfferRepository):
    def __init__(
        self,
        rides: InMemoryRideRequestRepository | None = None,
        users: InMemoryUserRepository | None = None,
    ) -> None:
        self.offers: list[Offer] = []
        # ``accept_atomically`` necesita ver viajes y conductores; se inyectan en
        # los tests que ejercitan la aceptación.
        self._rides = rides
        self._users = users

    async def add(self, offer: Offer) -> Offer:
        if offer.created_at is None:
            offer.created_at = datetime.now(UTC)
        self.offers.append(offer)
        return offer

    async def get_by_id(self, offer_id: uuid.UUID) -> Offer | None:
        return next((o for o in self.offers if o.id == offer_id), None)

    async def update(self, offer: Offer) -> Offer:
        for i, existing in enumerate(self.offers):
            if existing.id == offer.id:
                self.offers[i] = offer
                return offer
        raise ValueError("offer not found")

    async def list_by_ride(self, ride_id: uuid.UUID) -> list[Offer]:
        return [o for o in reversed(self.offers) if o.ride_id == ride_id]

    async def get_active_by_driver_and_ride(
        self, ride_id: uuid.UUID, driver_id: uuid.UUID
    ) -> Offer | None:
        return next(
            (
                o
                for o in reversed(self.offers)
                if o.ride_id == ride_id
                and o.driver_id == driver_id
                and o.status in ACTIVE_OFFER_STATUSES
            ),
            None,
        )

    async def reject_others(self, ride_id: uuid.UUID, keep_offer_id: uuid.UUID) -> None:
        for offer in self.offers:
            if (
                offer.ride_id == ride_id
                and offer.id != keep_offer_id
                and offer.status is OfferStatus.PENDING
            ):
                offer.status = OfferStatus.REJECTED

    async def reject_pending(self, ride_id: uuid.UUID) -> None:
        for offer in self.offers:
            if offer.ride_id == ride_id and offer.status in ACTIVE_OFFER_STATUSES:
                offer.status = OfferStatus.REJECTED

    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        assert self._rides is not None and self._users is not None, (
            "wire rides/users en el fake para ejercitar accept_atomically"
        )
        offer = await self.get_by_id(offer_id)
        if offer is None or offer.status is not OfferStatus.PENDING:
            return None
        driver = await self._users.get_by_id(offer.driver_id)
        if driver is None:
            return None
        ride = await self._rides.get_by_id(offer.ride_id)
        if ride is None or ride.status is not RideStatus.SEARCHING:
            return None
        # Conductor ocupado si ya tiene un viaje activo.
        if any(
            r.driver_id == driver.id and r.status in _ACTIVE_RIDE_STATUSES
            for r in self._rides.rides
        ):
            return None

        withdrawn = [
            o.ride_id
            for o in self.offers
            if o.driver_id == driver.id
            and o.id != offer_id
            and o.status in ACTIVE_OFFER_STATUSES
            and o.ride_id != ride.id
        ]
        losers = [
            o.driver_id
            for o in self.offers
            if o.ride_id == ride.id
            and o.id != offer_id
            and o.status in ACTIVE_OFFER_STATUSES
            and o.driver_id != driver.id
        ]
        offer.status = OfferStatus.ACCEPTED
        for o in self.offers:
            if (
                o.id != offer_id
                and o.status in ACTIVE_OFFER_STATUSES
                and (o.ride_id == ride.id or o.driver_id == driver.id)
            ):
                o.status = OfferStatus.REJECTED
        ride.driver_id = driver.id
        ride.accepted_offer_id = offer.id
        ride.status = RideStatus.ACCEPTED
        return OfferAcceptance(
            ride=ride,
            accepted_offer=offer,
            driver=driver,
            withdrawn_ride_ids=list(dict.fromkeys(withdrawn)),
            losing_driver_ids=list(dict.fromkeys(losers)),
        )


class InMemoryRatingRepository(RatingRepository):
    def __init__(self) -> None:
        self._ratings: dict[uuid.UUID, RideRating] = {}

    async def add(self, rating: RideRating) -> RideRating:
        self._ratings[rating.id] = rating
        return rating

    async def get_by_ride_and_rater(
        self, ride_id: uuid.UUID, rater_id: uuid.UUID
    ) -> RideRating | None:
        for r in self._ratings.values():
            if r.ride_id == ride_id and r.rater_id == rater_id:
                return r
        return None

    async def list_by_ratee(self, ratee_id: uuid.UUID) -> list[RideRating]:
        return [r for r in self._ratings.values() if r.ratee_id == ratee_id]

    async def average_for(self, ratee_id: uuid.UUID) -> float | None:
        scores = [r.score for r in self._ratings.values() if r.ratee_id == ratee_id]
        return sum(scores) / len(scores) if scores else None


class InMemorySavedPlaceRepository(SavedPlaceRepository):
    def __init__(self) -> None:
        self.places: list[SavedPlace] = []

    async def list_by_user(self, user_id: uuid.UUID) -> list[SavedPlace]:
        return [p for p in reversed(self.places) if p.user_id == user_id]

    async def get_by_id(self, place_id: uuid.UUID) -> SavedPlace | None:
        return next((p for p in self.places if p.id == place_id), None)

    async def add(self, place: SavedPlace) -> SavedPlace:
        self.places.append(place)
        return place

    async def update(self, place: SavedPlace) -> SavedPlace:
        for i, existing in enumerate(self.places):
            if existing.id == place.id:
                self.places[i] = place
                return place
        raise ValueError("saved place not found")

    async def delete(self, place: SavedPlace) -> None:
        self.places = [p for p in self.places if p.id != place.id]


class FakePasswordHasher(PasswordHasher):
    """Hash trivial reversible: solo para tests."""

    def hash(self, plain: str) -> str:
        return f"hashed::{plain}"

    def verify(self, plain: str, hashed: str) -> bool:
        return hashed == f"hashed::{plain}"


class FakeTokenService(TokenService):
    def create_access_token(self, user_id: uuid.UUID) -> str:
        return f"access::{user_id}"

    def create_refresh_token(self, user_id: uuid.UUID) -> str:
        return f"refresh::{user_id}"

    def decode_access_token(self, token: str) -> uuid.UUID:
        return self._decode(token, "access")

    def decode_refresh_token(self, token: str) -> uuid.UUID:
        return self._decode(token, "refresh")

    @staticmethod
    def _decode(token: str, kind: str) -> uuid.UUID:
        prefix = f"{kind}::"
        if not token.startswith(prefix):
            raise InvalidTokenError("token de prueba inválido")
        return uuid.UUID(token[len(prefix) :])


class FakeVerifier(SocialIdentityVerifier):
    """Verificador OAuth de prueba: el token es el provider_id."""

    def __init__(self, provider: AuthProvider) -> None:
        self.provider = provider

    async def verify(self, token: str) -> SocialProfile:
        if not token:
            raise InvalidTokenError("token vacío")
        return SocialProfile(
            provider=self.provider,
            provider_id=token,
            email=f"{token}.{self.provider.value}@example.com",
            full_name=f"Social {token}",
        )
