"""Helper compartido para emitir pares de tokens (DRY).

Reutilizado por el login local y por el login social, de modo que la forma de
emitir JWT propios es única en toda la aplicación.
"""

from __future__ import annotations

import uuid

from app.application.dto import TokenPair
from app.application.interfaces import TokenService


def issue_token_pair(tokens: TokenService, user_id: uuid.UUID) -> TokenPair:
    return TokenPair(
        access_token=tokens.create_access_token(user_id),
        refresh_token=tokens.create_refresh_token(user_id),
    )
