"""Verify Facebook user tokens against their configured app and provider subject."""

from __future__ import annotations

import time

import httpx

from app.application.dto import SocialProfile
from app.application.interfaces import SocialIdentityVerifier
from app.domain.entities import AuthProvider
from app.domain.exceptions import InvalidTokenError

_GRAPH = "https://graph.facebook.com/v26.0"


class FacebookIdentityVerifier(SocialIdentityVerifier):
    provider = AuthProvider.FACEBOOK

    def __init__(self, app_id: str, app_secret: str) -> None:
        self._app_id = app_id
        self._app_secret = app_secret

    async def verify(self, token: str) -> SocialProfile:
        try:
            # Transport-level requests avoid httpx's INFO URL logging of input_token.
            async with httpx.AsyncHTTPTransport() as transport:
                debug = await self._get(
                    transport, "debug_token", {"input_token": token},
                    f"{self._app_id}|{self._app_secret}",
                )
                claims = debug.get("data", {})
                if (
                    not isinstance(claims, dict)
                    or claims.get("is_valid") is not True
                    or str(claims.get("app_id", "")) != self._app_id
                    or claims.get("type") != "USER"
                    or not claims.get("user_id")
                    or not self._valid_expiry(claims.get("expires_at"))
                    or not self._valid_expiry(claims.get("data_access_expires_at"))
                ):
                    raise InvalidTokenError("Token de Facebook inválido")
                data = await self._get(transport, "me", {"fields": "id,name"}, token)
            if str(data.get("id", "")) != str(claims["user_id"]):
                raise InvalidTokenError("La identidad de Facebook no coincide")
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise InvalidTokenError("No pudimos verificar Facebook. Vuelve a intentar.") from exc

        return SocialProfile(
            provider=AuthProvider.FACEBOOK,
            provider_id=str(data["id"]),
            email="",
            full_name=str(data.get("name") or "Usuario de Facebook"),
        )

    @staticmethod
    def _valid_expiry(value: object) -> bool:
        return type(value) in (int, float) and (value == 0 or value > time.time())

    @staticmethod
    async def _get(
        transport: httpx.AsyncHTTPTransport, path: str, params: dict[str, str], token: str,
    ) -> dict:
        request = httpx.Request(
            "GET", f"{_GRAPH}/{path}", params=params,
            headers={"Authorization": f"Bearer {token}"},
            extensions={"timeout": {"connect": 5, "read": 5, "write": 5, "pool": 5}},
        )
        response = await transport.handle_async_request(request)
        try:
            await response.aread()
            if response.status_code != 200:
                raise InvalidTokenError("No pudimos verificar Facebook. Vuelve a intentar.")
            data = response.json()
            if not isinstance(data, dict):
                raise InvalidTokenError("La respuesta de Facebook no es válida.")
            return data
        finally:
            await response.aclose()
