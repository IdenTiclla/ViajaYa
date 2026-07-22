"""Dobles de prueba en memoria para los puertos del dominio/aplicación."""

from __future__ import annotations

import uuid
from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

from app.application.dto import (
    AcceptOfferResult,
    CancelRideResult,
    CreateOfferResult,
    DriverAvailabilityResult,
    DriverEarnings,
    EarningsItem,
    Page,
    PageCursor,
    RideDetail,
    RideHistoryItem,
    RidePausedResult,
    RideRepublishedResult,
    SocialProfile,
)
from app.application.interfaces import (
    AcceptOfferEventRecorder,
    CancelRideEventRecorder,
    CreateOfferEventRecorder,
    DriverAvailabilityEventRecorder,
    ExpireOfferEventRecorder,
    PasswordHasher,
    PauseRideEventRecorder,
    RejectOfferEventRecorder,
    RepublishRideEventRecorder,
    RideReadRepository,
    SocialIdentityVerifier,
    TokenService,
    UnitOfWork,
    UpdateRideStatusEventRecorder,
    WithdrawOfferEventRecorder,
)
from app.application.use_cases.accept_offer import AcceptOffer
from app.application.use_cases.cancel_ride import CancelRide
from app.application.use_cases.cancel_ride_on_disconnect import CancelRideOnDisconnect
from app.application.use_cases.create_offer import CreateOffer
from app.application.use_cases.create_ride_request import CreateRideRequest
from app.application.use_cases.edit_ride import EditRide
from app.application.use_cases.expire_offer import ExpireOffer
from app.application.use_cases.pause_ride_for_edit import PauseRideForEdit
from app.application.use_cases.reject_offer import RejectOffer
from app.application.use_cases.set_driver_online import SetDriverOnline
from app.application.use_cases.update_ride_fare import UpdateRideFare
from app.application.use_cases.update_ride_status import UpdateRideStatus
from app.application.use_cases.withdraw_offer import WithdrawOffer
from app.domain.entities import (
    ACTIVE_OFFER_STATUSES,
    AuthProvider,
    Location,
    Offer,
    OfferStatus,
    RideRating,
    RideRatingSkip,
    RideRequest,
    RideStatus,
    SavedPlace,
    User,
    UserRole,
    VehicleType,
    services_for_vehicle,
    vehicle_can_serve,
)
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import (
    DriverOfflineTransition,
    OfferAcceptance,
    OfferCreation,
    OfferRepository,
    OpenRideDetail,
    PendingRatingRepository,
    RatingRepository,
    RatingSkipRepository,
    RideAutoCancellation,
    RideOffersTransition,
    RideRequestRepository,
    RiderSummary,
    SavedPlaceRepository,
    UserRepository,
    WithdrawnOfferReference,
)
from app.domain.ride_policy import is_offer_expired

_ACTIVE_RIDE_STATUSES = (
    RideStatus.ACCEPTED,
    RideStatus.ARRIVING,
    RideStatus.IN_PROGRESS,
)

_PASSENGER_ACTIVE_RIDE_STATUSES = (
    RideStatus.SEARCHING,
    RideStatus.ACCEPTED,
    RideStatus.ARRIVING,
    RideStatus.IN_PROGRESS,
)


def _as_utc(moment: datetime | None) -> datetime:
    if moment is None:
        return datetime.min.replace(tzinfo=UTC)
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _created_order(ride: RideRequest) -> tuple[datetime, int]:
    return (_as_utc(ride.created_at), ride.id.int)


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

    async def set_online(self, user_id: uuid.UUID, is_online: bool) -> User:
        user = self.users.get(user_id)
        if user is None:
            raise ValueError("user not found")
        updated = replace(user, is_online=is_online)
        self.users[user_id] = updated
        return updated


class InMemoryRideRequestRepository(RideRequestRepository):
    def __init__(self, users: InMemoryUserRepository | None = None) -> None:
        self.rides: list[RideRequest] = []
        self.dismissals: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
        # Opcional: para construir el resumen del pasajero con sus datos reales.
        self._users = users

    async def add(self, ride: RideRequest) -> RideRequest:
        self.rides.append(ride)
        return ride

    async def add_if_no_active(self, ride: RideRequest) -> RideRequest | None:
        if await self.get_active_by_rider(ride.rider_id) is not None:
            return None
        return await self.add(ride)

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        return next((r for r in self.rides if r.id == ride_id), None)

    async def get_active_by_rider(self, rider_id: uuid.UUID) -> RideRequest | None:
        return next(
            (
                r
                for r in reversed(self.rides)
                if r.rider_id == rider_id and r.status in _PASSENGER_ACTIVE_RIDE_STATUSES
            ),
            None,
        )

    async def update(self, ride: RideRequest) -> RideRequest:
        for i, existing in enumerate(self.rides):
            if existing.id == ride.id:
                self.rides[i] = ride
                return ride
        raise ValueError("ride request not found")

    async def update_if_state(
        self,
        ride: RideRequest,
        expected_status: RideStatus,
        *,
        expected_paused: bool | None = None,
        expected_fare: Decimal | None = None,
    ) -> RideRequest | None:
        for i, existing in enumerate(self.rides):
            if existing.id != ride.id:
                continue
            if existing.status is not expected_status:
                return None
            if expected_paused is not None and existing.paused is not expected_paused:
                return None
            if expected_fare is not None and existing.fare != expected_fare:
                return None

            completed_at = ride.completed_at
            cancelled_at = ride.cancelled_at
            now = datetime.now(UTC)
            if ride.status is RideStatus.COMPLETED and completed_at is None:
                completed_at = now
            if ride.status is RideStatus.CANCELLED and cancelled_at is None:
                cancelled_at = now
            updated = replace(
                ride,
                completed_at=completed_at,
                cancelled_at=cancelled_at,
            )
            self.rides[i] = updated
            return updated
        return None

    async def cancel_if_searching(self, ride_id: uuid.UUID) -> RideRequest | None:
        for i, existing in enumerate(self.rides):
            if existing.id != ride_id:
                continue
            if existing.status is not RideStatus.SEARCHING or existing.paused:
                return None
            updated = replace(
                existing,
                status=RideStatus.CANCELLED,
                cancelled_at=datetime.now(UTC),
            )
            self.rides[i] = updated
            return updated
        return None

    async def list_open_for_vehicle(self, vehicle_type: VehicleType) -> list[RideRequest]:
        return [
            r
            for r in reversed(self.rides)
            if r.service_type in services_for_vehicle(vehicle_type)
            and r.status is RideStatus.SEARCHING
            and not r.paused
        ]

    async def list_open_with_rider_for_vehicle(
        self,
        vehicle_type: VehicleType,
        *,
        driver_id: uuid.UUID | None = None,
        before_created_at: datetime | None = None,
        before_id: uuid.UUID | None = None,
        limit: int | None = None,
    ) -> list[OpenRideDetail]:
        if (before_created_at is None) != (before_id is None):
            raise ValueError("El cursor del pool requiere fecha e id.")
        cursor_order = (
            (_as_utc(before_created_at), before_id.int)
            if before_created_at is not None and before_id is not None
            else None
        )
        rides = sorted(
            (
                r
                for r in self.rides
                if r.service_type in services_for_vehicle(vehicle_type)
                and r.status is RideStatus.SEARCHING
                and not r.paused
                and (
                    driver_id is None
                    or self.dismissals.get((driver_id, r.id)) != r.pool_version
                )
                and (cursor_order is None or _created_order(r) < cursor_order)
            ),
            key=_created_order,
            reverse=True,
        )
        if limit is not None:
            rides = rides[:limit]
        return [self._detail_for(r) for r in rides]

    async def dismiss_open_ride_for_driver(
        self, driver_id: uuid.UUID, ride_id: uuid.UUID, pool_version: int
    ) -> None:
        self.dismissals[(driver_id, ride_id)] = pool_version

    async def list_paused_with_rider_for_driver(
        self, driver_id: uuid.UUID
    ) -> list[OpenRideDetail]:
        # El fake no persiste ofertas por conductor; este snapshot es exclusivo
        # de reconexión del WebSocket y no interviene en los casos de uso unitarios.
        return []

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

    async def lock_open_ride_with_rider_for_announcement(
        self, ride_id: uuid.UUID
    ) -> OpenRideDetail | None:
        ride = await self.get_by_id(ride_id)
        if (
            ride is None
            or ride.status is not RideStatus.SEARCHING
            or ride.paused
        ):
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

    async def create_or_supersede_atomically(
        self, offer: Offer, *, expected_ride_fare: Decimal
    ) -> OfferCreation | None:
        if self._rides is not None:
            ride = await self._rides.get_by_id(offer.ride_id)
            if (
                ride is None
                or ride.status is not RideStatus.SEARCHING
                or ride.paused
                or ride.fare != expected_ride_fare
                or any(
                    active.driver_id == offer.driver_id
                    and active.status in _ACTIVE_RIDE_STATUSES
                    for active in self._rides.rides
                )
            ):
                return None
        if self._users is not None:
            driver = await self._users.get_by_id(offer.driver_id)
            if (
                driver is None
                or not driver.is_driver
                or driver.vehicle_type is None
                or not driver.is_online
                or (
                    self._rides is not None
                    and not vehicle_can_serve(ride.service_type, driver.vehicle_type)
                )
            ):
                return None

        previous = await self.get_active_by_driver_and_ride(offer.ride_id, offer.driver_id)
        if previous is not None:
            previous.status = OfferStatus.REJECTED
        created = await self.add(offer)
        return OfferCreation(
            offer=created,
            superseded_offer_id=previous.id if previous else None,
        )

    async def get_by_id(self, offer_id: uuid.UUID) -> Offer | None:
        return next((o for o in self.offers if o.id == offer_id), None)

    async def update(self, offer: Offer) -> Offer:
        for i, existing in enumerate(self.offers):
            if existing.id == offer.id:
                self.offers[i] = offer
                return offer
        raise ValueError("offer not found")

    async def reject_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        offer = await self.get_by_id(offer_id)
        if offer is None or offer.status is not OfferStatus.PENDING:
            return None
        offer.status = OfferStatus.REJECTED
        return offer

    async def list_by_ride(self, ride_id: uuid.UUID) -> list[Offer]:
        return [o for o in reversed(self.offers) if o.ride_id == ride_id]

    async def list_active_by_driver(self, driver_id: uuid.UUID) -> list[Offer]:
        return [
            o
            for o in reversed(self.offers)
            if o.driver_id == driver_id and o.status in ACTIVE_OFFER_STATUSES
        ]

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

    async def set_driver_offline_atomically(
        self, driver_id: uuid.UUID
    ) -> DriverOfflineTransition | None:
        assert self._users is not None and self._rides is not None, (
            "wire rides/users en el fake para cambiar disponibilidad"
        )
        driver = await self._users.get_by_id(driver_id)
        if driver is None or not driver.is_driver or driver.vehicle_type is None:
            return None
        if any(
            ride.driver_id == driver_id and ride.status in _ACTIVE_RIDE_STATUSES
            for ride in self._rides.rides
        ):
            return None
        live_offers = [
            replace(offer)
            for offer in reversed(self.offers)
            if offer.driver_id == driver_id
            and offer.status is OfferStatus.PENDING
            and not is_offer_expired(offer)
        ]
        for offer in self.offers:
            if offer.driver_id == driver_id and offer.status is OfferStatus.PENDING:
                offer.status = OfferStatus.REJECTED
        updated = await self._users.set_online(driver_id, False)
        return DriverOfflineTransition(
            driver=updated,
            withdrawn_offers=live_offers,
        )

    async def cancel_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_status: RideStatus,
        expected_paused: bool,
    ) -> RideOffersTransition | None:
        assert self._rides is not None, "wire rides en el fake para cancelar"
        ride_index = next(
            (i for i, ride in enumerate(self._rides.rides) if ride.id == ride_id),
            None,
        )
        if ride_index is None:
            return None
        ride = self._rides.rides[ride_index]
        if ride.status is not expected_status or ride.paused is not expected_paused:
            return None

        live_offers = [
            replace(offer)
            for offer in reversed(self.offers)
            if offer.ride_id == ride_id
            and offer.status is OfferStatus.PENDING
            and not is_offer_expired(offer)
        ]
        updated = replace(
            ride,
            status=RideStatus.CANCELLED,
            cancelled_at=datetime.now(UTC),
        )
        self._rides.rides[ride_index] = updated
        for offer in self.offers:
            if offer.ride_id == ride_id and offer.status is OfferStatus.PENDING:
                offer.status = OfferStatus.REJECTED
        return RideOffersTransition(ride=updated, affected_offers=live_offers)

    async def pause_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_fare: Decimal,
    ) -> RideOffersTransition | None:
        assert self._rides is not None, "wire rides en el fake para pausar"
        ride_index = next(
            (i for i, ride in enumerate(self._rides.rides) if ride.id == ride_id),
            None,
        )
        if ride_index is None:
            return None
        ride = self._rides.rides[ride_index]
        if (
            ride.status is not RideStatus.SEARCHING
            or ride.paused
            or ride.fare != expected_fare
        ):
            return None

        live_offers = [
            replace(offer)
            for offer in reversed(self.offers)
            if offer.ride_id == ride_id
            and offer.status is OfferStatus.PENDING
            and not is_offer_expired(offer)
        ]
        updated = replace(ride, paused=True)
        self._rides.rides[ride_index] = updated
        for offer in self.offers:
            if offer.ride_id == ride_id and offer.status is OfferStatus.PENDING:
                offer.status = OfferStatus.REJECTED
        return RideOffersTransition(ride=updated, affected_offers=live_offers)

    async def cancel_ride_on_disconnect_atomically(
        self, ride_id: uuid.UUID
    ) -> RideAutoCancellation | None:
        assert self._rides is not None, (
            "wire rides en el fake para ejercitar la cancelación por desconexión"
        )
        ride_index = next(
            (i for i, ride in enumerate(self._rides.rides) if ride.id == ride_id),
            None,
        )
        if ride_index is None:
            return None
        ride = self._rides.rides[ride_index]
        if ride.status is not RideStatus.SEARCHING or ride.paused:
            return None

        live_offers = [
            replace(offer)
            for offer in reversed(self.offers)
            if offer.ride_id == ride_id
            and offer.status is OfferStatus.PENDING
            and not is_offer_expired(offer)
        ]
        updated = replace(
            ride,
            status=RideStatus.CANCELLED,
            cancelled_at=datetime.now(UTC),
        )
        self._rides.rides[ride_index] = updated
        for offer in self.offers:
            if offer.ride_id == ride_id and offer.status is OfferStatus.PENDING:
                offer.status = OfferStatus.REJECTED

        return RideAutoCancellation(
            ride=updated,
            cancelled_offers=live_offers,
        )

    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        assert self._rides is not None and self._users is not None, (
            "wire rides/users en el fake para ejercitar accept_atomically"
        )
        offer = await self.get_by_id(offer_id)
        if offer is None or offer.status is not OfferStatus.PENDING:
            return None
        driver = await self._users.get_by_id(offer.driver_id)
        if (
            driver is None
            or not driver.is_driver
            or driver.vehicle_type is None
            or not driver.is_online
        ):
            return None
        ride = await self._rides.get_by_id(offer.ride_id)
        if (
            ride is None
            or ride.status is not RideStatus.SEARCHING
            or ride.paused
            or not vehicle_can_serve(ride.service_type, driver.vehicle_type)
        ):
            return None
        if is_offer_expired(offer):
            offer.status = OfferStatus.EXPIRED
            return None
        # Conductor ocupado si ya tiene un viaje activo.
        if any(
            r.driver_id == driver.id and r.status in _ACTIVE_RIDE_STATUSES
            for r in self._rides.rides
        ):
            return None

        withdrawn = [
            WithdrawnOfferReference(ride_id=o.ride_id, offer_id=o.id)
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
            withdrawn_offers=list(dict.fromkeys(withdrawn)),
            losing_driver_ids=list(dict.fromkeys(losers)),
        )

    async def mark_expired_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        offer = await self.get_by_id(offer_id)
        if (
            offer is None
            or offer.status is not OfferStatus.PENDING
            or not is_offer_expired(offer)
        ):
            return None
        offer.status = OfferStatus.EXPIRED
        return offer


class InMemoryUnitOfWork(UnitOfWork):
    """UoW de prueba que restaura los agregados si la operación falla."""

    def __init__(
        self,
        offers: InMemoryOfferRepository | None = None,
        *,
        rides: InMemoryRideRequestRepository | None = None,
        users: InMemoryUserRepository | None = None,
        operations: list[str] | None = None,
        commit_error: BaseException | None = None,
    ) -> None:
        self.commits = 0
        self.rollbacks = 0
        self._offers = offers
        self._offer_snapshot = deepcopy(offers.offers) if offers is not None else None
        self._rides = rides
        self._ride_snapshot = deepcopy(rides.rides) if rides is not None else None
        self._users = users
        self._user_snapshot = deepcopy(users.users) if users is not None else None
        self._operations = operations
        self._commit_error = commit_error

    async def commit(self) -> None:
        self.commits += 1
        if self._operations is not None:
            self._operations.append("commit")
        if self._commit_error is not None:
            raise self._commit_error

    async def rollback(self) -> None:
        self.rollbacks += 1
        if self._operations is not None:
            self._operations.append("rollback")
        if self._offers is not None and self._offer_snapshot is not None:
            self._offers.offers[:] = deepcopy(self._offer_snapshot)
        if self._rides is not None and self._ride_snapshot is not None:
            self._rides.rides[:] = deepcopy(self._ride_snapshot)
        if self._users is not None and self._user_snapshot is not None:
            self._users.users.clear()
            self._users.users.update(deepcopy(self._user_snapshot))


class InMemoryCreateOfferEventRecorder(CreateOfferEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.results: list[CreateOfferResult] = []
        self._operations = operations
        self._error = error

    async def record(self, result: CreateOfferResult) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.results.append(result)


class InMemoryAcceptOfferEventRecorder(AcceptOfferEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.results: list[AcceptOfferResult] = []
        self._operations = operations
        self._error = error

    async def record(self, result: AcceptOfferResult) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.results.append(result)


class InMemoryCancelRideEventRecorder(CancelRideEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.results: list[CancelRideResult] = []
        self._operations = operations
        self._error = error

    async def record(self, result: CancelRideResult) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.results.append(result)


class InMemoryRepublishRideEventRecorder(RepublishRideEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.results: list[RideRepublishedResult] = []
        self._operations = operations
        self._error = error

    async def record(self, result: RideRepublishedResult) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.results.append(result)


class InMemoryWithdrawOfferEventRecorder(WithdrawOfferEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.offers: list[Offer] = []
        self._operations = operations
        self._error = error

    async def record(self, offer: Offer) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.offers.append(offer)


class InMemoryRejectOfferEventRecorder(RejectOfferEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.offers: list[Offer] = []
        self._operations = operations
        self._error = error

    async def record(self, offer: Offer) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.offers.append(offer)


class InMemoryExpireOfferEventRecorder(ExpireOfferEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.offers: list[Offer] = []
        self._operations = operations
        self._error = error

    async def record(self, offer: Offer) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.offers.append(offer)


class InMemoryUpdateRideStatusEventRecorder(UpdateRideStatusEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.details: list[RideDetail] = []
        self._operations = operations
        self._error = error

    async def record(self, detail: RideDetail) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.details.append(detail)


class InMemoryDriverAvailabilityEventRecorder(DriverAvailabilityEventRecorder):
    def __init__(
        self,
        *,
        operations: list[str] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.results: list[DriverAvailabilityResult] = []
        self._operations = operations
        self._error = error

    async def record(self, result: DriverAvailabilityResult) -> None:
        if self._operations is not None:
            self._operations.append("record")
        if self._error is not None:
            raise self._error
        self.results.append(result)


def create_ride_request_use_case(
    rides: InMemoryRideRequestRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
) -> CreateRideRequest:
    """Cablea CreateRideRequest con una frontera transaccional explícita."""
    return CreateRideRequest(
        rides,
        unit_of_work or InMemoryUnitOfWork(rides=rides),
    )


def update_ride_fare_use_case(
    rides: InMemoryRideRequestRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: RepublishRideEventRecorder | None = None,
) -> UpdateRideFare:
    """Cablea UpdateRideFare con dobles transaccionales explícitos."""
    return UpdateRideFare(
        rides,
        unit_of_work or InMemoryUnitOfWork(rides=rides),
        event_recorder or InMemoryRepublishRideEventRecorder(),
    )


def edit_ride_use_case(
    rides: InMemoryRideRequestRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: RepublishRideEventRecorder | None = None,
) -> EditRide:
    """Cablea EditRide con dobles transaccionales explícitos."""
    return EditRide(
        rides,
        unit_of_work or InMemoryUnitOfWork(rides=rides),
        event_recorder or InMemoryRepublishRideEventRecorder(),
    )


def withdraw_offer_use_case(
    offers: InMemoryOfferRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: WithdrawOfferEventRecorder | None = None,
) -> WithdrawOffer:
    """Cablea WithdrawOffer con dobles transaccionales explícitos."""
    return WithdrawOffer(
        offers,
        unit_of_work or InMemoryUnitOfWork(offers),
        event_recorder or InMemoryWithdrawOfferEventRecorder(),
    )


def reject_offer_use_case(
    rides: InMemoryRideRequestRepository,
    offers: InMemoryOfferRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: RejectOfferEventRecorder | None = None,
) -> RejectOffer:
    """Cablea RejectOffer con dobles transaccionales explícitos."""
    return RejectOffer(
        rides,
        offers,
        unit_of_work or InMemoryUnitOfWork(offers),
        event_recorder or InMemoryRejectOfferEventRecorder(),
    )


def expire_offer_use_case(
    offers: InMemoryOfferRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: ExpireOfferEventRecorder | None = None,
) -> ExpireOffer:
    """Cablea ExpireOffer con dobles transaccionales explícitos."""
    return ExpireOffer(
        offers,
        unit_of_work or InMemoryUnitOfWork(offers),
        event_recorder or InMemoryExpireOfferEventRecorder(),
    )


def update_ride_status_use_case(
    rides: InMemoryRideRequestRepository,
    offers: InMemoryOfferRepository,
    users: InMemoryUserRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: UpdateRideStatusEventRecorder | None = None,
) -> UpdateRideStatus:
    """Cablea UpdateRideStatus con dobles transaccionales explícitos."""
    return UpdateRideStatus(
        rides,
        offers,
        users,
        unit_of_work or InMemoryUnitOfWork(rides=rides),
        event_recorder or InMemoryUpdateRideStatusEventRecorder(),
    )


def set_driver_online_use_case(
    users: InMemoryUserRepository,
    offers: InMemoryOfferRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: DriverAvailabilityEventRecorder | None = None,
) -> SetDriverOnline:
    """Cablea SetDriverOnline con dobles transaccionales explícitos."""
    return SetDriverOnline(
        users,
        offers,
        unit_of_work or InMemoryUnitOfWork(offers, users=users),
        event_recorder or InMemoryDriverAvailabilityEventRecorder(),
    )


def cancel_ride_use_case(
    rides: InMemoryRideRequestRepository,
    offers: InMemoryOfferRepository,
    users: InMemoryUserRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: CancelRideEventRecorder | None = None,
) -> CancelRide:
    """Cablea CancelRide con dobles transaccionales explícitos."""
    return CancelRide(
        rides,
        offers,
        users,
        unit_of_work or InMemoryUnitOfWork(offers, rides=rides),
        event_recorder or InMemoryCancelRideEventRecorder(),
    )


def cancel_ride_on_disconnect_use_case(
    rides: InMemoryRideRequestRepository,
    offers: InMemoryOfferRepository,
    users: InMemoryUserRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: CancelRideEventRecorder | None = None,
) -> CancelRideOnDisconnect:
    """Cablea el cierre por ausencia con dobles transaccionales explícitos."""
    return CancelRideOnDisconnect(
        offers,
        users,
        unit_of_work or InMemoryUnitOfWork(offers, rides=rides),
        event_recorder or InMemoryCancelRideEventRecorder(),
    )


def accept_offer_use_case(
    rides: InMemoryRideRequestRepository,
    offers: InMemoryOfferRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: AcceptOfferEventRecorder | None = None,
) -> AcceptOffer:
    """Cablea AcceptOffer con dobles transaccionales explícitos."""
    return AcceptOffer(
        rides,
        offers,
        unit_of_work or InMemoryUnitOfWork(offers, rides=rides),
        event_recorder or InMemoryAcceptOfferEventRecorder(),
    )


class InMemoryPauseRideEventRecorder(PauseRideEventRecorder):
    def __init__(self, *, error: BaseException | None = None) -> None:
        self.results: list[RidePausedResult] = []
        self._error = error

    async def record(self, result: RidePausedResult) -> None:
        if self._error is not None:
            raise self._error
        self.results.append(result)


def pause_ride_use_case(
    rides: InMemoryRideRequestRepository,
    offers: InMemoryOfferRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: PauseRideEventRecorder | None = None,
) -> PauseRideForEdit:
    """Cablea PauseRideForEdit con dobles transaccionales explícitos."""
    return PauseRideForEdit(
        rides,
        offers,
        unit_of_work or InMemoryUnitOfWork(offers, rides=rides),
        event_recorder or InMemoryPauseRideEventRecorder(),
    )


def create_offer_use_case(
    rides: RideRequestRepository,
    offers: InMemoryOfferRepository,
    *,
    unit_of_work: UnitOfWork | None = None,
    event_recorder: CreateOfferEventRecorder | None = None,
) -> CreateOffer:
    """Cablea CreateOffer con dobles transaccionales explícitos."""
    return CreateOffer(
        rides,
        offers,
        unit_of_work or InMemoryUnitOfWork(offers),
        event_recorder or InMemoryCreateOfferEventRecorder(),
    )


class InMemoryRatingRepository(RatingRepository):
    def __init__(self, users: InMemoryUserRepository | None = None) -> None:
        self._ratings: dict[uuid.UUID, RideRating] = {}
        self._users = users

    async def add_and_recompute(self, rating: RideRating) -> RideRating | None:
        duplicate = await self.get_by_ride_and_rater(rating.ride_id, rating.rater_id)
        if duplicate is not None:
            return None
        self._ratings[rating.id] = rating

        if self._users is not None:
            ratee = self._users.users.get(rating.ratee_id)
            average = await self.average_for(rating.ratee_id)
            if ratee is not None and average is not None:
                self._users.users[ratee.id] = replace(ratee, rating=round(average, 2))
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


class InMemoryRideReadRepository(RideReadRepository):
    """Compone los repositorios en memoria como proyección de lectura."""

    def __init__(
        self,
        rides: InMemoryRideRequestRepository,
        offers: InMemoryOfferRepository,
        users: InMemoryUserRepository,
        ratings: InMemoryRatingRepository,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._users = users
        self._ratings = ratings

    async def get_active_for_driver(self, driver_id: uuid.UUID) -> RideDetail | None:
        ride = max(
            (
                candidate
                for candidate in self._rides.rides
                if candidate.driver_id == driver_id
                and candidate.status in _ACTIVE_RIDE_STATUSES
            ),
            key=_created_order,
            default=None,
        )
        if ride is None:
            return None
        offer = (
            await self._offers.get_by_id(ride.accepted_offer_id)
            if ride.accepted_offer_id is not None
            else None
        )
        return RideDetail(
            ride=ride,
            rider=await self._users.get_by_id(ride.rider_id),
            accepted_offer=offer,
        )

    async def list_history_items(
        self,
        user_id: uuid.UUID,
        role: UserRole,
        statuses: set[RideStatus],
        cursor: PageCursor | None,
        limit: int,
    ) -> Page[RideHistoryItem]:
        def participates(ride: RideRequest) -> bool:
            participant_id = (
                ride.driver_id if role is UserRole.DRIVER else ride.rider_id
            )
            return participant_id == user_id and ride.status in statuses

        rides = sorted(
            (ride for ride in self._rides.rides if participates(ride)),
            key=_created_order,
            reverse=True,
        )
        if cursor is not None:
            cursor_order = (_as_utc(cursor.created_at), cursor.id.int)
            rides = [ride for ride in rides if _created_order(ride) < cursor_order]
        has_more = len(rides) > limit
        rides = rides[:limit]
        items: list[RideHistoryItem] = []
        for ride in rides:
            offer = (
                await self._offers.get_by_id(ride.accepted_offer_id)
                if ride.accepted_offer_id is not None
                else None
            )
            counterpart_id = ride.rider_id if role is UserRole.DRIVER else ride.driver_id
            counterpart = (
                await self._users.get_by_id(counterpart_id)
                if counterpart_id is not None
                else None
            )
            rating = await self._ratings.get_by_ride_and_rater(ride.id, user_id)
            items.append(
                RideHistoryItem(
                    ride=ride,
                    counterpart=counterpart,
                    price=offer.price if offer is not None else ride.fare,
                    my_rating=rating.score if rating is not None else None,
                )
            )
        next_cursor = None
        if has_more and items:
            last = items[-1].ride
            if last.created_at is None:
                raise ValueError("Un viaje persistido debe tener created_at.")
            next_cursor = PageCursor(created_at=last.created_at, id=last.id)
        return Page(items=items, next_cursor=next_cursor)

    async def get_driver_earnings_summary(
        self,
        driver_id: uuid.UUID,
        day_start_utc: datetime,
        day_end_utc: datetime,
        recent_limit: int,
    ) -> DriverEarnings:
        completed = [
            ride
            for ride in self._rides.rides
            if ride.driver_id == driver_id and ride.status is RideStatus.COMPLETED
        ]

        completed.sort(
            key=lambda ride: (
                _as_utc(ride.completed_at or ride.created_at),
                _as_utc(ride.created_at),
                ride.id.int,
            ),
            reverse=True,
        )
        items: list[EarningsItem] = []
        for ride in completed:
            offer = (
                await self._offers.get_by_id(ride.accepted_offer_id)
                if ride.accepted_offer_id is not None
                else None
            )
            items.append(
                EarningsItem(
                    ride_id=ride.id,
                    destination_name=ride.destination.name,
                    price=offer.price if offer is not None else ride.fare,
                    completed_at=ride.completed_at or ride.created_at,
                )
            )
        total_today = Decimal("0")
        trips_today = 0
        for item in items:
            completed_at = _as_utc(item.completed_at)
            if day_start_utc <= completed_at < day_end_utc:
                total_today += item.price
                trips_today += 1
        return DriverEarnings(
            total_today=total_today,
            trips_today=trips_today,
            total_all_time=sum((item.price for item in items), start=Decimal("0")),
            trips_all_time=len(items),
            recent=items[:recent_limit],
        )


class InMemoryRatingSkipRepository(RatingSkipRepository):
    def __init__(self) -> None:
        self._skips: dict[tuple[uuid.UUID, uuid.UUID], RideRatingSkip] = {}

    async def get_by_ride_and_rater(
        self,
        ride_id: uuid.UUID,
        rater_id: uuid.UUID,
    ) -> RideRatingSkip | None:
        return self._skips.get((ride_id, rater_id))

    async def add_if_absent(self, skip: RideRatingSkip) -> RideRatingSkip:
        key = (skip.ride_id, skip.rater_id)
        existing = self._skips.get(key)
        if existing is not None:
            return existing
        if skip.created_at is None:
            skip.created_at = datetime.now(UTC)
        self._skips[key] = skip
        return skip


class InMemoryPendingRatingRepository(PendingRatingRepository):
    def __init__(
        self,
        rides: InMemoryRideRequestRepository,
        ratings: InMemoryRatingRepository,
        skips: InMemoryRatingSkipRepository | None = None,
    ) -> None:
        self._rides = rides
        self._ratings = ratings
        self._skips = skips

    async def get_latest_for(
        self,
        user_id: uuid.UUID,
        role: UserRole,
    ) -> RideRequest | None:
        pending: list[tuple[int, RideRequest]] = []
        for index, ride in enumerate(self._rides.rides):
            participant_id = ride.driver_id if role is UserRole.DRIVER else ride.rider_id
            if participant_id != user_id or ride.status is not RideStatus.COMPLETED:
                continue
            if await self._ratings.get_by_ride_and_rater(ride.id, user_id) is not None:
                continue
            if (
                self._skips is not None
                and await self._skips.get_by_ride_and_rater(ride.id, user_id) is not None
            ):
                continue
            pending.append((index, ride))
        if not pending:
            return None

        def order(item: tuple[int, RideRequest]) -> tuple[float, int]:
            index, ride = item
            timestamp = ride.completed_at or ride.created_at
            if timestamp is None:
                return (float("-inf"), index)
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=UTC)
            return (timestamp.timestamp(), index)

        return max(pending, key=order)[1]


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
