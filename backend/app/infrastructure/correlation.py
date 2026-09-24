"""Safe correlation of requests, logs and asynchronous effects."""

from __future__ import annotations

import logging
import re
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token

from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_HEADER_BYTES = REQUEST_ID_HEADER.lower().encode("ascii")
_correlation_id: ContextVar[uuid.UUID | None] = ContextVar(
    "viajaya_correlation_id",
    default=None,
)
logger = logging.getLogger(__name__)

# Equivalent to Zod 4's ``z.string().uuid()`` contract: RFC 9562/4122 UUIDs,
# versions 1-8, plus the nil/max values the parser explicitly accepts.
_CLIENT_UUID_PATTERN = re.compile(
    r"^(?:"
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
    r"|00000000-0000-0000-0000-000000000000"
    r"|ffffffff-ffff-ffff-ffff-ffffffffffff"
    r")$"
)
_UNRESOLVED_ROUTE = "<unresolved>"


def current_correlation_id() -> uuid.UUID | None:
    """Return the current context's ID without creating implicit state."""
    return _correlation_id.get()


@contextmanager
def correlation_scope(
    correlation_id: uuid.UUID | None = None,
) -> Iterator[uuid.UUID]:
    """Isolate an ID so concurrent tasks never share context."""
    resolved = correlation_id or uuid.uuid4()
    token: Token[uuid.UUID | None] = _correlation_id.set(resolved)
    try:
        yield resolved
    finally:
        _correlation_id.reset(token)


def _incoming_correlation_id(scope: Scope) -> uuid.UUID:
    values = [
        value
        for name, value in scope.get("headers", [])
        if name.lower() == _REQUEST_ID_HEADER_BYTES
    ]
    if len(values) != 1:
        return uuid.uuid4()
    try:
        raw_value = values[0].decode("ascii")
    except (UnicodeDecodeError, ValueError):
        return uuid.uuid4()
    if _CLIENT_UUID_PATTERN.fullmatch(raw_value) is None:
        return uuid.uuid4()
    return uuid.UUID(raw_value)


def _with_response_header(message: Message, correlation_id: uuid.UUID) -> Message:
    if message["type"] not in {"http.response.start", "websocket.accept"}:
        return message
    headers = [
        (name, value)
        for name, value in message.get("headers", [])
        if name.lower() != _REQUEST_ID_HEADER_BYTES
    ]
    headers.append((_REQUEST_ID_HEADER_BYTES, str(correlation_id).encode("ascii")))
    return {**message, "headers": headers}


class CorrelationIdMiddleware:
    """Propagate a UUID per request without logging query, headers or payloads."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        scope_type = scope["type"]
        if scope_type not in {"http", "websocket"}:
            await self._app(scope, receive, send)
            return

        correlation_id = _incoming_correlation_id(scope)
        scope.setdefault("state", {})["correlation_id"] = str(correlation_id)
        started_at = time.perf_counter()
        outcome: int | str = "interrupted"
        response_started = False

        async def send_correlated(message: Message) -> None:
            nonlocal outcome, response_started
            if message["type"] == "http.response.start":
                outcome = int(message["status"])
                response_started = True
            elif message["type"] == "websocket.close":
                outcome = int(message.get("code", 1000))
            await send(_with_response_header(message, correlation_id))

        with correlation_scope(correlation_id):
            try:
                await self._app(scope, receive, send_correlated)
            except Exception as error:  # noqa: BLE001 - last-resort ASGI boundary
                if scope_type != "http" or response_started:
                    raise
                logger.error(
                    "Solicitud HTTP terminó con un error inesperado "
                    "error_type=%s correlation_id=%s.",
                    type(error).__name__,
                    correlation_id,
                )
                body = b"Internal Server Error"
                await send_correlated(
                    {
                        "type": "http.response.start",
                        "status": 500,
                        "headers": [
                            (b"content-length", str(len(body)).encode("ascii")),
                            (b"content-type", b"text/plain; charset=utf-8"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
            finally:
                route = scope.get("route")
                route_path = getattr(route, "path", _UNRESOLVED_ROUTE)
                duration_ms = (time.perf_counter() - started_at) * 1000
                logger.info(
                    "%s %s outcome=%s duration_ms=%.1f correlation_id=%s",
                    scope_type.upper(),
                    route_path,
                    outcome,
                    duration_ms,
                    correlation_id,
                )
