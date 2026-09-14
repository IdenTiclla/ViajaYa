"""Verificador del id_token de Google (implementa ``SocialIdentityVerifier``)."""

from __future__ import annotations

from asyncio import to_thread
from functools import partial

import requests
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.application.dto import SocialProfile
from app.application.interfaces import SocialIdentityVerifier
from app.domain.entities import AuthProvider
from app.domain.exceptions import InvalidTokenError


class GoogleIdentityVerifier(SocialIdentityVerifier):
    provider = AuthProvider.GOOGLE

    def __init__(self, client_id: str) -> None:
        self._client_id = client_id

    async def verify(self, token: str) -> SocialProfile:
        try:
            claims = await to_thread(self._verify_claims, token)
        except (ValueError, GoogleAuthError) as exc:
            raise InvalidTokenError("Token de Google inválido") from exc

        if (
            not claims.get("email_verified", False)
            or not claims.get("sub") or not claims.get("email")
        ):
            raise InvalidTokenError("El correo de Google no está verificado")

        return SocialProfile(
            provider=AuthProvider.GOOGLE,
            provider_id=str(claims["sub"]),
            email=str(claims["email"]).lower(),
            full_name=str(claims.get("name") or claims["email"]),
        )

    def _verify_claims(self, token: str) -> dict:
        # Certificate I/O must not block the API event loop or wait indefinitely.
        with requests.Session() as session:
            request = partial(google_requests.Request(session=session), timeout=10)
            return google_id_token.verify_oauth2_token(token, request, self._client_id)
