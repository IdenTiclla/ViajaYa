"""Resolve provider subjects without treating email as account ownership."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

from app.application.dto import SocialProfile
from app.application.interfaces import SocialIdentityVerifier
from app.domain.entities import User
from app.domain.exceptions import InvalidTokenError, UnsupportedProviderError
from app.domain.phone_identity import IdentityAlreadyLinkedError, VerifiedIdentity
from app.domain.repositories import UserRepository


class SocialIdentityRepository(Protocol):
    async def lock(self, provider: str, subject: str) -> None: ...
    async def find(self, provider: str, subject: str) -> VerifiedIdentity | None: ...
    async def for_user(self, user_id: UUID, provider: str) -> VerifiedIdentity | None: ...
    async def add(self, identity: VerifiedIdentity) -> None: ...


class SocialAccounts:
    def __init__(
        self, identities: SocialIdentityRepository, users: UserRepository,
        verifiers: dict[str, SocialIdentityVerifier],
    ) -> None:
        self.identities, self.users, self.verifiers = identities, users, verifiers

    async def verify(self, provider: str, token: str) -> SocialProfile:
        verifier = self.verifiers.get(provider)
        if not verifier:
            raise UnsupportedProviderError("Este proveedor todavía no está disponible.")
        profile = await verifier.verify(token)
        if profile.provider.value != provider or not 1 <= len(profile.provider_id) <= 255:
            raise InvalidTokenError("La identidad del proveedor no es válida.")
        return profile

    async def owner(self, profile: SocialProfile) -> User | None:
        identity = await self.identities.find(profile.provider.value, profile.provider_id)
        if identity:
            return await self.users.get_by_id(identity.user_id)
        # Historical accounts are matched only by the verified provider subject.
        return await self.users.get_by_provider(profile.provider, profile.provider_id)

    async def link(self, profile: SocialProfile, user_id: UUID, now: datetime) -> None:
        owner = await self.owner(profile)
        existing = await self.identities.for_user(user_id, profile.provider.value)
        if (owner and owner.id != user_id) or (
            existing and existing.subject != profile.provider_id
        ):
            raise IdentityAlreadyLinkedError()
        if not existing:
            await self.identities.add(VerifiedIdentity(
                user_id, profile.provider.value, profile.provider_id, now,
            ))
