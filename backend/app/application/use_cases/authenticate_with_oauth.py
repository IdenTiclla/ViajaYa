"""Caso de uso: autenticar/registrar mediante un proveedor OAuth (Google/Facebook).

Verifica el token con el proveedor, hace find-or-create del usuario y emite
nuestros propios JWT (reutilizando ``issue_token_pair``).
"""

from __future__ import annotations

from app.application.dto import OAuthLoginInput, TokenPair
from app.application.interfaces import SocialIdentityVerifier, TokenService
from app.application.token_issuer import issue_token_pair
from app.domain.entities import User
from app.domain.exceptions import UnsupportedProviderError
from app.domain.repositories import UserRepository


class AuthenticateWithOAuth:
    def __init__(
        self,
        users: UserRepository,
        tokens: TokenService,
        verifiers: dict[str, SocialIdentityVerifier],
    ) -> None:
        self._users = users
        self._tokens = tokens
        # Indexados por valor del enum AuthProvider ("google", "facebook").
        self._verifiers = verifiers

    async def execute(self, data: OAuthLoginInput) -> tuple[User, TokenPair]:
        verifier = self._verifiers.get(data.provider.value)
        if verifier is None:
            raise UnsupportedProviderError(f"Proveedor no soportado: {data.provider.value}")

        profile = await verifier.verify(data.token)
        user = await self._find_or_create(profile)
        return user, issue_token_pair(self._tokens, user.id)

    async def _find_or_create(self, profile) -> User:
        existing = await self._users.get_by_provider(profile.provider, profile.provider_id)
        if existing:
            return existing

        # Vincula por email si ya hay una cuenta con ese correo.
        by_email = await self._users.get_by_email(profile.email)
        if by_email:
            return by_email

        return await self._users.add(
            User(
                full_name=profile.full_name,
                email=profile.email,
                auth_provider=profile.provider,
                provider_id=profile.provider_id,
            )
        )
