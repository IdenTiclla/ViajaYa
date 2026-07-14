"""Implementación SQLAlchemy del puerto ``UserRepository``."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities import (
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
)
from app.domain.ride_policy import is_offer_expired
from app.infrastructure.db.models import (
    DriverRideDismissalModel,
    OfferModel,
    RideRatingModel,
    RideRatingSkipModel,
    RideRequestModel,
    SavedPlaceModel,
    UserModel,
)

# Estados en los que un conductor cuenta como "ocupado" (tiene un viaje activo).
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

# Estado en el que una oferta sigue viva dentro de la negociación.
_ACTIVE_OFFER_STATUSES = (OfferStatus.PENDING,)

_ACTIVE_RIDER_UNIQUE_INDEX = "uq_ride_requests_active_rider"


def _is_active_rider_unique_violation(exc: IntegrityError) -> bool:
    """Identifica únicamente la colisión del índice de viaje activo.

    Asyncpg expone el nombre de la restricción en la cadena de excepciones;
    SQLite, usado en los tests, informa las columnas de la clave duplicada.
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


def _to_entity(row: UserModel) -> User:
    return User(
        id=row.id,
        full_name=row.full_name,
        email=row.email,
        phone=row.phone,
        hashed_password=row.hashed_password,
        auth_provider=row.auth_provider,
        provider_id=row.provider_id,
        role=row.role,
        vehicle_type=row.vehicle_type,
        plate=row.plate,
        vehicle_model=row.vehicle_model,
        rating=row.rating,
        is_online=row.is_online,
        created_at=row.created_at,
    )


class SqlAlchemyUserRepository(UserRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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
            hashed_password=user.hashed_password,
            auth_provider=user.auth_provider,
            provider_id=user.provider_id,
            role=user.role,
            vehicle_type=user.vehicle_type,
            plate=user.plate,
            vehicle_model=user.vehicle_model,
            rating=user.rating,
            is_online=user.is_online,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _to_entity(row)

    async def update(self, user: User) -> User:
        row = await self._session.get(UserModel, user.id)
        if row is None:  # pragma: no cover - el caso de uso valida antes
            raise ValueError("user not found")
        row.full_name = user.full_name
        row.phone = user.phone
        row.role = user.role
        row.vehicle_type = user.vehicle_type
        row.plate = user.plate
        row.vehicle_model = user.vehicle_model
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
        if row is None:  # pragma: no cover - el caso de uso valida antes
            await self._session.rollback()
            raise ValueError("user not found")
        await self._session.commit()
        await self._session.refresh(row)
        return _to_entity(row)


def _ride_to_entity(row: RideRequestModel) -> RideRequest:
    return RideRequest(
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
        paused=row.paused,
        pool_version=row.pool_version,
        created_at=row.created_at,
        completed_at=row.completed_at,
        cancelled_at=row.cancelled_at,
    )


class SqlAlchemyRideRequestRepository(RideRequestRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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
            paused=ride.paused,
            pool_version=ride.pool_version,
            completed_at=ride.completed_at,
            cancelled_at=ride.cancelled_at,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _ride_to_entity(row)

    async def add_if_no_active(self, ride: RideRequest) -> RideRequest | None:
        # Serializar todas las altas del mismo pasajero sobre una fila que siempre
        # existe evita el clásico doble INSERT tras dos lecturas "sin activo".
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
        if row is None:  # pragma: no cover - el caso de uso valida antes
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
            await self._session.rollback()
            return None

        await self._session.commit()
        row = await self._session.get(RideRequestModel, ride.id, populate_existing=True)
        if row is None:  # pragma: no cover - el UPDATE acaba de devolver este id
            return None
        return _ride_to_entity(row)

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

    async def list_open_for_vehicle(self, vehicle_type: VehicleType) -> list[RideRequest]:
        compatible_services = services_for_vehicle(vehicle_type)
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

    async def list_open_with_rider_for_vehicle(
        self, vehicle_type: VehicleType, *, driver_id: uuid.UUID | None = None
    ) -> list[OpenRideDetail]:
        # Una sola query: JOIN con el pasajero + subquery correlacionada que cuenta
        # sus viajes completados. Así el pool de solicitudes (alto volumen, refresco
        # por polling + WS) se carga sin N+1. ``correlate(UserModel)`` fija la
        # correlación con la tabla exterior (evita el error de auto-correlación).
        trips_completed = (
            select(func.count(RideRequestModel.id))
            .where(
                RideRequestModel.rider_id == UserModel.id,
                RideRequestModel.status == RideStatus.COMPLETED,
            )
            .correlate(UserModel)
            .scalar_subquery()
        )
        compatible_services = services_for_vehicle(vehicle_type)
        statement = (
            select(RideRequestModel, UserModel, trips_completed)
            .join(UserModel, UserModel.id == RideRequestModel.rider_id)
            .where(
                RideRequestModel.service_type.in_(compatible_services),
                RideRequestModel.status == RideStatus.SEARCHING,
                RideRequestModel.paused.is_(False),
            )
            .order_by(RideRequestModel.created_at.desc())
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
        # Al pausar una solicitud, las ofertas vivas pasan a REJECTED. La pausa
        # actual permite distinguirla de un rechazo normal y recuperar el aviso
        # para este conductor al reconectar.
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
        # Solicitud + resumen del pasajero para publicar ``ride_created`` con los
        # datos del pasajero. Volumen bajo (una vez por creación/edición/aumento
        # de oferta): tres lecturas sencillas es aceptable.
        ride = await self.get_by_id(ride_id)
        if ride is None:
            return None
        rider = await self.rider_summary(ride.rider_id)
        if rider is None:
            return None
        return OpenRideDetail(ride=ride, rider=rider)

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
        # Trae las últimas solicitudes y deduplica destinos por coordenadas,
        # conservando el orden (del más reciente al más antiguo).
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
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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
        self, offer: Offer, *, expected_ride_fare: Decimal
    ) -> OfferCreation | None:
        # Mismo orden que accept_atomically: conductor -> ride -> oferta. El lock
        # del conductor serializa dos envíos simultáneos del mismo conductor.
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
            or not vehicle_can_serve(ride_row.service_type, driver_row.vehicle_type)
            or ride_row.fare != expected_ride_fare
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
        await self._session.commit()
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
        if row is None:  # pragma: no cover - el caso de uso valida antes
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
            await self._session.rollback()
            return None
        await self._session.commit()
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
        # Create/accept toman este mismo lock primero. Si offline gana, ambos ven
        # ``is_online=False``; si accept gana, el viaje activo impide desconectar.
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
            await self._session.rollback()
            return None

        offer_rows = (
            await self._session.execute(
                select(OfferModel)
                .where(
                    OfferModel.driver_id == driver_id,
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
        for row in offer_rows:
            row.status = OfferStatus.REJECTED
        driver_row.is_online = False
        await self._session.commit()
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
        await self._session.commit()
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
        await self._session.commit()
        return RideOffersTransition(
            ride=updated_ride,
            affected_offers=live_offers,
        )

    async def cancel_ride_on_disconnect_atomically(
        self, ride_id: uuid.UUID
    ) -> RideAutoCancellation | None:
        # El lock del viaje serializa este cierre contra accept/create/pause/cancel.
        # Las ofertas se leen y mutan antes del único commit: nunca queda un ride
        # CANCELLED con ofertas PENDING por una caída entre dos transacciones.
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

        await self._session.commit()
        await self._session.refresh(ride_row)
        return RideAutoCancellation(
            ride=_ride_to_entity(ride_row),
            cancelled_offers=live_offers,
        )

    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        # Toda la asignación vive en UNA transacción. Una lectura inicial obtiene
        # los ids inmutables; luego bloqueamos en el mismo orden que create/supersede
        # (conductor -> viaje -> oferta) para evitar interbloqueos. El lock sobre la
        # fila del viaje (``with_for_update``) serializa dos ``accept`` del pasajero
        # (o un accept contra un cancel): el segundo ve el viaje ya ACCEPTED y
        # aborta (None). En SQLite (tests) ``FOR UPDATE`` es no-op; la garantía es
        # de Postgres.
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
            or not vehicle_can_serve(ride_row.service_type, driver_row.vehicle_type)
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
        if is_offer_expired(_offer_to_entity(offer_row)):
            offer_row.status = OfferStatus.EXPIRED
            await self._session.commit()
            return None

        # El conductor debe estar libre: sin ningún viaje activo.
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

        # Otras ofertas vivas del conductor en OTRAS solicitudes: se retiran y se
        # avisa a esos pasajeros (excluimos la solicitud actual).
        others = (
            await self._session.execute(
                select(OfferModel.ride_id).where(
                    OfferModel.driver_id == driver_row.id,
                    OfferModel.id != offer_id,
                    OfferModel.status.in_(_ACTIVE_OFFER_STATUSES),
                )
            )
        ).scalars().all()
        withdrawn_ride_ids = [rid for rid in dict.fromkeys(others) if rid != ride_row.id]

        # Otros conductores con ofertas vivas en ESTE viaje: pierden la carrera y
        # hay que avisarles que el viaje ya fue tomado.
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

        # Aplicar: oferta elegida ACCEPTED; el resto del viaje y del conductor REJECTED.
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
        ride_row.driver_id = driver_row.id
        ride_row.accepted_offer_id = offer_row.id
        ride_row.status = RideStatus.ACCEPTED

        await self._session.commit()
        await self._session.refresh(offer_row)
        await self._session.refresh(ride_row)
        await self._session.refresh(driver_row)
        return OfferAcceptance(
            ride=_ride_to_entity(ride_row),
            accepted_offer=_offer_to_entity(offer_row),
            driver=_to_entity(driver_row),
            withdrawn_ride_ids=withdrawn_ride_ids,
            losing_driver_ids=losing_driver_ids,
        )

    async def mark_expired_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        # Vence la oferta solo si sigue PENDING y ya pasó su TTL (race-safe con un
        # accept/reject/withdraw/supersede simultáneo: esos la sacan de PENDING y
        # aquí no se toca). Bloqueo de fila para serializar contra accept_atomically.
        offer_row = (
            await self._session.execute(
                select(OfferModel).where(OfferModel.id == offer_id).with_for_update()
            )
        ).scalar_one_or_none()
        if (
            offer_row is None
            or offer_row.status is not OfferStatus.PENDING
            or not is_offer_expired(_offer_to_entity(offer_row))
        ):
            await self._session.rollback()
            return None
        offer_row.status = OfferStatus.EXPIRED
        await self._session.commit()
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
        # Todos los votos hacia una persona toman el mismo bloqueo. En READ
        # COMMITTED, el segundo promedio ve el commit anterior y no puede dejar
        # User.rating calculado desde un conjunto incompleto.
        locked_ratee_id = (
            await self._session.execute(
                select(UserModel.id)
                .where(UserModel.id == rating.ratee_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if locked_ratee_id is None:  # pragma: no cover - protegido por las FK del viaje
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
            if existing is None:  # pragma: no cover - la restricción fue otra
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
        if row is None:  # pragma: no cover - el caso de uso valida antes
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
