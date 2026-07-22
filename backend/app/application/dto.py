"""DTOs de entrada/salida de los casos de uso.

Independientes de la capa HTTP: los schemas Pydantic de la API se mapean
a/desde estos DTOs.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Generic, Literal, TypeAlias, TypeVar

from app.domain.entities import (
    AuthProvider,
    Offer,
    PaymentMethod,
    RideRequest,
    RideStatus,
    SavedPlaceCategory,
    ServiceType,
    User,
)
from app.domain.repositories import OpenRideDetail, WithdrawnOfferReference

T = TypeVar("T")

RealtimeOutboxQuarantineCode: TypeAlias = Literal[
    "empty_batch",
    "mixed_batch",
    "invalid_sequence",
    "duplicate_event_id",
    "unsafe_version",
    "invalid_topic",
    "stream_gap",
    "event_type_mismatch",
    "invalid_payload",
    "invalid_routing",
]

ScheduledActionStatus: TypeAlias = Literal[
    "pending",
    "running",
    "succeeded",
    "cancelled",
    "dead",
]


@dataclass(frozen=True, slots=True)
class PendingScheduledAction:
    """Acción diferida que debe persistirse junto con la mutación productora."""

    dedupe_key: str
    action_type: str
    aggregate_id: uuid.UUID
    generation: int
    execute_at: datetime
    payload: dict[str, object]


@dataclass(frozen=True, slots=True)
class ScheduledAction:
    """Estado durable de una acción, incluido su lease cuando está reclamada."""

    id: uuid.UUID
    dedupe_key: str
    action_type: str
    aggregate_id: uuid.UUID
    generation: int
    execute_at: datetime
    payload: dict[str, object]
    status: ScheduledActionStatus
    attempts: int
    next_attempt_at: datetime
    locked_at: datetime | None
    lock_token: uuid.UUID | None
    last_error: str | None
    terminal_at: datetime | None
    created_at: datetime
    updated_at: datetime
    lease_recovered: bool = False


@dataclass(frozen=True, slots=True)
class DispatchScheduledActionResult:
    """Resultado sanitizado de procesar como máximo una acción diferida."""

    status: Literal["empty", "succeeded", "retried", "dead", "lost_lease"]
    action_id: uuid.UUID | None = None
    action_type: str | None = None
    attempts: int = 0
    lease_recovered: bool = False


@dataclass(frozen=True, slots=True)
class PendingRealtimeEvent:
    """Evento listo para persistirse, todavía sin metadatos de entrega.

    La outbox asigna id, lote, secuencia y versiones de agregado/stream dentro
    de la misma transacción que la mutación de negocio.
    """

    event_type: str
    topic: str
    aggregate_type: str
    aggregate_id: uuid.UUID
    payload: dict[str, object]


@dataclass(frozen=True, slots=True)
class RealtimeOutboxEvent:
    """Evento durable reclamado o recién añadido a la outbox."""

    id: uuid.UUID
    batch_id: uuid.UUID
    sequence: int
    batch_size: int
    event_type: str
    topic: str
    aggregate_type: str
    aggregate_id: uuid.UUID
    aggregate_version: int
    stream_version: int
    payload: dict[str, object]
    created_at: datetime
    next_attempt_at: datetime
    published_at: datetime | None
    attempts: int
    last_error: str | None
    quarantined_at: datetime | None = None
    quarantine_code: RealtimeOutboxQuarantineCode | None = None


@dataclass(frozen=True, slots=True)
class DispatchRealtimeOutboxResult:
    """Resultado de procesar como máximo un batch pendiente de la outbox."""

    status: Literal["empty", "published", "failed", "quarantined"]
    batch_id: uuid.UUID | None = None
    event_count: int = 0
    quarantine_code: RealtimeOutboxQuarantineCode | None = None
    affected_streams: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RealtimeOutboxQuarantineCount:
    """Cantidad de batches terminales agrupados por código de cuarentena."""

    code: str
    batch_count: int


@dataclass(frozen=True, slots=True)
class RealtimeOutboxOperationalState:
    """Estado persistido necesario para observar la salud de la outbox.

    Los timestamps se conservan en este DTO de lectura para que la capa de
    aplicación derive duraciones usando un reloj explícito y comprobable.
    """

    pending_event_count: int
    pending_batch_count: int
    retrying_batch_count: int
    quarantined_batches: tuple[RealtimeOutboxQuarantineCount, ...]
    oldest_pending_created_at: datetime | None = None
    latest_published_created_at: datetime | None = None
    latest_published_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class RealtimeOutboxOperationalSnapshot:
    """Métricas operativas derivadas de un corte de lectura de la outbox.

    ``latest_publish_delay_seconds`` mide ``created_at → published_at``. Es
    un límite superior conservador de la demora commit → publicación porque
    PostgreSQL asigna ``created_at`` dentro de la transacción productora.
    """

    captured_at: datetime
    pending_event_count: int
    pending_batch_count: int
    retrying_batch_count: int
    quarantined_batches: tuple[RealtimeOutboxQuarantineCount, ...]
    max_pending_age_seconds: float
    latest_publish_delay_seconds: float | None
    latest_published_at: datetime | None


@dataclass(frozen=True, slots=True)
class PublishedRealtimeOutboxRetentionResult:
    """Batches publicados eliminados en una transacción acotada."""

    batch_count: int
    event_count: int


@dataclass(frozen=True)
class PageCursor:
    """Posición estable para continuar una lectura ordenada en forma descendente."""

    created_at: datetime
    id: uuid.UUID


@dataclass(frozen=True)
class Page(Generic[T]):
    """Segmento de una colección y posición de la página siguiente, si existe."""

    items: list[T]
    next_cursor: PageCursor | None = None


@dataclass(frozen=True)
class RegisterInput:
    full_name: str
    email: str
    password: str
    phone: str | None = None


@dataclass(frozen=True)
class LoginInput:
    email: str
    password: str


@dataclass(frozen=True)
class OAuthLoginInput:
    provider: AuthProvider
    token: str


@dataclass(frozen=True)
class SocialProfile:
    """Perfil normalizado devuelto por un proveedor OAuth tras verificar el token."""

    provider: AuthProvider
    provider_id: str
    email: str
    full_name: str


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@dataclass(frozen=True)
class LocationInput:
    latitude: float
    longitude: float
    name: str
    address: str
    country_code: str | None = None


@dataclass(frozen=True)
class CreateRideRequestInput:
    origin: LocationInput
    destination: LocationInput
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod = PaymentMethod.CASH


@dataclass(frozen=True)
class SaveSavedPlaceInput:
    label: str
    category: SavedPlaceCategory
    location: LocationInput


@dataclass(frozen=True)
class CreateOfferInput:
    """Oferta de un conductor sobre un viaje.

    ``accept_at_fare=True`` significa aceptar al precio del pasajero; en ese caso
    ``price`` se ignora y se toma el ``fare`` del viaje. Si es ``False`` es una
    contraoferta con ``price`` propio y ``eta_min`` estimado.
    """

    accept_at_fare: bool = True
    price: Decimal | None = None
    eta_min: int | None = None


@dataclass(frozen=True)
class UpdateRideStatusInput:
    status: RideStatus


@dataclass(frozen=True)
class OfferDetail:
    """Oferta enriquecida con los datos del conductor que la hizo."""

    offer: Offer
    driver: User


@dataclass(frozen=True)
class CreateOfferResult:
    """Resultado de ofertar: la oferta creada y, si el conductor **mejoró** una
    oferta previa del mismo viaje, el id de la oferta reemplazada (la capa API
    lo usa para retirar la tarjeta vieja de la pantalla del pasajero)."""

    detail: OfferDetail
    superseded_offer_id: uuid.UUID | None = None


@dataclass(frozen=True)
class DriverAvailabilityResult:
    """Cambio de disponibilidad y ofertas retiradas al quedar offline."""

    driver: User
    withdrawn_offers: list[Offer]


@dataclass(frozen=True)
class RideDetail:
    """Viaje enriquecido con sus participantes y la oferta aceptada (si existe)."""

    ride: RideRequest
    rider: User | None = None
    driver: User | None = None
    accepted_offer: Offer | None = None


@dataclass(frozen=True, slots=True)
class RealtimeStreamCheckpoint:
    """Posición de stream incluida en una captura consistente de tiempo real."""

    stream: str
    stream_version: int


@dataclass(frozen=True, slots=True)
class PassengerRealtimeSnapshot:
    """Proyección completa que recupera el pasajero al conectar su socket."""

    snapshot_id: uuid.UUID
    ride: RideDetail
    offers: list[OfferDetail]
    watermarks: tuple[RealtimeStreamCheckpoint, ...]
    captured_at: datetime


@dataclass(frozen=True, slots=True)
class DriverRealtimeSnapshot:
    """Proyección unificada que recupera el conductor al conectar su socket."""

    snapshot_id: uuid.UUID
    open_rides: Page[OpenRideDetail]
    paused_rides: list[OpenRideDetail]
    offers: list[OfferDetail]
    active_ride: RideDetail | None
    watermarks: tuple[RealtimeStreamCheckpoint, ...]
    captured_at: datetime


@dataclass(frozen=True)
class RidePausedResult:
    """Resultado de pausar una solicitud para editarla (Modificar solicitud): el
    ride marcado ``paused`` y las ofertas vivas que se retiraron, para avisar a
    esos conductores y al pasajero que quite las tarjetas."""

    ride: RideRequest
    paused_offers: list[Offer]
    open_detail: OpenRideDetail


@dataclass(frozen=True)
class RideRepublishedResult:
    """Solicitud actualizada que vuelve a anunciarse en el pool.

    Conserva en un mismo resultado el detalle privado del pasajero y la
    proyección pública enriquecida que consumen los conductores.
    """

    detail: RideDetail
    open_detail: OpenRideDetail

    @property
    def ride(self) -> RideRequest:
        return self.detail.ride


@dataclass(frozen=True)
class CancelRideResult:
    """Cancelación enriquecida y sus ofertas vivas rechazadas.

    El detalle se captura antes del commit para que la respuesta HTTP, la outbox
    y la publicación directa compartan exactamente el mismo estado terminal.
    """

    detail: RideDetail
    cancelled_offers: list[Offer]

    @property
    def ride(self) -> RideRequest:
        """Atajo compatible para las reglas que solo necesitan la entidad."""
        return self.detail.ride


@dataclass(frozen=True)
class AcceptOfferResult:
    """Resultado de que el pasajero acepte una oferta (asignación del viaje):
    el viaje asignado, las identidades exactas de otras ofertas vivas del mismo
    conductor que quedaron retiradas, y los ``driver_id`` de los otros conductores
    de este viaje que perdieron la carrera (la capa API difunde
    ``offer_withdrawn`` / ``offer_rejected`` con ellos)."""

    detail: RideDetail
    withdrawn_offers: list[WithdrawnOfferReference]
    losing_driver_ids: list[uuid.UUID]

    @property
    def withdrawn_ride_ids(self) -> list[uuid.UUID]:
        """Compatibilidad temporal con el contrato legacy resumido por ride."""
        return [offer.ride_id for offer in self.withdrawn_offers]


@dataclass(frozen=True)
class RideHistoryItem:
    """Viaje terminado/cancelado, enriquecido para las tarjetas de historial.

    ``counterpart`` es el conductor (vista del pasajero) o el pasajero (vista del
    conductor); ``price`` es el precio acordado (oferta aceptada o ``fare``);
    ``my_rating`` es la nota que el usuario actual dejó a ese viaje, si existe.
    """

    ride: RideRequest
    counterpart: User | None
    price: Decimal
    my_rating: int | None = None


@dataclass(frozen=True)
class EarningsItem:
    """Una línea de ganancia: un viaje completado y lo que rindió."""

    ride_id: uuid.UUID
    destination_name: str
    price: Decimal
    completed_at: datetime | None


@dataclass(frozen=True)
class DriverEarnings:
    """Resumen de ganancias del conductor: hoy, histórico y viajes recientes."""

    total_today: Decimal
    trips_today: int
    total_all_time: Decimal
    trips_all_time: int
    recent: list[EarningsItem]
