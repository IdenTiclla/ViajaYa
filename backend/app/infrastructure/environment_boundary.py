"""Reject accidental cross-environment HTTP requests before reaching handlers."""

from __future__ import annotations

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.infrastructure.environment import AppEnvironment

ENVIRONMENT_HEADER = "X-App-Environment"


class EnvironmentBoundaryMiddleware:
    def __init__(self, app: ASGIApp, environment: AppEnvironment) -> None:
        self.app = app
        self.environment = environment

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_environment(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[ENVIRONMENT_HEADER] = self.environment
            await send(message)

        declared = Headers(scope=scope).getlist(ENVIRONMENT_HEADER)
        # This is an accident guard, not client attestation. JWT and server-side
        # provider policy remain authoritative even when the header is absent.
        if declared and declared != [self.environment]:
            response = JSONResponse(
                status_code=400,
                content={
                    "code": "environment_mismatch",
                    "detail": (
                        "El entorno de la app no coincide con el servidor. "
                        "Revisa su configuración."
                    ),
                },
            )
            await response(scope, receive, send_with_environment)
            return
        await self.app(scope, receive, send_with_environment)
