"""Domain value objects: they encapsulate business-rule validation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal

from app.domain.exceptions import (
    InvalidEmailError,
    InvalidFareError,
    InvalidLocationError,
)
from app.domain.service_area import bolivia_covers

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

@dataclass(frozen=True, slots=True)
class Email:
    """Normalized, validated email address."""

    value: str

    def __post_init__(self) -> None:
        normalized = self.value.strip().lower()
        if not _EMAIL_RE.match(normalized):
            raise InvalidEmailError(f"Correo inválido: {self.value!r}")
        # frozen dataclass: we assign via object.__setattr__
        object.__setattr__(self, "value", normalized)

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


@dataclass(frozen=True, slots=True)
class GeoPoint:
    """Geographic coordinates validated within their allowed range."""

    latitude: float
    longitude: float

    def __post_init__(self) -> None:
        if not -90.0 <= self.latitude <= 90.0:
            raise InvalidLocationError(f"Latitud fuera de rango: {self.latitude!r}")
        if not -180.0 <= self.longitude <= 180.0:
            raise InvalidLocationError(f"Longitud fuera de rango: {self.longitude!r}")


@dataclass(frozen=True, slots=True)
class ServiceAreaPoint:
    """Valid coordinates inside the country where ViajaYa operates."""

    latitude: float
    longitude: float
    country_code: str | None = None

    def __post_init__(self) -> None:
        GeoPoint(self.latitude, self.longitude)
        if self.country_code and self.country_code.strip().upper() != "BO":
            raise InvalidLocationError("ViajaYa opera actualmente solo dentro de Bolivia.")
        # The country code is only a hint from the client. The versioned outline
        # is the authority, even if the client omits it or claims it is BO.
        if not bolivia_covers(self.latitude, self.longitude):
            raise InvalidLocationError("El origen y el destino deben estar dentro de Bolivia.")


@dataclass(frozen=True, slots=True)
class FareOffer:
    """Fare offered by the passenger. It must be strictly positive."""

    amount: Decimal

    def __post_init__(self) -> None:
        if self.amount <= 0:
            raise InvalidFareError("La oferta debe ser mayor que cero.")
