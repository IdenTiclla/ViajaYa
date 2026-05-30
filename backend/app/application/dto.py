"""DTOs de entrada/salida de los casos de uso.

Independientes de la capa HTTP: los schemas Pydantic de la API se mapean
a/desde estos DTOs.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.domain.entities import AuthProvider, ServiceType


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


@dataclass(frozen=True)
class CreateRideRequestInput:
    origin: LocationInput
    destination: LocationInput
    service_type: ServiceType
    fare: Decimal
