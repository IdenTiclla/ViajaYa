"""Schemas Pydantic de la API de autenticación (capa de presentación).

Separados de las entidades de dominio: definen el contrato HTTP.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.application.dto import TokenPair
from app.domain.entities import AuthProvider, User, UserRole, VehicleType


class RefreshRequest(BaseModel):
    refresh_token: str = Field(max_length=4096, repr=False)
    request_id: uuid.UUID | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: EmailStr | None
    phone: str | None
    phone_verified_at: datetime | None
    auth_provider: AuthProvider
    role: UserRole
    vehicle_type: VehicleType | None
    plate: str | None
    vehicle_model: str | None
    rating: float | None
    is_online: bool
    created_at: datetime | None

    @classmethod
    def from_entity(cls, user: User) -> UserResponse:
        return cls.model_validate(user)


class AuthResponse(BaseModel):
    """Operational session issued after phone or social sign-in: tokens + user."""

    user: UserResponse
    tokens: TokenResponse

    @classmethod
    def from_session(cls, user: User, tokens: TokenPair) -> AuthResponse:
        return cls(
            user=UserResponse.from_entity(user),
            tokens=TokenResponse(
                access_token=tokens.access_token, refresh_token=tokens.refresh_token,
            ),
        )
