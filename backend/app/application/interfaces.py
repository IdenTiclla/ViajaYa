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
    AcceptOfferResult,
    CancelRideResult,
    CreateOfferResult,
    DriverEarnings,
    DriverRealtimeSnapshot,
    Page,
    PageCursor,
    PassengerRealtimeSnapshot,
    PendingRealtimeEvent,
    RealtimeOutboxEvent,
    RealtimeOutboxQuarantineCode,
    RideDetail,
    RideHistoryItem,
    RidePausedResult,
    RideRepublishedResult,
    SocialProfile,
)
from app.domain.entities import AuthProvider, Offer, RideStatus, UserRole
from app.domain.repositories import OpenRideDetail


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
        """Añade un lote y asigna versiones de agregado y stream."""

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

    @abstractmethod
    async def mark_batch_quarantined(
        self,
        batch_id: uuid.UUID,
        code: RealtimeOutboxQuarantineCode,
        quarantined_at: datetime,
    ) -> int:
        """Aparta de forma terminal un lote inválido todavía pendiente.

        Devuelve la cantidad de filas que hicieron la transición. La operación
        es idempotente y nunca revive lotes publicados o apartados.
        """


class RealtimeSnapshotReader(ABC):
    """Captura proyecciones y watermarks bajo un único corte de lectura.

    El adaptador concreto es dueño de la sesión y de la transacción consistente.
    Los streams siempre los decide el caso de uso para no trasladar reglas de
    autorización o routing a infraestructura.
    """

    @abstractmethod
    async def read_passenger(
        self,
        ride_id: uuid.UUID,
        streams: Sequence[str],
    ) -> PassengerRealtimeSnapshot | None:
        """Captura ride, ofertas y posiciones, o ``None`` si el ride desapareció."""

    @abstractmethod
    async def read_driver(
        self,
        driver_id: uuid.UUID,
        streams: Sequence[str],
    ) -> DriverRealtimeSnapshot | None:
        """Captura el estado del conductor o ``None`` si ya no existe."""


class RealtimeOutboxBatchValidator(ABC):
    """Valida metadatos y payloads antes de despachar un lote durable."""

    @abstractmethod
    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        """Lanza un error de aplicación si el lote no es canónico."""


class CreateOfferEventRecorder(ABC):
    """Registra los eventos durables producidos al crear o mejorar una oferta."""

    @abstractmethod
    async def record(self, result: CreateOfferResult) -> None:
        """Añade a la outbox el desenlace completo de la operación."""


class AcceptOfferEventRecorder(ABC):
    """Registra los eventos durables producidos al aceptar una oferta."""

    @abstractmethod
    async def record(self, result: AcceptOfferResult) -> None:
        """Añade a la outbox todo el fanout atómico de la aceptación."""


class PauseRideEventRecorder(ABC):
    """Registra los eventos durables producidos al pausar una solicitud."""

    @abstractmethod
    async def record(self, result: RidePausedResult) -> None:
        """Añade a la outbox el cierre, retiros y avisos de pausa."""


class RepublishRideEventRecorder(ABC):
    """Registra los eventos durables al renovar una solicitud en el pool."""

    @abstractmethod
    async def record(self, result: RideRepublishedResult) -> None:
        """Añade a la outbox el detalle del pasajero y la proyección del pool."""


class CancelRideEventRecorder(ABC):
    """Registra los eventos durables producidos al cancelar un viaje."""

    @abstractmethod
    async def record(self, result: CancelRideResult) -> None:
        """Añade a la outbox el estado terminal, cierre y rechazos."""


class AnnounceOpenRideEventRecorder(ABC):
    """Registra el anuncio de presencia de una solicitud abierta."""

    @abstractmethod
    async def record(self, detail: OpenRideDetail) -> None:
        """Añade a la outbox el ``ride_created`` ya revalidado bajo lock."""


class WithdrawOfferEventRecorder(ABC):
    """Registra el retiro voluntario de una oferta por su conductor."""

    @abstractmethod
    async def record(self, offer: Offer) -> None:
        """Añade a la outbox el ``offer_withdrawn`` de la oferta mutada."""


class RejectOfferEventRecorder(ABC):
    """Registra el rechazo explícito de una oferta por el pasajero."""

    @abstractmethod
    async def record(self, offer: Offer) -> None:
        """Añade a la outbox el ``offer_rejected`` de la oferta mutada."""


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
