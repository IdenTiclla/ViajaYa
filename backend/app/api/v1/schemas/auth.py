"""Schemas Pydantic de la API de autenticación (capa de presentación).

Separados de las entidades de dominio: definen el contrato HTTP.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.domain.entities import AuthProvider, ServiceType, User, UserRole


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=32)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class OAuthRequest(BaseModel):
    """Token emitido por el proveedor (id_token de Google / access_token de Facebook)."""

    token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr
    phone: str | None
    auth_provider: AuthProvider
    role: UserRole
    vehicle_type: ServiceType | None
    plate: str | None
    vehicle_model: str | None
    rating: float | None
    is_online: bool
    created_at: datetime | None

    @classmethod
    def from_entity(cls, user: User) -> UserResponse:
        return cls.model_validate(user)


class AuthResponse(BaseModel):
    """Respuesta de register / login / oauth: tokens + datos del usuario."""

    user: UserResponse
    tokens: TokenResponse
