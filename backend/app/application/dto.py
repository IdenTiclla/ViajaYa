"""DTOs de entrada/salida de los casos de uso.

Independientes de la capa HTTP: los schemas Pydantic de la API se mapean
a/desde estos DTOs.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Generic, Literal, TypeVar

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
from app.domain.repositories import OpenRideDetail

T = TypeVar("T")


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


@dataclass(frozen=True, slots=True)
class DispatchRealtimeOutboxResult:
    """Resultado de procesar como máximo un batch pendiente de la outbox."""

    status: Literal["empty", "published", "failed"]
    batch_id: uuid.UUID | None = None
    event_count: int = 0


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


@dataclass(frozen=True)
class CancelRideResult:
    """Resultado de cancelar un viaje: el ride cancelado y las ofertas vivas que
    murieron con él, para avisar a esos conductores (``reason: ride_cancelled``)."""

    ride: RideRequest
    cancelled_offers: list[Offer]


@dataclass(frozen=True)
class AcceptOfferResult:
    """Resultado de que el pasajero acepte una oferta (asignación del viaje):
    el viaje asignado, los ``ride_id`` de otros pasajeros cuyas ofertas vivas del
    mismo conductor quedaron retiradas, y los ``driver_id`` de los otros
    conductores de este viaje que perdieron la carrera (la capa API difunde
    ``offer_withdrawn`` / ``offer_rejected`` con ellos)."""

    detail: RideDetail
    withdrawn_ride_ids: list[uuid.UUID]
    losing_driver_ids: list[uuid.UUID]


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
