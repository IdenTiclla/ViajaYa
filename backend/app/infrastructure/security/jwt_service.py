"""Environment-bound implementation of TokenService using python-jose."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from app.application.account_access import SessionClaims, SessionGrant
from app.application.dto import TokenPair
from app.application.interfaces import TokenService
from app.domain.exceptions import InvalidTokenError
from app.infrastructure.config import Settings

_ACCESS = "access"
_REFRESH = "refresh"


class JwtTokenService(TokenService):
    def __init__(self, settings: Settings) -> None:
        self._secret = settings.jwt_secret
        self._algorithm = settings.jwt_algorithm
        self._issuer = settings.jwt_issuer
        self._audience = settings.jwt_audience
        self._access_ttl = timedelta(minutes=settings.access_token_expire_minutes)
        self._refresh_ttl = timedelta(days=settings.refresh_token_expire_days)

    def _create(self, user_id: uuid.UUID, token_type: str, ttl: timedelta) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": str(user_id),
            "type": token_type,
            "iss": self._issuer,
            "aud": self._audience,
            "iat": now,
            "exp": now + ttl,
        }
        return jwt.encode(payload, self._secret, algorithm=self._algorithm)

    def create_access_token(self, user_id: uuid.UUID) -> str:
        return self._create(user_id, _ACCESS, self._access_ttl)

    def create_refresh_token(self, user_id: uuid.UUID) -> str:
        return self._create(user_id, _REFRESH, self._refresh_ttl)

    def _claims(self, token: str, expected_type: str) -> SessionClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[self._algorithm],
                issuer=self._issuer,
                audience=self._audience,
                options={
                    "require_iss": True,
                    "require_aud": True,
                    "require_sub": True,
                    "require_exp": True,
                    "require_iat": True,
                },
            )
        except JWTError as exc:
            raise InvalidTokenError("Token inválido o expirado") from exc
        if payload.get("type") != expected_type:
            raise InvalidTokenError("Tipo de token incorrecto")
        try:
            session_id = uuid.UUID(payload["sid"]) if "sid" in payload else None
            credential_id = uuid.UUID(payload["jti"]) if "jti" in payload else None
            if bool(session_id) != bool(credential_id):
                raise ValueError("Incomplete session claims")
            return SessionClaims(
                uuid.UUID(payload["sub"]), session_id, credential_id,
                datetime.fromtimestamp(payload["iat"], UTC),
                datetime.fromtimestamp(payload["exp"], UTC),
            )
        except (KeyError, ValueError, TypeError, OverflowError) as exc:
            raise InvalidTokenError("Token sin sujeto válido") from exc

    def decode_access_token(self, token: str) -> uuid.UUID:
        return self.decode_access_claims(token).user_id

    def decode_refresh_token(self, token: str) -> uuid.UUID:
        return self.decode_refresh_claims(token).user_id

    def decode_access_claims(self, token: str) -> SessionClaims:
        return self._claims(token, _ACCESS)

    def decode_refresh_claims(self, token: str) -> SessionClaims:
        return self._claims(token, _REFRESH)

    def create_session_pair(self, grant: SessionGrant) -> TokenPair:
        def encode(token_type: str, expires_at: datetime) -> str:
            return jwt.encode({
                "sub": str(grant.user_id), "sid": str(grant.session_id),
                "jti": str(grant.credential_id), "type": token_type,
                "iss": self._issuer, "aud": self._audience,
                "iat": grant.issued_at, "exp": expires_at,
            }, self._secret, algorithm=self._algorithm)
        return TokenPair(encode(_ACCESS, grant.access_expires_at),
                         encode(_REFRESH, grant.refresh_expires_at))
