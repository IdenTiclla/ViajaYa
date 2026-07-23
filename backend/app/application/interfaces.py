"""Puertos de la capa de aplicación.

Abstracciones de servicios técnicos (hash, tokens, verificación OAuth) que la
infraestructura implementa. Los casos de uso dependen solo de estas interfaces.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from collections.abc import Sequence
from datetime import datetime
from typing import Literal

from app.application.dto import (
    AcceptOfferResult,
    CancelRideResult,
    CreateOfferResult,
    DriverAvailabilityResult,
    DriverEarnings,
    DriverRealtimeSnapshot,
    Page,
    PageCursor,
    PassengerPresenceObservation,
    PassengerRealtimeSnapshot,
    PendingRealtimeEvent,
    PendingScheduledAction,
    PublishedRealtimeOutboxRetentionResult,
    RealtimeOutboxEvent,
    RealtimeOutboxOperationalState,
    RealtimeOutboxQuarantineCode,
    RenewableScheduledAction,
    RideDetail,
    RideHistoryItem,
    RidePausedResult,
    RideRepublishedResult,
    ScheduledAction,
    ScheduledActionsOperationalState,
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


class ScheduledActionScheduler(ABC):
    """Persiste acciones diferidas dentro de la transacción productora."""

    @abstractmethod
    async def schedule(self, action: PendingScheduledAction) -> ScheduledAction:
        """Inserta o renueva una acción por una generación estrictamente mayor."""

    @abstractmethod
    async def schedule_next(self, action: RenewableScheduledAction) -> ScheduledAction:
        """Inserta la primera generación o incrementa la vigente bajo un único CAS."""


class ScheduledActionQueue(ScheduledActionScheduler):
    """Reclama y finaliza acciones mediante leases recuperables."""

    @abstractmethod
    async def claim_due(
        self,
        now: datetime,
        stale_before: datetime,
    ) -> ScheduledAction | None:
        """Reclama una acción vencida o recupera un lease abandonado."""

    @abstractmethod
    async def lock_owned(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
    ) -> bool:
        """Bloquea la fila solo si el caller conserva generación y fencing."""

    @abstractmethod
    async def mark_succeeded(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
        terminal_at: datetime,
    ) -> bool:
        """Confirma el éxito solo si el caller todavía posee el lease."""

    @abstractmethod
    async def mark_succeeded_if_pending(
        self,
        dedupe_key: str,
        generation: int,
        terminal_at: datetime,
    ) -> bool:
        """Completa el timer legacy solo si ningún worker reclamó la acción."""

    @abstractmethod
    async def mark_failed(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
        *,
        error_code: str,
        next_attempt_at: datetime,
        terminal: bool,
        terminal_at: datetime,
    ) -> bool:
        """Reprograma o agota una acción conservando ownership por CAS."""


class ScheduledActionExecutor(ABC):
    """Ejecuta el caso de uso asociado y confirma la acción en su misma UoW."""

    @abstractmethod
    async def execute(
        self,
        action: ScheduledAction,
    ) -> Literal["succeeded", "deferred", "lost_lease"]:
        """Procesa una acción reclamada sin exponer detalles de infraestructura."""


class PassengerPresenceLeaseStore(ABC):
    """Coordina leases de presencia compartidos sin convertir Redis en negocio."""

    @abstractmethod
    async def renew_websocket(
        self,
        ride_id: uuid.UUID,
        connection_id: uuid.UUID,
    ) -> float:
        """Renueva una conexión y devuelve segundos hasta su cancelación segura."""

    @abstractmethod
    async def disconnect_websocket(
        self,
        ride_id: uuid.UUID,
        connection_id: uuid.UUID,
    ) -> float:
        """Cierra solo ese lease y devuelve la fecha límite global restante."""

    @abstractmethod
    async def renew_http(self, ride_id: uuid.UUID) -> float:
        """Registra el heartbeat HTTP y devuelve su gracia restante."""

    @abstractmethod
    async def observe(self, ride_id: uuid.UUID) -> PassengerPresenceObservation:
        """Comprueba leases y gracia usando un corte atómico del transporte."""

    @abstractmethod
    async def present_ride_ids(
        self,
        ride_ids: Sequence[uuid.UUID],
    ) -> set[uuid.UUID]:
        """Devuelve qué solicitudes siguen visibles bajo lease o gracia."""


class ScheduledActionsOperationalReader(ABC):
    """Lee agregados sanitizados del backlog de acciones programadas."""

    @abstractmethod
    async def read(
        self,
        now: datetime,
        stale_before: datetime,
    ) -> ScheduledActionsOperationalState:
        """Cuenta acciones vencidas, leases y terminales bajo un corte corto."""


class TerminalScheduledActionsRetention(ABC):
    """Elimina acciones exitosas o canceladas después de su retención."""

    @abstractmethod
    async def purge(
        self,
        cutoff: datetime,
        action_limit: int,
    ) -> int:
        """Marca para borrado un chunk acotado y devuelve cuántas filas eliminó."""


class MissingScheduledActionsReconciler(ABC):
    """Repara agregados legacy que todavía no tienen su acción durable."""

    @abstractmethod
    async def reconcile(self, action_limit: int) -> int:
        """Agenda un chunk de acciones ausentes y devuelve cuántas creó."""


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


class RealtimeOutboxOperationalReader(ABC):
    """Puerto de lectura para observar la salud durable de la outbox."""

    @abstractmethod
    async def read(self) -> RealtimeOutboxOperationalState:
        """Devuelve conteos y timestamps sin exponer modelos ORM."""


class PublishedRealtimeOutboxRetention(ABC):
    """Elimina únicamente batches publicados, completos y antiguos."""

    @abstractmethod
    async def purge(
        self,
        cutoff: datetime,
        batch_limit: int,
    ) -> PublishedRealtimeOutboxRetentionResult:
        """Marca para borrado hasta ``batch_limit`` batches completos."""


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


class RealtimeOutboxBatchPublisher(ABC):
    """Entrega un lote durable ya reclamado a un transporte realtime."""

    @abstractmethod
    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        """Publica el lote completo conservando su orden de secuencia."""

    @abstractmethod
    async def force_resync(self, streams: Sequence[str]) -> None:
        """Fuerza otro snapshot a los sockets afectados por un hueco terminal."""


class RealtimeDeliveryBridge(RealtimeOutboxBatchPublisher):
    """Fanout entre procesos y sus sockets locales durante el modo live."""

    @property
    @abstractmethod
    def running(self) -> bool:
        """Indica si el loop suscriptor continúa activo."""

    @property
    @abstractmethod
    def connected(self) -> bool:
        """Indica si este proceso mantiene su suscripción al transporte."""

    @property
    @abstractmethod
    def last_error(self) -> str | None:
        """Código sanitizado del último fallo todavía no recuperado."""

    @abstractmethod
    async def preflight(self) -> None:
        """Comprueba conectividad antes de admitir tráfico."""

    @abstractmethod
    async def wait_until_ready(self, timeout_seconds: float) -> None:
        """Espera hasta confirmar que la suscripción ya recibe fanout."""

    @abstractmethod
    async def run(self) -> None:
        """Mantiene la suscripción y reconecta mientras no se solicite cierre."""

    @abstractmethod
    def stop(self) -> None:
        """Solicita un cierre coordinado del suscriptor."""

    @abstractmethod
    async def aclose(self) -> None:
        """Libera conexiones del transporte de forma idempotente."""


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


class ExpireOfferEventRecorder(ABC):
    """Registra los eventos durables producidos al vencer una oferta."""

    @abstractmethod
    async def record(self, offer: Offer) -> None:
        """Añade a la outbox el fanout ``offer_expired`` de la oferta vencida."""


class UpdateRideStatusEventRecorder(ABC):
    """Registra los eventos durables al avanzar el estado de un viaje."""

    @abstractmethod
    async def record(self, detail: RideDetail) -> None:
        """Añade a la outbox el estado exacto visto por ambos participantes."""


class DriverAvailabilityEventRecorder(ABC):
    """Registra los eventos durables al cambiar la disponibilidad del conductor."""

    @abstractmethod
    async def record(self, result: DriverAvailabilityResult) -> None:
        """Añade los retiros producidos al quedar offline; online no emite."""


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
