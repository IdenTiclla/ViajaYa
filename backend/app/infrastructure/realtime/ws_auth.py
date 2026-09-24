"""WebSocket handshake authentication without exposing tokens in the URL."""

from __future__ import annotations

from starlette.websockets import WebSocket

AUTH_SUBPROTOCOL = "viajaya.auth"


def token_from_subprotocol(websocket: WebSocket) -> str | None:
    """Extract the JWT from the protocol that follows ``viajaya.auth``.

    React Native allows passing subprotocols even though it does not allow arbitrary
    HTTP headers. Uvicorn does not log this header in the access log, unlike
    a query param.
    """
    raw = websocket.headers.get("sec-websocket-protocol", "")
    protocols = [item.strip() for item in raw.split(",") if item.strip()]
    try:
        index = protocols.index(AUTH_SUBPROTOCOL)
    except ValueError:
        return None
    if index + 1 >= len(protocols):
        return None
    return protocols[index + 1]

