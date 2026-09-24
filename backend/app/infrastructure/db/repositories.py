"""SQLAlchemy implementation of the ``UserRepository`` port."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import case, func, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto import (
    DriverEarnings,
    EarningsItem,
    Page,
    PageCursor,
    RideDetail,
    RideHistoryItem,
)
from app.application.interfaces import RideReadRepository
from app.domain.entities import (
    AuthProvider,
    Location,
    Offer,
    OfferStatus,
    RideRating,
    RideRatingSkip,
    RideRequest,
    RideStatus,
    RideVehicleSnapshot,
    SavedPlace,
    ServiceType,
    User,
    UserRole,
    VehicleType,
    offered_services,
)
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
from app.infrastructure.db.clock import DatabaseClock, database_utc_now
from app.infrastructure.db.models import (
    DriverRideDismissalModel,
    DriverVehicleModel,
    OfferModel,
    RideRatingModel,
    RideRatingSkipModel,
    RideRequestModel,
    SavedPlaceModel,
    UserModel,
)

# Statuses in which a driver counts as "busy" (has an active ride).
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

# Status in which an offer is still live within the negotiation.
_ACTIVE_OFFER_STATUSES = (OfferStatus.PENDING,)

_ACTIVE_RIDER_UNIQUE_INDEX = "uq_ride_requests_active_rider"


def _is_active_rider_unique_violation(exc: IntegrityError) -> bool:
    """Identify only the active-ride index collision.

    Asyncpg exposes the constraint name in the exception chain;
    SQLite, used in tests, reports the columns of the duplicated key.
    """
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        message = str(current)
        if _ACTIVE_RIDER_UNIQUE_INDEX in message:
            return True
        if "UNIQUE constraint failed: ride_requests.rider_id" in message:
            return True

        diag = getattr(current, "diag", None)
        if getattr(diag, "constraint_name", None) == _ACTIVE_RIDER_UNIQUE_INDEX:
            return True
        if getattr(current, "constraint_name", None) == _ACTIVE_RIDER_UNIQUE_INDEX:
            return True

        current = current.__cause__ or current.__context__
    return False


def _row_offered_services(row: UserModel) -> tuple[ServiceType, ...]:
    """Services the driver row serves, with the legacy "whole vehicle" fallback."""

    return offered_services(
        row.vehicle_type,
        tuple(ServiceType(value) for value in row.driver_services),
    )


def _to_entity(row: UserModel) -> User:
    return User(
        id=row.id,
        full_name=row.full_name,
        email=row.email,
        phone=row.phone,
        auth_provider=row.auth_provider,
        provider_id=row.provider_id,
        role=row.role,
        vehicle_type=row.vehicle_type,
        plate=row.plate,
        vehicle_model=row.vehicle_model,
        driver_services=tuple(ServiceType(value) for value in row.driver_services),
        driver_status=row.driver_status,
        rating=row.rating,
        is_online=row.is_online,
        created_at=row.created_at,
        phone_verified_at=row.phone_verified_at,
        is_active=row.is_active,
    )


class SqlAlchemyUserRepository(UserRepository):
    def __init__(
        self,
        session: AsyncSession,
        *,
        commit_set_online: bool = True,
    ) -> None:
        self._session = session
        self._commit_set_online = commit_set_online

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        row = await self._session.get(UserModel, user_id)
        return _to_entity(row) if row else None

    async def get_by_email(self, email: str) -> User | None:
        result = await self._session.execute(
            select(UserModel).where(UserModel.email == email)
        )
        row = result.scalar_one_or_none()
        return _to_entity(row) if row else None

    async def get_by_provider(self, provider: AuthProvider, provider_id: str) -> User | None:
        result = await self._session.execute(
            select(UserModel).where(
                UserModel.auth_provider == provider,
                UserModel.provider_id == provider_id,
            )
        )
        row = result.scalar_one_or_none()
        return _to_entity(row) if row else None

    async def add(self, user: User) -> User:
        row = UserModel(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            phone=user.phone,
            auth_provider=user.auth_provider,
            provider_id=user.provider_id,
            role=user.role,
            vehicle_type=user.vehicle_type,
            plate=user.plate,
            vehicle_model=user.vehicle_model,
            driver_services=[service.value for service in user.driver_services],
            driver_status=user.driver_status,
            rating=user.rating,
            is_online=user.is_online,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _to_entity(row)

    async def update(self, user: User) -> User:
        row = await self._session.get(UserModel, user.id)
        if row is None:  # pragma: no cover - the use case validates first
            raise ValueError("user not found")
        row.full_name = user.full_name
        row.phone = user.phone
        row.role = user.role
        row.vehicle_type = user.vehicle_type
        row.plate = user.plate
        row.vehicle_model = user.vehicle_model
        row.driver_services = [service.value for service in user.driver_services]
        row.driver_status = user.driver_status
        row.rating = user.rating
        row.is_online = user.is_online
        await self._session.commit()
        await self._session.refresh(row)
        return _to_entity(row)

    async def set_online(self, user_id: uuid.UUID, is_online: bool) -> User:
        result = await self._session.execute(
            update(UserModel)
            .where(UserModel.id == user_id)
            .values(is_online=is_online)
            .returning(UserModel)
        )
        row = result.scalar_one_or_none()
        if row is None:  # pragma: no cover - the use case validates first
            if self._commit_set_online:
                await self._session.rollback()
            raise ValueError("user not found")
        if self._commit_set_online:
            await self._session.commit()
        else:
            await self._session.flush()
        await self._session.refresh(row)
        return _to_entity(row)


def _ride_to_entity(row: RideRequestModel) -> RideRequest:
    snapshot = row.vehicle_snapshot
    return RideRequest(
        vehicle_snapshot=RideVehicleSnapshot(
            vehicle_id=uuid.UUID(snapshot["vehicle_id"]) if snapshot.get("vehicle_id") else None,
            vehicle_type=(
                VehicleType(snapshot["vehicle_type"]) if snapshot.get("vehicle_type") else None
            ),
            plate=snapshot.get("plate"),
            vehicle_model=snapshot.get("vehicle_model"),
        ) if snapshot else None,
        id=row.id,
        rider_id=row.rider_id,
        origin=Location(
            latitude=row.origin_latitude,
            longitude=row.origin_longitude,
            name=row.origin_name,
            address=row.origin_address,
        ),
        destination=Location(
            latitude=row.destination_latitude,
            longitude=row.destination_longitude,
            name=row.destination_name,
            address=row.destination_address,
        ),
        service_type=row.service_type,
        fare=row.fare,
        payment_method=row.payment_method,
        status=row.status,
        driver_id=row.driver_id,
        accepted_offer_id=row.accepted_offer_id,
        rider_on_the_way_at=row.rider_on_the_way_at,
        paused=row.paused,
        pool_version=row.pool_version,
        created_at=row.created_at,
        completed_at=row.completed_at,
        cancelled_at=row.cancelled_at,
    )


class SqlAlchemyRideRequestRepository(RideRequestRepository):
    def __init__(
        self,
        session: AsyncSession,
        *,
        commit_add: bool = True,
        commit_update_if_state: bool = True,
    ) -> None:
        self._session = session
        self._commit_add = commit_add
        self._commit_update_if_state = commit_update_if_state

    async def add(self, ride: RideRequest) -> RideRequest:
        row = RideRequestModel(
            id=ride.id,
            rider_id=ride.rider_id,
            origin_latitude=ride.origin.latitude,
            origin_longitude=ride.origin.longitude,
            origin_name=ride.origin.name,
            origin_address=ride.origin.address,
            destination_latitude=ride.destination.latitude,
            destination_longitude=ride.destination.longitude,
            destination_name=ride.destination.name,
            destination_address=ride.destination.address,
            service_type=ride.service_type,
            fare=ride.fare,
            payment_method=ride.payment_method,
            status=ride.status,
            driver_id=ride.driver_id,
            accepted_offer_id=ride.accepted_offer_id,
            rider_on_the_way_at=ride.rider_on_the_way_at,
            vehicle_snapshot={
                "vehicle_id": (
                    str(ride.vehicle_snapshot.vehicle_id)
                    if ride.vehicle_snapshot.vehicle_id else None
                ),
                "vehicle_type": ride.vehicle_snapshot.vehicle_type,
                "plate": ride.vehicle_snapshot.plate,
                "vehicle_model": ride.vehicle_snapshot.vehicle_model,
            } if ride.vehicle_snapshot else None,
            paused=ride.paused,
            pool_version=ride.pool_version,
            completed_at=ride.completed_at,
            cancelled_at=ride.cancelled_at,
        )
        self._session.add(row)
        if self._commit_add:
            await self._session.commit()
        else:
            await self._session.flush()
        await self._session.refresh(row)
        return _ride_to_entity(row)

    async def add_if_no_active(self, ride: RideRequest) -> RideRequest | None:
        # Serializing all inserts of the same passenger on a row that always
        # exists avoids the classic double INSERT after two "no active ride" reads.
        await self._session.execute(
            select(UserModel.id).where(UserModel.id == ride.rider_id).with_for_update()
        )
        active = await self.get_active_by_rider(ride.rider_id)
        if active is not None:
            await self._session.rollback()
            return None
        try:
            return await self.add(ride)
        except IntegrityError as exc:
            await self._session.rollback()
            if _is_active_rider_unique_violation(exc):
                return None
            raise

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        row = await self._session.get(RideRequestModel, ride_id)
        return _ride_to_entity(row) if row else None

    async def get_active_by_rider(self, rider_id: uuid.UUID) -> RideRequest | None:
        result = await self._session.execute(
            select(RideRequestModel)
            .where(
                RideRequestModel.rider_id == rider_id,
                RideRequestModel.status.in_(_PASSENGER_ACTIVE_RIDE_STATUSES),
            )
            .order_by(RideRequestModel.created_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        return _ride_to_entity(row) if row else None

    async def update(self, ride: RideRequest) -> RideRequest:
        row = await self._session.get(RideRequestModel, ride.id)
        if row is None:  # pragma: no cover - the use case validates first
            raise ValueError("ride request not found")
        row.origin_latitude = ride.origin.latitude
        row.origin_longitude = ride.origin.longitude
        row.origin_name = ride.origin.name
        row.origin_address = ride.origin.address
        row.destination_latitude = ride.destination.latitude
        row.destination_longitude = ride.destination.longitude
        row.destination_name = ride.destination.name
        row.destination_address = ride.destination.address
        row.service_type = ride.service_type
        row.fare = ride.fare
        row.payment_method = ride.payment_method
        row.status = ride.status
        row.driver_id = ride.driver_id
        row.accepted_offer_id = ride.accepted_offer_id
        row.paused = ride.paused
        row.pool_version = ride.pool_version
        row.completed_at = ride.completed_at
        row.cancelled_at = ride.cancelled_at
        await self._session.commit()
        await self._session.refresh(row)
        return _ride_to_entity(row)

    async def update_if_state(
        self,
        ride: RideRequest,
        expected_status: RideStatus,
        *,
        expected_paused: bool | None = None,
        expected_fare: Decimal | None = None,
    ) -> RideRequest | None:
        completed_at = ride.completed_at
        cancelled_at = ride.cancelled_at
        now = datetime.now(UTC)
        if ride.status is RideStatus.COMPLETED and completed_at is None:
            completed_at = now
        if ride.status is RideStatus.CANCELLED and cancelled_at is None:
            cancelled_at = now

        conditions = [
            RideRequestModel.id == ride.id,
            RideRequestModel.status == expected_status,
        ]
        if expected_paused is not None:
            conditions.append(RideRequestModel.paused.is_(expected_paused))
        if expected_fare is not None:
            conditions.append(RideRequestModel.fare == expected_fare)

        result = await self._session.execute(
            update(RideRequestModel)
            .where(*conditions)
            .values(
                origin_latitude=ride.origin.latitude,
                origin_longitude=ride.origin.longitude,
                origin_name=ride.origin.name,
                origin_address=ride.origin.address,
                destination_latitude=ride.destination.latitude,
                destination_longitude=ride.destination.longitude,
                destination_name=ride.destination.name,
                destination_address=ride.destination.address,
                service_type=ride.service_type,
                fare=ride.fare,
                payment_method=ride.payment_method,
                status=ride.status,
                driver_id=ride.driver_id,
                accepted_offer_id=ride.accepted_offer_id,
                paused=ride.paused,
                pool_version=ride.pool_version,
                completed_at=completed_at,
                cancelled_at=cancelled_at,
            )
            .returning(RideRequestModel.id)
        )
        if result.scalar_one_or_none() is None:
            if self._commit_update_if_state:
                await self._session.rollback()
            return None

        if self._commit_update_if_state:
            await self._session.commit()
        else:
            await self._session.flush()
        row = await self._session.get(RideRequestModel, ride.id, populate_existing=True)
        if row is None:  # pragma: no cover - the UPDATE just returned this id
            return None
        return _ride_to_entity(row)

    async def mark_rider_on_the_way_if_arriving(
        self, ride_id: uuid.UUID, rider_id: uuid.UUID,
    ) -> tuple[RideRequest, bool] | None:
        row = (await self._session.execute(
            select(RideRequestModel).where(RideRequestModel.id == ride_id)
            .execution_options(populate_existing=True).with_for_update()
        )).scalar_one_or_none()
        if row is None or row.rider_id != rider_id:
            return None
        if row.rider_on_the_way_at is not None:
            return _ride_to_entity(row), False
        if row.status is not RideStatus.ARRIVING:
            return None
        row.rider_on_the_way_at = await database_utc_now(self._session)
        if self._commit_update_if_state:
            await self._session.commit()
        else:
            await self._session.flush()
        return _ride_to_entity(row), True

    async def cancel_if_searching(self, ride_id: uuid.UUID) -> RideRequest | None:
        row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(RideRequestModel.id == ride_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if (
            row is None
            or row.status is not RideStatus.SEARCHING
            or row.paused
        ):
            await self._session.rollback()
            return None

        row.status = RideStatus.CANCELLED
        row.cancelled_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(row)
        return _ride_to_entity(row)

    async def list_open_for_services(
        self, services: tuple[ServiceType, ...]
    ) -> list[RideRequest]:
        compatible_services = services
        result = await self._session.execute(
            select(RideRequestModel)
            .where(
                RideRequestModel.service_type.in_(compatible_services),
                RideRequestModel.status == RideStatus.SEARCHING,
                RideRequestModel.paused.is_(False),
            )
            .order_by(RideRequestModel.created_at.desc())
        )
        return [_ride_to_entity(row) for row in result.scalars().all()]

    async def list_open_with_rider_for_services(
        self,
        services: tuple[ServiceType, ...],
        *,
        driver_id: uuid.UUID | None = None,
        before_created_at: datetime | None = None,
        before_id: uuid.UUID | None = None,
        limit: int | None = None,
    ) -> list[OpenRideDetail]:
        # A single query: JOIN with the passenger + a correlated subquery that counts
        # their completed rides. This way the request pool (high volume, refreshed
        # by polling + WS) loads without N+1. ``correlate(UserModel)`` pins the
        # correlation to the outer table (avoids the auto-correlation error).
        trips_completed = (
            select(func.count(RideRequestModel.id))
            .where(
                RideRequestModel.rider_id == UserModel.id,
                RideRequestModel.status == RideStatus.COMPLETED,
            )
            .correlate(UserModel)
            .scalar_subquery()
        )
        compatible_services = services
        statement = (
            select(RideRequestModel, UserModel, trips_completed)
            .join(UserModel, UserModel.id == RideRequestModel.rider_id)
            .where(
                RideRequestModel.service_type.in_(compatible_services),
                RideRequestModel.status == RideStatus.SEARCHING,
                RideRequestModel.paused.is_(False),
            )
        )
        if driver_id is not None:
            statement = statement.outerjoin(
                DriverRideDismissalModel,
                (DriverRideDismissalModel.driver_id == driver_id)
                & (DriverRideDismissalModel.ride_id == RideRequestModel.id),
            ).where(
                or_(
                    DriverRideDismissalModel.ride_id.is_(None),
                    DriverRideDismissalModel.pool_version != RideRequestModel.pool_version,
                )
            )
        if (before_created_at is None) != (before_id is None):
            raise ValueError("The pool cursor requires a date and an id.")
        if before_created_at is not None and before_id is not None:
            created_key = RideRequestModel.created_at
            cursor_key = before_created_at
            if self._session.bind is not None and self._session.bind.dialect.name == "sqlite":
                # SQLite persists CURRENT_TIMESTAMP without fractions, but serializes
                # DateTime binds with ``.000000``. ``datetime`` makes both forms equal.
                created_key = func.datetime(created_key)
                cursor_key = func.datetime(cursor_key)
            statement = statement.where(
                tuple_(created_key, RideRequestModel.id) < tuple_(cursor_key, before_id)
            )
        statement = statement.order_by(
            RideRequestModel.created_at.desc(),
            RideRequestModel.id.desc(),
        )
        if limit is not None:
            statement = statement.limit(limit)
        result = await self._session.execute(statement)
        details: list[OpenRideDetail] = []
        for ride_row, user_row, trips in result.all():
            details.append(
                OpenRideDetail(
                    ride=_ride_to_entity(ride_row),
                    rider=RiderSummary(
                        full_name=user_row.full_name,
                        rating=user_row.rating,
                        trips_completed=int(trips or 0),
                    ),
                )
            )
        return details

    async def dismiss_open_ride_for_driver(
        self, driver_id: uuid.UUID, ride_id: uuid.UUID, pool_version: int
    ) -> None:
        row = (
            await self._session.execute(
                select(DriverRideDismissalModel).where(
                    DriverRideDismissalModel.driver_id == driver_id,
                    DriverRideDismissalModel.ride_id == ride_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            self._session.add(
                DriverRideDismissalModel(
                    driver_id=driver_id, ride_id=ride_id, pool_version=pool_version
                )
            )
        else:
            row.pool_version = pool_version
        await self._session.commit()

    async def list_paused_with_rider_for_driver(
        self, driver_id: uuid.UUID
    ) -> list[OpenRideDetail]:
        # When a request is paused, its live offers become REJECTED. The current
        # pause lets us tell it apart from a normal rejection and recover the notice
        # for this driver on reconnect.
        result = await self._session.execute(
            select(RideRequestModel)
            .join(OfferModel, OfferModel.ride_id == RideRequestModel.id)
            .where(
                OfferModel.driver_id == driver_id,
                RideRequestModel.status == RideStatus.SEARCHING,
                RideRequestModel.paused.is_(True),
            )
            .order_by(RideRequestModel.created_at.desc())
        )
        details: list[OpenRideDetail] = []
        for ride_row in result.scalars().unique().all():
            rider = await self.rider_summary(ride_row.rider_id)
            if rider is not None:
                details.append(OpenRideDetail(ride=_ride_to_entity(ride_row), rider=rider))
        return details

    async def rider_summary(self, rider_id: uuid.UUID) -> RiderSummary | None:
        trips_completed = (
            select(func.count(RideRequestModel.id))
            .where(
                RideRequestModel.rider_id == rider_id,
                RideRequestModel.status == RideStatus.COMPLETED,
            )
            .scalar_subquery()
        )
        result = await self._session.execute(
            select(UserModel, trips_completed).where(UserModel.id == rider_id)
        )
        row = result.first()
        if row is None:
            return None
        user_row, trips = row
        return RiderSummary(
            full_name=user_row.full_name,
            rating=user_row.rating,
            trips_completed=int(trips or 0),
        )

    async def open_ride_with_rider(self, ride_id: uuid.UUID) -> OpenRideDetail | None:
        # Request + passenger summary to publish ``ride_created`` with the
        # passenger's data. Low volume (once per creation/edit/fare
        # increase): three simple reads are acceptable.
        ride = await self.get_by_id(ride_id)
        if ride is None:
            return None
        rider = await self.rider_summary(ride.rider_id)
        if rider is None:
            return None
        return OpenRideDetail(ride=ride, rider=rider)

    async def lock_open_ride_with_rider_for_announcement(
        self, ride_id: uuid.UUID
    ) -> OpenRideDetail | None:
        row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(
                    RideRequestModel.id == ride_id,
                    RideRequestModel.status == RideStatus.SEARCHING,
                    RideRequestModel.paused.is_(False),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            return None

        rider = await self.rider_summary(row.rider_id)
        if rider is None:
            return None
        return OpenRideDetail(ride=_ride_to_entity(row), rider=rider)

    async def list_by_driver(self, driver_id: uuid.UUID) -> list[RideRequest]:
        result = await self._session.execute(
            select(RideRequestModel)
            .where(RideRequestModel.driver_id == driver_id)
            .order_by(RideRequestModel.created_at.desc())
        )
        return [_ride_to_entity(row) for row in result.scalars().all()]

    async def list_recent_destinations(
        self, rider_id: uuid.UUID, limit: int = 10
    ) -> list[Location]:
        # Load the latest requests and deduplicate destinations by coordinates,
        # keeping the order (most recent first).
        result = await self._session.execute(
            select(RideRequestModel)
            .where(RideRequestModel.rider_id == rider_id)
            .order_by(RideRequestModel.created_at.desc())
            .limit(50)
        )
        seen: set[tuple[float, float]] = set()
        destinations: list[Location] = []
        for row in result.scalars().all():
            key = (round(row.destination_latitude, 5), round(row.destination_longitude, 5))
            if key in seen:
                continue
            seen.add(key)
            destinations.append(
                Location(
                    latitude=row.destination_latitude,
                    longitude=row.destination_longitude,
                    name=row.destination_name,
                    address=row.destination_address,
                )
            )
            if len(destinations) >= limit:
                break
        return destinations

    async def list_history(
        self, user_id: uuid.UUID, role: UserRole, statuses: set[RideStatus]
    ) -> list[RideRequest]:
        field = (
            RideRequestModel.driver_id
            if role is UserRole.DRIVER
            else RideRequestModel.rider_id
        )
        result = await self._session.execute(
            select(RideRequestModel)
            .where(field == user_id, RideRequestModel.status.in_(statuses))
            .order_by(RideRequestModel.created_at.desc())
        )
        return [_ride_to_entity(row) for row in result.scalars().all()]


class SqlAlchemyRideReadRepository(RideReadRepository):
    """Enriched ride queries without writes or N+1 loads."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_active_for_driver(self, driver_id: uuid.UUID) -> RideDetail | None:
        result = await self._session.execute(
            select(RideRequestModel, UserModel, OfferModel)
            .join(UserModel, UserModel.id == RideRequestModel.rider_id)
            .outerjoin(OfferModel, OfferModel.id == RideRequestModel.accepted_offer_id)
            .where(
                RideRequestModel.driver_id == driver_id,
                RideRequestModel.status.in_(_ACTIVE_RIDE_STATUSES),
            )
            .order_by(
                RideRequestModel.created_at.desc(),
                RideRequestModel.id.desc(),
            )
            .limit(1)
        )
        row = result.first()
        if row is None:
            return None
        ride_row, rider_row, offer_row = row
        return RideDetail(
            ride=_ride_to_entity(ride_row),
            rider=_to_entity(rider_row),
            accepted_offer=_offer_to_entity(offer_row) if offer_row is not None else None,
        )

    async def list_history_items(
        self,
        user_id: uuid.UUID,
        role: UserRole,
        statuses: set[RideStatus],
        cursor: PageCursor | None,
        limit: int,
    ) -> Page[RideHistoryItem]:
        participant = (
            RideRequestModel.driver_id
            if role is UserRole.DRIVER
            else RideRequestModel.rider_id
        )
        counterpart_id = (
            RideRequestModel.rider_id
            if role is UserRole.DRIVER
            else RideRequestModel.driver_id
        )
        agreed_price = func.coalesce(OfferModel.price, RideRequestModel.fare)
        statement = (
            select(
                RideRequestModel,
                UserModel,
                agreed_price,
                RideRatingModel.score,
            )
            .outerjoin(UserModel, UserModel.id == counterpart_id)
            .outerjoin(OfferModel, OfferModel.id == RideRequestModel.accepted_offer_id)
            .outerjoin(
                RideRatingModel,
                (RideRatingModel.ride_id == RideRequestModel.id)
                & (RideRatingModel.rater_id == user_id),
            )
            .where(participant == user_id, RideRequestModel.status.in_(statuses))
            .order_by(
                RideRequestModel.created_at.desc(),
                RideRequestModel.id.desc(),
            )
            .limit(limit + 1)
        )
        if cursor is not None:
            created_key = RideRequestModel.created_at
            cursor_key = cursor.created_at
            if self._session.bind is not None and self._session.bind.dialect.name == "sqlite":
                created_key = func.datetime(created_key)
                cursor_key = func.datetime(cursor_key)
            statement = statement.where(
                tuple_(created_key, RideRequestModel.id) < tuple_(cursor_key, cursor.id)
            )
        result = await self._session.execute(statement)
        rows = result.all()
        has_more = len(rows) > limit
        items = [
            RideHistoryItem(
                ride=_ride_to_entity(ride_row),
                counterpart=_to_entity(counterpart_row) if counterpart_row is not None else None,
                price=Decimal(str(price)),
                my_rating=score,
            )
            for ride_row, counterpart_row, price, score in rows[:limit]
        ]
        next_cursor = None
        if has_more and items:
            last = items[-1].ride
            if last.created_at is None:  # pragma: no cover - la BD no permite NULL
                raise ValueError("A persisted ride must have created_at.")
            next_cursor = PageCursor(created_at=last.created_at, id=last.id)
        return Page(items=items, next_cursor=next_cursor)

    async def get_driver_earnings_summary(
        self,
        driver_id: uuid.UUID,
        day_start_utc: datetime,
        day_end_utc: datetime,
        recent_limit: int,
    ) -> DriverEarnings:
        agreed_price = func.coalesce(OfferModel.price, RideRequestModel.fare)
        completed_at = func.coalesce(
            RideRequestModel.completed_at,
            RideRequestModel.created_at,
        )
        completed_key = completed_at
        day_start_key = day_start_utc
        day_end_key = day_end_utc
        if self._session.bind is not None and self._session.bind.dialect.name == "sqlite":
            completed_key = func.datetime(completed_key)
            day_start_key = func.datetime(day_start_key)
            day_end_key = func.datetime(day_end_key)
        today = (completed_key >= day_start_key) & (completed_key < day_end_key)
        totals = (
            await self._session.execute(
                select(
                    func.coalesce(func.sum(agreed_price), Decimal("0")),
                    func.count(RideRequestModel.id),
                    func.coalesce(
                        func.sum(case((today, agreed_price), else_=Decimal("0"))),
                        Decimal("0"),
                    ),
                    func.coalesce(func.sum(case((today, 1), else_=0)), 0),
                )
                .select_from(RideRequestModel)
                .outerjoin(OfferModel, OfferModel.id == RideRequestModel.accepted_offer_id)
                .where(
                    RideRequestModel.driver_id == driver_id,
                    RideRequestModel.status == RideStatus.COMPLETED,
                )
            )
        ).one()
        recent_result = await self._session.execute(
            select(
                RideRequestModel.id,
                RideRequestModel.destination_name,
                agreed_price,
                completed_at,
            )
            .outerjoin(OfferModel, OfferModel.id == RideRequestModel.accepted_offer_id)
            .where(
                RideRequestModel.driver_id == driver_id,
                RideRequestModel.status == RideStatus.COMPLETED,
            )
            .order_by(
                completed_at.desc(),
                RideRequestModel.created_at.desc(),
                RideRequestModel.id.desc(),
            )
            .limit(recent_limit)
        )
        recent = [
            EarningsItem(
                ride_id=ride_id,
                destination_name=destination_name,
                price=Decimal(str(price)),
                completed_at=finished_at,
            )
            for ride_id, destination_name, price, finished_at in recent_result.all()
        ]
        total_all, trips_all, total_today, trips_today = totals
        return DriverEarnings(
            total_today=Decimal(str(total_today or 0)),
            trips_today=int(trips_today or 0),
            total_all_time=Decimal(str(total_all or 0)),
            trips_all_time=int(trips_all or 0),
            recent=recent,
        )


class SqlAlchemyPendingRatingRepository(PendingRatingRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_latest_for(
        self,
        user_id: uuid.UUID,
        role: UserRole,
    ) -> RideRequest | None:
        participant = (
            RideRequestModel.driver_id
            if role is UserRole.DRIVER
            else RideRequestModel.rider_id
        )
        already_rated = (
            select(RideRatingModel.id)
            .where(
                RideRatingModel.ride_id == RideRequestModel.id,
                RideRatingModel.rater_id == user_id,
            )
            .exists()
        )
        already_skipped = (
            select(RideRatingSkipModel.id)
            .where(
                RideRatingSkipModel.ride_id == RideRequestModel.id,
                RideRatingSkipModel.rater_id == user_id,
            )
            .exists()
        )
        result = await self._session.execute(
            select(RideRequestModel)
            .where(
                participant == user_id,
                RideRequestModel.status == RideStatus.COMPLETED,
                ~already_rated,
                ~already_skipped,
            )
            .order_by(
                func.coalesce(
                    RideRequestModel.completed_at,
                    RideRequestModel.created_at,
                ).desc()
            )
            .limit(1)
        )
        row = result.scalar_one_or_none()
        return _ride_to_entity(row) if row else None


def _offer_to_entity(row: OfferModel) -> Offer:
    return Offer(
        id=row.id,
        ride_id=row.ride_id,
        driver_id=row.driver_id,
        price=row.price,
        eta_min=row.eta_min,
        status=row.status,
        created_at=row.created_at,
    )


class SqlAlchemyOfferRepository(OfferRepository):
    def __init__(
        self,
        session: AsyncSession,
        *,
        commit_create_or_supersede: bool = True,
        commit_accept: bool = True,
        commit_pause: bool = True,
        commit_cancel: bool = True,
        commit_reject_if_pending: bool = True,
        commit_mark_expired_if_pending: bool = True,
        commit_set_driver_offline: bool = True,
        clock: DatabaseClock = database_utc_now,
    ) -> None:
        self._session = session
        # Incremental migration: these mutations take part in the UoW; the other
        # methods still keep their internal commits.
        self._commit_create_or_supersede = commit_create_or_supersede
        self._commit_accept = commit_accept
        self._commit_pause = commit_pause
        self._commit_cancel = commit_cancel
        self._commit_reject_if_pending = commit_reject_if_pending
        self._commit_mark_expired_if_pending = commit_mark_expired_if_pending
        self._commit_set_driver_offline = commit_set_driver_offline
        self._clock = clock

    async def add(self, offer: Offer) -> Offer:
        row = OfferModel(
            id=offer.id,
            ride_id=offer.ride_id,
            driver_id=offer.driver_id,
            price=offer.price,
            eta_min=offer.eta_min,
            status=offer.status,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _offer_to_entity(row)

    async def create_or_supersede_atomically(
        self, offer: Offer, *, expected_ride_fare: Decimal,
        expected_pool_version: int | None = None,
    ) -> OfferCreation | None:
        # Same order as accept_atomically: driver -> ride -> offer. The driver's
        # lock serializes two simultaneous submissions from the same driver.
        driver_row = (
            await self._session.execute(
                select(UserModel)
                .where(UserModel.id == offer.driver_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            driver_row is None
            or driver_row.role is not UserRole.DRIVER
            or driver_row.vehicle_type is None
            or not driver_row.is_online
        ):
            if self._commit_create_or_supersede:
                await self._session.rollback()
            return None

        ride_row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(RideRequestModel.id == offer.ride_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            ride_row is None
            or ride_row.status is not RideStatus.SEARCHING
            or ride_row.paused
            or ride_row.service_type not in _row_offered_services(driver_row)
            or ride_row.fare != expected_ride_fare
            or (
                expected_pool_version is not None
                and ride_row.pool_version != expected_pool_version
            )
        ):
            await self._session.rollback()
            return None

        busy = (
            await self._session.execute(
                select(RideRequestModel.id)
                .where(
                    RideRequestModel.driver_id == driver_row.id,
                    RideRequestModel.status.in_(_ACTIVE_RIDE_STATUSES),
                )
                .limit(1)
            )
        ).first()
        if busy is not None:
            await self._session.rollback()
            return None

        previous_rows = (
            await self._session.execute(
                select(OfferModel)
                .where(
                    OfferModel.ride_id == offer.ride_id,
                    OfferModel.driver_id == offer.driver_id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                )
                .order_by(OfferModel.created_at.desc())
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        superseded_offer_id = previous_rows[0].id if previous_rows else None
        for previous in previous_rows:
            previous.status = OfferStatus.REJECTED

        row = OfferModel(
            id=offer.id,
            ride_id=offer.ride_id,
            driver_id=offer.driver_id,
            price=offer.price,
            eta_min=offer.eta_min,
            status=offer.status,
        )
        self._session.add(row)
        if self._commit_create_or_supersede:
            await self._session.commit()
        else:
            await self._session.flush()
        await self._session.refresh(row)
        return OfferCreation(
            offer=_offer_to_entity(row),
            superseded_offer_id=superseded_offer_id,
        )

    async def get_by_id(self, offer_id: uuid.UUID) -> Offer | None:
        row = await self._session.get(OfferModel, offer_id)
        return _offer_to_entity(row) if row else None

    async def update(self, offer: Offer) -> Offer:
        row = await self._session.get(OfferModel, offer.id)
        if row is None:  # pragma: no cover - the use case validates first
            raise ValueError("offer not found")
        row.status = offer.status
        row.price = offer.price
        row.eta_min = offer.eta_min
        await self._session.commit()
        await self._session.refresh(row)
        return _offer_to_entity(row)

    async def reject_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        result = await self._session.execute(
            update(OfferModel)
            .where(
                OfferModel.id == offer_id,
                OfferModel.status == OfferStatus.PENDING,
            )
            .values(status=OfferStatus.REJECTED)
            .returning(OfferModel.id)
        )
        if result.scalar_one_or_none() is None:
            if self._commit_reject_if_pending:
                await self._session.rollback()
            return None
        if self._commit_reject_if_pending:
            await self._session.commit()
        else:
            await self._session.flush()
        row = await self._session.get(OfferModel, offer_id, populate_existing=True)
        return _offer_to_entity(row) if row else None

    async def list_by_ride(self, ride_id: uuid.UUID) -> list[Offer]:
        result = await self._session.execute(
            select(OfferModel)
            .where(OfferModel.ride_id == ride_id)
            .order_by(OfferModel.created_at.desc())
        )
        return [_offer_to_entity(row) for row in result.scalars().all()]

    async def list_active_by_driver(self, driver_id: uuid.UUID) -> list[Offer]:
        result = await self._session.execute(
            select(OfferModel)
            .where(
                OfferModel.driver_id == driver_id,
                OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
            )
            .order_by(OfferModel.created_at.desc())
        )
        return [_offer_to_entity(row) for row in result.scalars().all()]

    async def get_active_by_driver_and_ride(
        self, ride_id: uuid.UUID, driver_id: uuid.UUID
    ) -> Offer | None:
        result = await self._session.execute(
            select(OfferModel)
            .where(
                OfferModel.ride_id == ride_id,
                OfferModel.driver_id == driver_id,
                OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
            )
            .order_by(OfferModel.created_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        return _offer_to_entity(row) if row else None

    async def reject_others(self, ride_id: uuid.UUID, keep_offer_id: uuid.UUID) -> None:
        await self._session.execute(
            update(OfferModel)
            .where(
                OfferModel.ride_id == ride_id,
                OfferModel.id != keep_offer_id,
                OfferModel.status == OfferStatus.PENDING,
            )
            .values(status=OfferStatus.REJECTED)
        )
        await self._session.commit()

    async def reject_pending(self, ride_id: uuid.UUID) -> None:
        await self._session.execute(
            update(OfferModel)
            .where(
                OfferModel.ride_id == ride_id,
                OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
            )
            .values(status=OfferStatus.REJECTED)
        )
        await self._session.commit()

    async def set_driver_offline_atomically(
        self, driver_id: uuid.UUID
    ) -> DriverOfflineTransition | None:
        # Create/accept take this same lock first. If going offline wins, both see
        # ``is_online=False``; if accept wins, the active ride prevents going offline.
        driver_row = (
            await self._session.execute(
                select(UserModel)
                .where(UserModel.id == driver_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            driver_row is None
            or driver_row.role is not UserRole.DRIVER
            or driver_row.vehicle_type is None
        ):
            if self._commit_set_driver_offline:
                await self._session.rollback()
            return None

        active_ride = (
            await self._session.execute(
                select(RideRequestModel.id)
                .where(
                    RideRequestModel.driver_id == driver_id,
                    RideRequestModel.status.in_(_ACTIVE_RIDE_STATUSES),
                )
                .limit(1)
            )
        ).first()
        if active_ride is not None:
            if self._commit_set_driver_offline:
                await self._session.rollback()
            return None

        offer_rows = (
            await self._session.execute(
                select(OfferModel)
                .where(
                    OfferModel.driver_id == driver_id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                )
                .order_by(OfferModel.created_at.desc(), OfferModel.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        live_offers = [
            offer
            for row in offer_rows
            if not is_offer_expired(offer := _offer_to_entity(row))
        ]
        for row in offer_rows:
            row.status = OfferStatus.REJECTED
        driver_row.is_online = False
        if self._commit_set_driver_offline:
            await self._session.commit()
        else:
            await self._session.flush()
        await self._session.refresh(driver_row)
        return DriverOfflineTransition(
            driver=_to_entity(driver_row),
            withdrawn_offers=live_offers,
        )

    async def cancel_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_status: RideStatus,
        expected_paused: bool,
    ) -> RideOffersTransition | None:
        ride_row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(RideRequestModel.id == ride_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            ride_row is None
            or ride_row.status is not expected_status
            or ride_row.paused is not expected_paused
        ):
            await self._session.rollback()
            return None

        offer_rows = (
            await self._session.execute(
                select(OfferModel)
                .where(
                    OfferModel.ride_id == ride_id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                )
                .order_by(OfferModel.created_at.desc())
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        live_offers = [
            offer
            for row in offer_rows
            if not is_offer_expired(offer := _offer_to_entity(row))
        ]

        ride_row.status = RideStatus.CANCELLED
        ride_row.cancelled_at = datetime.now(UTC)
        for row in offer_rows:
            row.status = OfferStatus.REJECTED

        updated_ride = _ride_to_entity(ride_row)
        if self._commit_cancel:
            await self._session.commit()
        else:
            await self._session.flush()
        return RideOffersTransition(
            ride=updated_ride,
            affected_offers=live_offers,
        )

    async def pause_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_fare: Decimal,
    ) -> RideOffersTransition | None:
        ride_row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(RideRequestModel.id == ride_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            ride_row is None
            or ride_row.status is not RideStatus.SEARCHING
            or ride_row.paused
            or ride_row.fare != expected_fare
        ):
            await self._session.rollback()
            return None

        offer_rows = (
            await self._session.execute(
                select(OfferModel)
                .where(
                    OfferModel.ride_id == ride_id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                )
                .order_by(OfferModel.created_at.desc())
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        live_offers = [
            offer
            for row in offer_rows
            if not is_offer_expired(offer := _offer_to_entity(row))
        ]

        ride_row.paused = True
        for row in offer_rows:
            row.status = OfferStatus.REJECTED

        updated_ride = _ride_to_entity(ride_row)
        if self._commit_pause:
            await self._session.commit()
        else:
            await self._session.flush()
        return RideOffersTransition(
            ride=updated_ride,
            affected_offers=live_offers,
        )

    async def cancel_ride_on_disconnect_atomically(
        self, ride_id: uuid.UUID
    ) -> RideAutoCancellation | None:
        # The ride lock serializes this close against accept/create/pause/cancel.
        # Offers are read and mutated before the single commit: a ride is never left
        # CANCELLED with PENDING offers because of a crash between two transactions.
        ride_row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(RideRequestModel.id == ride_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            ride_row is None
            or ride_row.status is not RideStatus.SEARCHING
            or ride_row.paused
        ):
            await self._session.rollback()
            return None

        offer_rows = (
            await self._session.execute(
                select(OfferModel)
                .where(
                    OfferModel.ride_id == ride_id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                )
                .order_by(OfferModel.created_at.desc())
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        live_offers = [
            offer
            for row in offer_rows
            if not is_offer_expired(offer := _offer_to_entity(row))
        ]

        ride_row.status = RideStatus.CANCELLED
        ride_row.cancelled_at = datetime.now(UTC)
        for row in offer_rows:
            row.status = OfferStatus.REJECTED

        if self._commit_cancel:
            await self._session.commit()
            await self._session.refresh(ride_row)
        else:
            await self._session.flush()
        return RideAutoCancellation(
            ride=_ride_to_entity(ride_row),
            cancelled_offers=live_offers,
        )

    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        # The whole assignment lives in ONE transaction. An initial read gets
        # the immutable ids; then we lock in the same order as create/supersede
        # (driver -> ride -> offer) to avoid deadlocks. The lock on the
        # ride row (``with_for_update``) serializes two passenger ``accept`` calls
        # (or an accept against a cancel): the second one sees the ride already ACCEPTED and
        # aborts (None). On SQLite (tests) ``FOR UPDATE`` is a no-op; the guarantee comes
        # from Postgres.
        offer_ref = await self._session.get(OfferModel, offer_id)
        if offer_ref is None:
            await self._session.rollback()
            return None

        driver_row = (
            await self._session.execute(
                select(UserModel)
                .where(UserModel.id == offer_ref.driver_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            driver_row is None
            or driver_row.role is not UserRole.DRIVER
            or driver_row.vehicle_type is None
            or not driver_row.is_online
        ):
            await self._session.rollback()
            return None

        ride_row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(RideRequestModel.id == offer_ref.ride_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if (
            ride_row is None
            or ride_row.status is not RideStatus.SEARCHING
            or ride_row.paused
            or ride_row.service_type not in _row_offered_services(driver_row)
        ):
            await self._session.rollback()
            return None

        offer_row = (
            await self._session.execute(
                select(OfferModel)
                .where(OfferModel.id == offer_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if offer_row is None or offer_row.status is not OfferStatus.PENDING:
            await self._session.rollback()
            return None
        # The monetary decision is made with the same authoritative clock as the
        # scheduler and after acquiring all of the acceptance's locks.
        now = (
            await self._clock(self._session)
            if self._session.get_bind().dialect.name == "postgresql"
            else datetime.now(UTC)
        )
        if is_offer_expired(_offer_to_entity(offer_row), now):
            # Expiry has its own use case. In the acceptance UoW mode a
            # side effect is never committed without its durable event.
            if self._commit_accept:
                offer_row.status = OfferStatus.EXPIRED
                await self._session.commit()
            return None

        # The driver must be free: no active ride at all.
        busy = (
            await self._session.execute(
                select(RideRequestModel.id)
                .where(
                    RideRequestModel.driver_id == driver_row.id,
                    RideRequestModel.status.in_(_ACTIVE_RIDE_STATUSES),
                )
                .limit(1)
            )
        ).first()
        if busy is not None:
            await self._session.rollback()
            return None

        # The driver's other live offers on OTHER requests: they are withdrawn and
        # those passengers are notified (we exclude the current request).
        others = (
            await self._session.execute(
                select(OfferModel.id, OfferModel.ride_id).where(
                    OfferModel.driver_id == driver_row.id,
                    OfferModel.id != offer_id,
                    OfferModel.ride_id != ride_row.id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                ).order_by(OfferModel.ride_id, OfferModel.id)
            )
        ).all()
        withdrawn_offers = [
            WithdrawnOfferReference(ride_id=row.ride_id, offer_id=row.id)
            for row in others
        ]

        # Other drivers with live offers on THIS ride: they lose the race and
        # must be told the ride was already taken.
        losers = (
            await self._session.execute(
                select(OfferModel.driver_id).where(
                    OfferModel.ride_id == ride_row.id,
                    OfferModel.id != offer_id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                )
            )
        ).scalars().all()
        losing_driver_ids = [
            did for did in dict.fromkeys(losers) if did != driver_row.id
        ]

        # Apply: the chosen offer becomes ACCEPTED; the ride's and driver's others, REJECTED.
        offer_row.status = OfferStatus.ACCEPTED
        await self._session.execute(
            update(OfferModel)
            .where(
                OfferModel.id != offer_id,
                OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                (OfferModel.ride_id == ride_row.id)
                | (OfferModel.driver_id == driver_row.id),
            )
            .values(status=OfferStatus.REJECTED)
        )
        vehicle_id = await self._session.scalar(
            select(DriverVehicleModel.id).where(
                DriverVehicleModel.user_id == driver_row.id,
                DriverVehicleModel.vehicle_type == driver_row.vehicle_type,
            )
        )
        # The driver row is locked by this transaction, also serializing vehicle
        # switching. Store the snapshot before the assignment and outbox commit.
        ride_row.vehicle_snapshot = {
            "vehicle_id": str(vehicle_id) if vehicle_id else None,
            "vehicle_type": driver_row.vehicle_type,
            "plate": driver_row.plate,
            "vehicle_model": driver_row.vehicle_model,
        }
        ride_row.driver_id = driver_row.id
        ride_row.accepted_offer_id = offer_row.id
        ride_row.status = RideStatus.ACCEPTED

        if self._commit_accept:
            await self._session.commit()
        else:
            await self._session.flush()
        await self._session.refresh(offer_row)
        await self._session.refresh(ride_row)
        await self._session.refresh(driver_row)
        return OfferAcceptance(
            ride=_ride_to_entity(ride_row),
            accepted_offer=_offer_to_entity(offer_row),
            driver=_to_entity(driver_row),
            withdrawn_offers=withdrawn_offers,
            losing_driver_ids=losing_driver_ids,
        )

    async def mark_expired_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        # Expire the offer only if it is still PENDING and past its TTL (race-safe against a
        # simultaneous accept/reject/withdraw/supersede: those take it out of PENDING and
        # it is not touched here). Row lock to serialize against accept_atomically.
        offer_row = (
            await self._session.execute(
                select(OfferModel)
                .where(OfferModel.id == offer_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if offer_row is None or offer_row.status is not OfferStatus.PENDING:
            if self._commit_mark_expired_if_pending:
                await self._session.rollback()
            return None

        # It must be read after the ``FOR UPDATE``. If this query waited on
        # another transaction, using the transaction start could treat as
        # fresh an offer whose TTL expired while waiting for the lock.
        now = await self._clock(self._session)
        if not is_offer_expired(_offer_to_entity(offer_row), now):
            if self._commit_mark_expired_if_pending:
                await self._session.rollback()
            return None
        offer_row.status = OfferStatus.EXPIRED
        if self._commit_mark_expired_if_pending:
            await self._session.commit()
        else:
            await self._session.flush()
        await self._session.refresh(offer_row)
        return _offer_to_entity(offer_row)


def _rating_to_entity(row: RideRatingModel) -> RideRating:
    return RideRating(
        id=row.id,
        ride_id=row.ride_id,
        rater_id=row.rater_id,
        ratee_id=row.ratee_id,
        score=row.score,
        comment=row.comment,
        created_at=row.created_at,
    )


class SqlAlchemyRatingRepository(RatingRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add_and_recompute(self, rating: RideRating) -> RideRating | None:
        # All votes for a person take the same lock. Under READ
        # COMMITTED, the second average sees the previous commit and cannot leave
        # User.rating computed from an incomplete set.
        locked_ratee_id = (
            await self._session.execute(
                select(UserModel.id)
                .where(UserModel.id == rating.ratee_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if locked_ratee_id is None:  # pragma: no cover - protected by the ride's FKs
            await self._session.rollback()
            raise ValueError("ratee not found")

        row = RideRatingModel(
            id=rating.id,
            ride_id=rating.ride_id,
            rater_id=rating.rater_id,
            ratee_id=rating.ratee_id,
            score=rating.score,
            comment=rating.comment,
        )
        self._session.add(row)
        try:
            await self._session.flush()

            average = (
                await self._session.execute(
                    select(func.avg(RideRatingModel.score)).where(
                        RideRatingModel.ratee_id == rating.ratee_id
                    )
                )
            ).scalar_one()
            await self._session.execute(
                update(UserModel)
                .where(UserModel.id == rating.ratee_id)
                .values(rating=round(float(average), 2))
            )
            await self._session.refresh(row)
            saved = _rating_to_entity(row)
            await self._session.commit()
            return saved
        except IntegrityError:
            await self._session.rollback()
            duplicate = await self.get_by_ride_and_rater(
                rating.ride_id,
                rating.rater_id,
            )
            if duplicate is not None:
                return None
            raise

    async def get_by_ride_and_rater(
        self, ride_id: uuid.UUID, rater_id: uuid.UUID
    ) -> RideRating | None:
        result = await self._session.execute(
            select(RideRatingModel).where(
                RideRatingModel.ride_id == ride_id,
                RideRatingModel.rater_id == rater_id,
            )
        )
        row = result.scalar_one_or_none()
        return _rating_to_entity(row) if row else None

    async def list_by_ratee(self, ratee_id: uuid.UUID) -> list[RideRating]:
        result = await self._session.execute(
            select(RideRatingModel)
            .where(RideRatingModel.ratee_id == ratee_id)
            .order_by(RideRatingModel.created_at.desc())
        )
        return [_rating_to_entity(row) for row in result.scalars().all()]

    async def average_for(self, ratee_id: uuid.UUID) -> float | None:
        result = await self._session.execute(
            select(func.avg(RideRatingModel.score)).where(
                RideRatingModel.ratee_id == ratee_id
            )
        )
        avg = result.scalar_one_or_none()
        return float(avg) if avg is not None else None


def _rating_skip_to_entity(row: RideRatingSkipModel) -> RideRatingSkip:
    return RideRatingSkip(
        id=row.id,
        ride_id=row.ride_id,
        rater_id=row.rater_id,
        created_at=row.created_at,
    )


class SqlAlchemyRatingSkipRepository(RatingSkipRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_ride_and_rater(
        self,
        ride_id: uuid.UUID,
        rater_id: uuid.UUID,
    ) -> RideRatingSkip | None:
        result = await self._session.execute(
            select(RideRatingSkipModel).where(
                RideRatingSkipModel.ride_id == ride_id,
                RideRatingSkipModel.rater_id == rater_id,
            )
        )
        row = result.scalar_one_or_none()
        return _rating_skip_to_entity(row) if row else None

    async def add_if_absent(self, skip: RideRatingSkip) -> RideRatingSkip:
        existing = await self.get_by_ride_and_rater(skip.ride_id, skip.rater_id)
        if existing is not None:
            return existing

        row = RideRatingSkipModel(
            id=skip.id,
            ride_id=skip.ride_id,
            rater_id=skip.rater_id,
        )
        self._session.add(row)
        try:
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self.get_by_ride_and_rater(skip.ride_id, skip.rater_id)
            if existing is None:  # pragma: no cover - it was a different constraint
                raise
            return existing
        await self._session.refresh(row)
        return _rating_skip_to_entity(row)


def _saved_place_to_entity(row: SavedPlaceModel) -> SavedPlace:
    return SavedPlace(
        id=row.id,
        user_id=row.user_id,
        label=row.label,
        category=row.category,
        location=Location(
            latitude=row.latitude,
            longitude=row.longitude,
            name=row.name,
            address=row.address,
        ),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class SqlAlchemySavedPlaceRepository(SavedPlaceRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_by_user(self, user_id: uuid.UUID) -> list[SavedPlace]:
        result = await self._session.execute(
            select(SavedPlaceModel)
            .where(SavedPlaceModel.user_id == user_id)
            .order_by(SavedPlaceModel.created_at.desc())
        )
        return [_saved_place_to_entity(row) for row in result.scalars().all()]

    async def get_by_id(self, place_id: uuid.UUID) -> SavedPlace | None:
        row = await self._session.get(SavedPlaceModel, place_id)
        return _saved_place_to_entity(row) if row else None

    async def add(self, place: SavedPlace) -> SavedPlace:
        row = SavedPlaceModel(
            id=place.id,
            user_id=place.user_id,
            label=place.label,
            category=place.category,
            latitude=place.location.latitude,
            longitude=place.location.longitude,
            name=place.location.name,
            address=place.location.address,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _saved_place_to_entity(row)

    async def update(self, place: SavedPlace) -> SavedPlace:
        row = await self._session.get(SavedPlaceModel, place.id)
        if row is None:  # pragma: no cover - the use case validates first
            raise ValueError("saved place not found")
        row.label = place.label
        row.category = place.category
        row.latitude = place.location.latitude
        row.longitude = place.location.longitude
        row.name = place.location.name
        row.address = place.location.address
        await self._session.commit()
        await self._session.refresh(row)
        return _saved_place_to_entity(row)

    async def delete(self, place: SavedPlace) -> None:
        row = await self._session.get(SavedPlaceModel, place.id)
        if row is not None:
            await self._session.delete(row)
            await self._session.commit()
