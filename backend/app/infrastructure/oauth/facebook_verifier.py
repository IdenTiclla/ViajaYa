"""Verificador del access_token de Facebook (implementa ``SocialIdentityVerifier``).

Valida el token con la Graph API usando el app token (app_id|app_secret) y luego
obtiene el perfil básico del usuario.
"""

from __future__ import annotations

import httpx

from app.application.dto import SocialProfile
from app.application.interfaces import SocialIdentityVerifier
from app.domain.entities import AuthProvider
from app.domain.exceptions import InvalidTokenError

_GRAPH = "https://graph.facebook.com/v19.0"


class FacebookIdentityVerifier(SocialIdentityVerifier):
    provider = AuthProvider.FACEBOOK

    def __init__(self, app_id: str, app_secret: str) -> None:
        self._app_id = app_id
        self._app_secret = app_secret

    async def verify(self, token: str) -> SocialProfile:
        app_token = f"{self._app_id}|{self._app_secret}"
        async with httpx.AsyncClient(timeout=10) as client:
            debug = await client.get(
                f"{_GRAPH}/debug_token",
                params={"input_token": token, "access_token": app_token},
            )
            debug_data = debug.json().get("data", {})
            if not debug_data.get("is_valid") or debug_data.get("app_id") != self._app_id:
                raise InvalidTokenError("Token de Facebook inválido")

            profile = await client.get(
                f"{_GRAPH}/me",
                params={"fields": "id,name,email", "access_token": token},
            )
            data = profile.json()

        if "id" not in data or "email" not in data:
            raise InvalidTokenError("No se pudo obtener el perfil de Facebook")

        return SocialProfile(
            provider=AuthProvider.FACEBOOK,
            provider_id=str(data["id"]),
            email=str(data["email"]).lower(),
            full_name=str(data.get("name") or data["email"]),
        )
