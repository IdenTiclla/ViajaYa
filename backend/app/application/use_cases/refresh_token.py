"""Caso de uso: renovar el par de tokens a partir de un refresh token válido."""

from __future__ import annotations

from app.application.dto import TokenPair
from app.application.interfaces import TokenService
from app.application.token_issuer import issue_token_pair


class RefreshToken:
    def __init__(self, tokens: TokenService) -> None:
        self._tokens = tokens

    async def execute(self, refresh_token: str) -> TokenPair:
        user_id = self._tokens.decode_refresh_token(refresh_token)
        return issue_token_pair(self._tokens, user_id)
