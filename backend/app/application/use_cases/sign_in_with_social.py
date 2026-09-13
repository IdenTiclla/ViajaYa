"""Allow social access only after explicit linking to a verified phone account."""

from datetime import UTC, datetime
from uuid import UUID

from app.application.interfaces import UnitOfWork
from app.application.managed_sessions import ManagedSessions
from app.application.social_accounts import SocialAccounts
from app.application.use_cases.complete_phone_sign_in import PhoneSignInResult
from app.domain.exceptions import InvalidCredentialsError


class SignInWithSocial:
    def __init__(
        self, social: SocialAccounts, access: ManagedSessions, uow: UnitOfWork,
    ) -> None:
        self.social, self.access, self.uow = social, access, uow

    async def execute(
        self, provider: str, token: str, device_id: UUID, device_name: str,
    ) -> PhoneSignInResult:
        profile = await self.social.verify(provider, token)
        await self.social.identities.lock(provider, profile.provider_id)
        owner = await self.social.owner(profile)
        user = await self.access.accounts.lock_user(owner.id) if owner else None
        if user and not user.is_active:
            raise InvalidCredentialsError("La cuenta no está disponible. Solicita una revisión.")
        identity = await self.social.identities.find(provider, profile.provider_id)
        if not user or not user.phone_verified_at or not identity:
            return PhoneSignInResult()
        grant = await self.access.create(user.id, device_id, device_name)
        await self.access.accounts.audit(
            "session.created", user.id, user.id,
            {"source": provider, "session_id": str(grant.session_id)}, datetime.now(UTC),
        )
        await self.uow.commit()
        return PhoneSignInResult(user, self.access.tokens.create_session_pair(grant))
