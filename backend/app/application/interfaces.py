"""Puertos de la capa de aplicación.

Abstracciones de servicios técnicos (hash, tokens, verificación OAuth) que la
infraestructura implementa. Los casos de uso dependen solo de estas interfaces.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod

from app.application.dto import SocialProfile
from app.domain.entities import AuthProvider


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
