"""Puertos de la capa de aplicación.

Abstracciones de servicios técnicos (hash, tokens, verificación OAuth) que la
infraestructura implementa. Los casos de uso dependen solo de estas interfaces.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from collections.abc import Sequence
from datetime import datetime

from app.application.dto import (
    CreateOfferResult,
    DriverEarnings,
    Page,
    PageCursor,
    PendingRealtimeEvent,
    RealtimeOutboxEvent,
    RideDetail,
    RideHistoryItem,
    SocialProfile,
)
from app.domain.entities import AuthProvider, RideStatus, UserRole


class UnitOfWork(ABC):
    """Frontera transaccional decidida por la capa de aplicación."""

    @abstractmethod
    async def commit(self) -> None:
        """Confirma la mutación de negocio y sus eventos pendientes."""

    @abstractmethod
    async def rollback(self) -> None:
        """Descarta todo lo realizado por la operación actual."""


class RealtimeOutbox(ABC):
    """Persistencia y reclamación transaccional de eventos de tiempo real."""

    @abstractmethod
    async def add_batch(
        self,
        events: Sequence[PendingRealtimeEvent],
    ) -> list[RealtimeOutboxEvent]:
        """Añade un lote y asigna secuencia y versión a cada publicación."""

    @abstractmethod
    async def claim_next_batch(self, now: datetime) -> list[RealtimeOutboxEvent]:
        """Bloquea y devuelve el siguiente lote listo para publicarse."""

    @abstractmethod
    async def mark_batch_published(
        self,
        batch_id: uuid.UUID,
        published_at: datetime,
    ) -> None:
        """Marca como publicado un lote reclamado."""

    @abstractmethod
    async def mark_batch_failed(
        self,
        batch_id: uuid.UUID,
        error: str,
        next_attempt_at: datetime,
    ) -> None:
        """Registra el fallo y programa el siguiente intento del lote."""


class CreateOfferEventRecorder(ABC):
    """Registra los eventos durables producidos al crear o mejorar una oferta."""

    @abstractmethod
    async def record(self, result: CreateOfferResult) -> None:
        """Añade a la outbox el desenlace completo de la operación."""


class PasswordHasher(ABC):
    @abstractmethod
    def hash(self, plain: str) -> str: ...

    @abstractmethod
    def verify(self, plain: str, hashed: str) -> bool: ...


class TokenService(ABC):
    @abstractmethod
    def create_access_token(self, user_id: uuid.UUID) -> str: ...

    @abstractmethod
    def create_refresh_token(self, user_id: uuid.UUID) -> str: ...

    @abstractmethod
    def decode_access_token(self, token: str) -> uuid.UUID:
        """Devuelve el id de usuario o lanza ``InvalidTokenError``."""

    @abstractmethod
    def decode_refresh_token(self, token: str) -> uuid.UUID:
        """Devuelve el id de usuario o lanza ``InvalidTokenError``."""


class SocialIdentityVerifier(ABC):
    """Verifica el token de un proveedor OAuth y devuelve un perfil normalizado."""

    provider: AuthProvider

    @abstractmethod
    async def verify(self, token: str) -> SocialProfile:
        """Valida el token contra el proveedor o lanza ``InvalidTokenError``."""


class RideReadRepository(ABC):
    """Proyecciones de lectura para viajes, separadas de sus mutaciones.

    El adaptador concreto resuelve participantes, oferta aceptada y calificación
    en la misma consulta que recupera los viajes. Así los casos de uso no
    reconstruyen vistas mediante consultas por cada fila.
    """

    @abstractmethod
    async def get_active_for_driver(self, driver_id: uuid.UUID) -> RideDetail | None:
        """Último viaje activo del conductor, enriquecido, o ``None``.

        La consulta debe filtrar estados activos y aplicar ``LIMIT 1``.
        """

    @abstractmethod
    async def list_history_items(
        self,
        user_id: uuid.UUID,
        role: UserRole,
        statuses: set[RideStatus],
        cursor: PageCursor | None,
        limit: int,
    ) -> Page[RideHistoryItem]:
        """Historial con contraparte, precio y voto del usuario en una consulta."""

    @abstractmethod
    async def get_driver_earnings_summary(
        self,
        driver_id: uuid.UUID,
        day_start_utc: datetime,
        day_end_utc: datetime,
        recent_limit: int,
    ) -> DriverEarnings:
        """Totales históricos/diarios y desglose reciente del conductor."""
