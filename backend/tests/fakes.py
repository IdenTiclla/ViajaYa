"""Dobles de prueba en memoria para los puertos del dominio/aplicación."""

from __future__ import annotations

import uuid

from app.application.dto import SocialProfile
from app.application.interfaces import (
    PasswordHasher,
    SocialIdentityVerifier,
    TokenService,
)
from app.domain.entities import AuthProvider, Location, RideRequest, User
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import RideRequestRepository, UserRepository


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


class InMemoryRideRequestRepository(RideRequestRepository):
    def __init__(self) -> None:
        self.rides: list[RideRequest] = []

    async def add(self, ride: RideRequest) -> RideRequest:
        self.rides.append(ride)
        return ride

    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        return next((r for r in self.rides if r.id == ride_id), None)

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
