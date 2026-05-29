"""Entidades del dominio. Sin dependencias de framework."""

from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass, field
from datetime import datetime


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
