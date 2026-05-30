"""Puertos del dominio: interfaces que la infraestructura debe implementar.

Los casos de uso dependen de estas abstracciones, no de SQLAlchemy
(inversión de dependencias).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod

from app.domain.entities import AuthProvider, Location, RideRequest, SavedPlace, User


class UserRepository(ABC):
    @abstractmethod
    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        """Devuelve el usuario con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def get_by_email(self, email: str) -> User | None:
        """Devuelve el usuario con ese correo, o ``None`` si no existe."""

    @abstractmethod
    async def get_by_provider(self, provider: AuthProvider, provider_id: str) -> User | None:
        """Devuelve el usuario vinculado a una identidad externa, o ``None``."""

    @abstractmethod
    async def add(self, user: User) -> User:
        """Persiste un usuario nuevo y lo devuelve (con ``created_at`` poblado)."""


class RideRequestRepository(ABC):
    @abstractmethod
    async def add(self, ride: RideRequest) -> RideRequest:
        """Persiste una solicitud de viaje y la devuelve (con ``created_at``)."""

    @abstractmethod
    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        """Devuelve la solicitud con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def list_recent_destinations(
        self, rider_id: uuid.UUID, limit: int = 10
    ) -> list[Location]:
        """Destinos recientes y únicos del pasajero, del más nuevo al más viejo."""


class SavedPlaceRepository(ABC):
    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID) -> list[SavedPlace]:
        """Lugares guardados del usuario, del más reciente al más antiguo."""

    @abstractmethod
    async def get_by_id(self, place_id: uuid.UUID) -> SavedPlace | None:
        """Devuelve el lugar con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def add(self, place: SavedPlace) -> SavedPlace:
        """Persiste un lugar nuevo y lo devuelve (con timestamps poblados)."""

    @abstractmethod
    async def update(self, place: SavedPlace) -> SavedPlace:
        """Actualiza un lugar existente y lo devuelve."""

    @abstractmethod
    async def delete(self, place: SavedPlace) -> None:
        """Elimina el lugar."""
