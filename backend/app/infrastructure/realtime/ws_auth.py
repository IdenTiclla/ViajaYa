"""Autenticación del handshake WebSocket sin exponer tokens en la URL."""

from __future__ import annotations

from starlette.websockets import WebSocket

from app.application.interfaces import TokenService
from app.domain.entities import User
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import UserRepository

AUTH_SUBPROTOCOL = "viajaya.auth"


def token_from_subprotocol(websocket: WebSocket) -> str | None:
    """Extrae el JWT del protocolo siguiente a ``viajaya.auth``.

    React Native permite pasar subprotocolos aunque no permita cabeceras HTTP
    arbitrarias. Uvicorn no registra esta cabecera en el access log, a diferencia
    de un query param.
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


async def authenticate_ws(
    token: str | None, users: UserRepository, tokens: TokenService
) -> User | None:
    """Devuelve el usuario del token, o ``None`` si es inválido/inexistente."""
    if not token:
        return None
    try:
        user_id = tokens.decode_access_token(token)
    except InvalidTokenError:
        return None
    return await users.get_by_id(user_id)
