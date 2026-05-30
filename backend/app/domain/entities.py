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


@dataclass
class User:
    """Usuario de la plataforma.

    ``hashed_password`` es opcional: los usuarios creados vía SSO (Google /
    Facebook) no tienen contraseña local. ``provider_id`` guarda el id del
    usuario en el proveedor externo cuando aplica.
    """

    full_name: str
    email: str
    phone: str | None = None
    hashed_password: str | None = None
    auth_provider: AuthProvider = AuthProvider.LOCAL
    provider_id: str | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None

    @property
    def is_social(self) -> bool:
        return self.auth_provider is not AuthProvider.LOCAL


class ServiceType(enum.StrEnum):
    """Tipo de servicio solicitado en un viaje."""

    TAXI = "taxi"
    MOTO = "moto"


class PaymentMethod(enum.StrEnum):
    """Forma de pago elegida para el viaje.

    Por ahora la app soporta pago por QR y pago en efectivo.
    """

    QR = "qr"
    CASH = "cash"


class RideStatus(enum.StrEnum):
    """Estado del ciclo de vida de una solicitud de viaje.

    Por ahora solo cubrimos la creación de la solicitud (``SEARCHING``) y su
    cancelación; la negociación de ofertas y el viaje en curso llegan en una
    entrega posterior.
    """

    SEARCHING = "searching"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class Location:
    """Un punto del viaje: coordenadas + etiqueta legible (nombre y dirección)."""

    latitude: float
    longitude: float
    name: str
    address: str


@dataclass
class RideRequest:
    """Solicitud de viaje creada por un pasajero.

    Captura lo que produce el flujo móvil de origen/destino: de dónde a dónde,
    con qué servicio y cuánto ofrece pagar. Nace en estado ``SEARCHING``.
    """

    rider_id: uuid.UUID
    origin: Location
    destination: Location
    service_type: ServiceType
    fare: Decimal
    payment_method: PaymentMethod = PaymentMethod.CASH
    status: RideStatus = RideStatus.SEARCHING
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime | None = None
