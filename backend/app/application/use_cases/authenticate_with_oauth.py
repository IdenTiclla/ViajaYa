"""Keep existing social accounts accessible while phone migration rolls out."""

from __future__ import annotations

from app.application.dto import OAuthLoginInput, TokenPair
from app.application.interfaces import SocialIdentityVerifier, TokenService
from app.application.token_issuer import issue_token_pair
from app.domain.entities import User
from app.domain.exceptions import InvalidCredentialsError, UnsupportedProviderError
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
        user = await self._users.get_by_provider(profile.provider, profile.provider_id)
        if not user or user.legacy_auth_disabled or not user.is_active:
            raise InvalidCredentialsError("Verifica tu teléfono para iniciar sesión.")
        return user, issue_token_pair(self._tokens, user.id)
