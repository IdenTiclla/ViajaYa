"""Value objects del dominio: encapsulan validación de reglas de negocio."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal

from app.domain.exceptions import (
    InvalidEmailError,
    InvalidFareError,
    InvalidLocationError,
    WeakPasswordError,
)
from app.domain.service_area import bolivia_covers

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MIN_PASSWORD_LENGTH = 8

@dataclass(frozen=True, slots=True)
class Email:
    """Correo electrónico normalizado y validado."""

    value: str

    def __post_init__(self) -> None:
        normalized = self.value.strip().lower()
        if not _EMAIL_RE.match(normalized):
            raise InvalidEmailError(f"Correo inválido: {self.value!r}")
        # frozen dataclass: asignamos vía object.__setattr__
        object.__setattr__(self, "value", normalized)

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


@dataclass(frozen=True, slots=True)
class RawPassword:
    """Contraseña en texto plano, validada contra la política mínima.

    Nunca se persiste; solo se usa para hashear o comparar.
    """

    value: str

    def __post_init__(self) -> None:
        if len(self.value) < _MIN_PASSWORD_LENGTH:
            raise WeakPasswordError(
                f"La contraseña debe tener al menos {_MIN_PASSWORD_LENGTH} caracteres."
            )


@dataclass(frozen=True, slots=True)
class GeoPoint:
    """Coordenadas geográficas validadas dentro de su rango admisible."""

    latitude: float
    longitude: float

    def __post_init__(self) -> None:
        if not -90.0 <= self.latitude <= 90.0:
            raise InvalidLocationError(f"Latitud fuera de rango: {self.latitude!r}")
        if not -180.0 <= self.longitude <= 180.0:
            raise InvalidLocationError(f"Longitud fuera de rango: {self.longitude!r}")


@dataclass(frozen=True, slots=True)
class ServiceAreaPoint:
    """Coordenadas válidas dentro del país donde opera ViajaYa."""

    latitude: float
    longitude: float
    country_code: str | None = None

    def __post_init__(self) -> None:
        GeoPoint(self.latitude, self.longitude)
        if self.country_code and self.country_code.strip().upper() != "BO":
            raise InvalidLocationError("ViajaYa opera actualmente solo dentro de Bolivia.")
        # El codigo de pais es solo una pista del cliente. El contorno versionado
        # es la autoridad, incluso si el cliente lo omite o afirma que es BO.
        if not bolivia_covers(self.latitude, self.longitude):
            raise InvalidLocationError("El origen y el destino deben estar dentro de Bolivia.")


@dataclass(frozen=True, slots=True)
class FareOffer:
    """Monto ofertado por el pasajero. Debe ser estrictamente positivo."""

    amount: Decimal

    def __post_init__(self) -> None:
        if self.amount <= 0:
            raise InvalidFareError("La oferta debe ser mayor que cero.")
