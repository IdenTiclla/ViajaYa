"""Caso de uso: renovar el par de tokens a partir de un refresh token válido."""

from __future__ import annotations

from app.application.dto import TokenPair
from app.application.interfaces import TokenService
from app.application.token_issuer import issue_token_pair
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import UserRepository


class RefreshToken:
    def __init__(self, tokens: TokenService, users: UserRepository) -> None:
        self._tokens = tokens
        self._users = users

    async def execute(self, refresh_token: str) -> TokenPair:
        user_id = self._tokens.decode_refresh_token(refresh_token)
        if await self._users.get_by_id(user_id) is None:
            raise InvalidTokenError("La sesión ya no es válida. Inicia sesión nuevamente.")
        return issue_token_pair(self._tokens, user_id)
