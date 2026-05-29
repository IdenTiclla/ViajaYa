"""Implementación de ``TokenService`` con JWT (python-jose)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from app.application.interfaces import TokenService
from app.domain.exceptions import InvalidTokenError
from app.infrastructure.config import Settings

_ACCESS = "access"
_REFRESH = "refresh"


class JwtTokenService(TokenService):
    def __init__(self, settings: Settings) -> None:
        self._secret = settings.jwt_secret
        self._algorithm = settings.jwt_algorithm
        self._access_ttl = timedelta(minutes=settings.access_token_expire_minutes)
        self._refresh_ttl = timedelta(days=settings.refresh_token_expire_days)

    def _create(self, user_id: uuid.UUID, token_type: str, ttl: timedelta) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": str(user_id),
            "type": token_type,
            "iat": now,
            "exp": now + ttl,
        }
        return jwt.encode(payload, self._secret, algorithm=self._algorithm)

    def create_access_token(self, user_id: uuid.UUID) -> str:
        return self._create(user_id, _ACCESS, self._access_ttl)

    def create_refresh_token(self, user_id: uuid.UUID) -> str:
        return self._create(user_id, _REFRESH, self._refresh_ttl)

    def _decode(self, token: str, expected_type: str) -> uuid.UUID:
        try:
            payload = jwt.decode(token, self._secret, algorithms=[self._algorithm])
        except JWTError as exc:
            raise InvalidTokenError("Token inválido o expirado") from exc
        if payload.get("type") != expected_type:
            raise InvalidTokenError("Tipo de token incorrecto")
        try:
            return uuid.UUID(payload["sub"])
        except (KeyError, ValueError) as exc:
            raise InvalidTokenError("Token sin sujeto válido") from exc

    def decode_access_token(self, token: str) -> uuid.UUID:
        return self._decode(token, _ACCESS)

    def decode_refresh_token(self, token: str) -> uuid.UUID:
        return self._decode(token, _REFRESH)
