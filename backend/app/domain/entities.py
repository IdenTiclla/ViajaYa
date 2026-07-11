"""Entidades del dominio. Sin dependencias de framework."""

from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


class AuthProvider(enum.StrEnum):
    """Origen de la identidad del usuario."""

    LOCAL = "local"
    GOOGLE = "google"
    FACEBOOK = "facebook"


class UserRole(enum.StrEnum):
    """Rol del usuario en la plataforma.

    Define qué navegación y acciones ve la app: el pasajero publica solicitudes,
    el conductor responde con ofertas. ``DELIVERY`` se reserva para repartos.
    """

    PASSENGER = "passenger"
    DRIVER = "driver"
    DELIVERY = "delivery"


class VehicleType(enum.StrEnum):
    """Tipo fisico de vehiculo registrado por un conductor."""

    TAXI = "taxi"
    MOTO = "moto"


class ServiceType(enum.StrEnum):
    """Tipo de servicio solicitado por un pasajero."""

    TAXI = "taxi"
    MOTO = "moto"
    DELIVERY = "delivery"


def vehicle_can_serve(service_type: ServiceType, vehicle_type: VehicleType) -> bool:
    """Taxi y moto pueden transportar encomiendas; viajes personales exigen coincidencia."""

    return (
        service_type is ServiceType.DELIVERY
        or service_type.value == vehicle_type.value
    )


def services_for_vehicle(vehicle_type: VehicleType) -> tuple[ServiceType, ...]:
    """Servicios visibles para un conductor según su vehículo."""

    return (ServiceType(vehicle_type.value), ServiceType.DELIVERY)


@dataclass
class User:
    """Usuario de la plataforma.

    ``hashed_password`` es opcional: los usuarios creados vía SSO (Google /
    Facebook) no tienen contraseña local. ``provider_id`` guarda el id del
    usuario en el proveedor externo cuando aplica.

    Los campos de conductor (``vehicle_type``, ``plate``, ``vehicle_model``,
    ``rating``, ``is_online``) solo aplican cuando ``role`` es ``DRIVER``.
    """

    full_name: str
    email: str
    phone: str | None = None
    hashed_password: str | None = None
    auth_provider: AuthProvider = AuthProvider.LOCAL
    provider_id: str | None = None
    role: UserRole = UserRole.PASSENGER
    vehicle_type: VehicleType | None = None
    plate: str | None = None
    vehicle_model: str | None = None
    rating: float | None = None
    is_online: bool = False
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None

    @property
    def is_social(self) -> bool:
        return self.auth_provider is not AuthProvider.LOCAL

    @property
    def is_driver(self) -> bool:
        return self.role is UserRole.DRIVER


class PaymentMethod(enum.StrEnum):
    """Forma de pago elegida para el viaje.

    Por ahora la app soporta pago por QR y pago en efectivo.
    """

    QR = "qr"
    CASH = "cash"


class RideStatus(enum.StrEnum):
    """Estado del ciclo de vida de una solicitud de viaje.

    Flujo: ``SEARCHING`` (publicada, esperando ofertas) → ``ACCEPTED`` (el
    pasajero eligió una oferta y hay conductor asignado) → ``ARRIVING`` (el
    conductor va al origen) → ``IN_PROGRESS`` (viaje en curso) → ``COMPLETED``.
    ``CANCELLED`` es posible antes de ``IN_PROGRESS``.
    """

    SEARCHING = "searching"
    ACCEPTED = "accepted"
    ARRIVING = "arriving"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class Location:
    """Un punto del viaje: coordenadas + etiqueta legible (nombre y dirección)."""

    latitude: float
    longitude: float
    name: str
    address: str


class SavedPlaceCategory(enum.StrEnum):
    """Categoría de un lugar guardado; define el ícono en la app."""

    HOME = "home"
    WORK = "work"
    GYM = "gym"
    OTHER = "other"


@dataclass
class SavedPlace:
    """Lugar favorito del pasajero, persistido para sincronizar entre dispositivos.

    Reutiliza ``Location`` para el punto (coordenadas + etiquetas) y añade el
    nombre que pone el usuario (``label``) y su ``category`` (casa, trabajo…).
    """

    user_id: uuid.UUID
    label: str
    category: SavedPlaceCategory
    location: Location
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class RideRequest:
    """Solicitud de viaje creada por un pasajero.

    Captura lo que produce el flujo móvil de origen/destino: de dónde a dónde,
    con qué servicio y cuánto ofrece pagar. Nace en estado ``SEARCHING``. Cuando
    el pasajero acepta una oferta se fijan ``driver_id`` y ``accepted_offer_id``.

    ``paused`` oculta temporalmente la solicitud del pool de conductores mientras
    el pasajero la edita (Modificar solicitud): sigue ``SEARCHING``, pero no
    recibe ofertas nuevas y las vivas se retiran al pausar.
    """

    rider_id: uuid.UUID
    origin: Location
    destination: Location
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod = PaymentMethod.CASH
    status: RideStatus = RideStatus.SEARCHING
    driver_id: uuid.UUID | None = None
    accepted_offer_id: uuid.UUID | None = None
    paused: bool = False
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None


class OfferStatus(enum.StrEnum):
    """Estado de una oferta de un conductor sobre una solicitud de viaje.

    El pasajero tiene la decisión final: al aceptar una oferta ``PENDING`` esta
    pasa a ``ACCEPTED`` y el viaje se asigna a ese conductor (transacción
    atómica); las demás ofertas vivas del viaje quedan ``REJECTED``. ``EXPIRED``
    aplica cuando vence el TTL de 30 s sin que el pasajero la aceptara.
    """

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"


# Estado en el que una oferta sigue "viva" en la negociación.
ACTIVE_OFFER_STATUSES = frozenset({OfferStatus.PENDING})


@dataclass
class Offer:
    """Oferta de un conductor sobre una solicitud de viaje.

    El conductor puede **aceptar** al precio del pasajero (``price == ride.fare``)
    o **contraofertar** con su propio ``price`` y un ``eta_min`` estimado. Nace en
    ``PENDING`` y vive 30 s (``OFFER_TTL`` desde ``created_at``); cuando el
    pasajero la acepta se asigna el viaje (pasa a ``ACCEPTED``) y las demás
    ofertas del viaje se rechazan en la misma transacción.
    """

    ride_id: uuid.UUID
    driver_id: uuid.UUID
    price: Decimal
    eta_min: int | None = None
    status: OfferStatus = OfferStatus.PENDING
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None


@dataclass
class RideRating:
    """Calificación de una parte del viaje hacia la otra, tras completarse.

    Cuando un viaje llega a ``COMPLETED``, el pasajero califica al conductor y el
    conductor al pasajero (``score`` 1–5 + comentario opcional). Solo se admite una
    calificación por ``(ride_id, rater_id)``. Cada voto recalcula el
    ``User.rating`` promedio de la persona calificada.
    """

    ride_id: uuid.UUID
    rater_id: uuid.UUID
    ratee_id: uuid.UUID
    score: int
    comment: str | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None


@dataclass
class RideRatingSkip:
    """Decisión de un participante de cerrar el viaje sin calificarlo."""

    ride_id: uuid.UUID
    rater_id: uuid.UUID
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
