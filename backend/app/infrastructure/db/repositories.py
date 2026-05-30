"""Implementación SQLAlchemy del puerto ``UserRepository``."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities import AuthProvider, Location, RideRequest, User
from app.domain.repositories import RideRequestRepository, UserRepository
from app.infrastructure.db.models import RideRequestModel, UserModel


def _to_entity(row: UserModel) -> User:
    return User(
        id=row.id,
        full_name=row.full_name,
        email=row.email,
        phone=row.phone,
        hashed_password=row.hashed_password,
        auth_provider=row.auth_provider,
        provider_id=row.provider_id,
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
        )
        self._session.add(row)
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
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return _ride_to_entity(row)

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        row = await self._session.get(RideRequestModel, ride_id)
        return _ride_to_entity(row) if row else None

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
