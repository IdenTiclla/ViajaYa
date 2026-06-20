"""Autenticación del handshake WebSocket.

React Native no permite cabeceras en ``WebSocket``, así que el access token viaja
como query param ``?token=…``. Usar siempre ``wss://`` en producción para que el
token viaje cifrado; el access token es de vida corta (mitiga fuga en logs/URL).
"""

from __future__ import annotations

from app.application.interfaces import TokenService
from app.domain.entities import User
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import UserRepository


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
