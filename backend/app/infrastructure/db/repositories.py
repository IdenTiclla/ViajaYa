"""Implementación SQLAlchemy del puerto ``UserRepository``."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities import (
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
from app.domain.repositories import (
    OfferAcceptance,
    OfferRepository,
    RatingRepository,
    RideRequestRepository,
    SavedPlaceRepository,
    UserRepository,
)
from app.infrastructure.db.models import (
    OfferModel,
    RideRatingModel,
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

# Estado en el que una oferta sigue viva dentro de la negociación.
_ACTIVE_OFFER_STATUSES = (OfferStatus.PENDING,)


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
        created_at=row.created_at,
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
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _ride_to_entity(row)

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        row = await self._session.get(RideRequestModel, ride_id)
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
        await self._session.commit()
        await self._session.refresh(row)
        return _ride_to_entity(row)

    async def list_open_for_service(self, service_type: ServiceType) -> list[RideRequest]:
        result = await self._session.execute(
            select(RideRequestModel)
            .where(
                RideRequestModel.service_type == service_type,
                RideRequestModel.status == RideStatus.SEARCHING,
                RideRequestModel.paused.is_(False),
            )
            .order_by(RideRequestModel.created_at.desc())
        )
        return [_ride_to_entity(row) for row in result.scalars().all()]

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

    async def list_by_ride(self, ride_id: uuid.UUID) -> list[Offer]:
        result = await self._session.execute(
            select(OfferModel)
            .where(OfferModel.ride_id == ride_id)
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

    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        # Toda la asignación vive en UNA transacción. Bloqueamos en orden estable
        # (oferta → conductor → viaje) para evitar interbloqueos; el lock sobre la
        # fila del viaje (``with_for_update``) serializa dos ``accept`` del pasajero
        # (o un accept contra un cancel): el segundo ve el viaje ya ACCEPTED y
        # aborta (None). En SQLite (tests) ``FOR UPDATE`` es no-op; la garantía es
        # de Postgres.
        offer_row = (
            await self._session.execute(
                select(OfferModel).where(OfferModel.id == offer_id).with_for_update()
            )
        ).scalar_one_or_none()
        if offer_row is None or offer_row.status is not OfferStatus.PENDING:
            await self._session.rollback()
            return None

        driver_row = (
            await self._session.execute(
                select(UserModel)
                .where(UserModel.id == offer_row.driver_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if driver_row is None:
            await self._session.rollback()
            return None

        ride_row = (
            await self._session.execute(
                select(RideRequestModel)
                .where(RideRequestModel.id == offer_row.ride_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if ride_row is None or ride_row.status is not RideStatus.SEARCHING:
            await self._session.rollback()
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

    async def add(self, rating: RideRating) -> RideRating:
        row = RideRatingModel(
            id=rating.id,
            ride_id=rating.ride_id,
            rater_id=rating.rater_id,
            ratee_id=rating.ratee_id,
            score=rating.score,
            comment=rating.comment,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _rating_to_entity(row)

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
