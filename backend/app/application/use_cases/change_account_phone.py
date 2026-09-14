"""Require recent authentication and a new, actor-bound phone proof before replacement."""

from datetime import UTC, datetime
from uuid import UUID

from app.application.dto import TokenPair
from app.application.interfaces import UnitOfWork
from app.application.managed_sessions import ManagedSessions
from app.application.phone_verification import (
    PhoneChallengeStore,
    PhoneNumberNormalizer,
    PhoneVerificationSecrets,
)
from app.domain.entities import User
from app.domain.phone_identity import IdentityAlreadyLinkedError, InvalidPhoneCodeError


class ChangeAccountPhone:
    def __init__(
        self,
        access: ManagedSessions,
        challenges: PhoneChallengeStore,
        normalizer: PhoneNumberNormalizer,
        secrets: PhoneVerificationSecrets,
        uow: UnitOfWork,
    ) -> None:
        self.access, self.challenges, self.normalizer = access, challenges, normalizer
        self.secrets, self.uow = secrets, uow

    async def execute(
        self,
        token: str,
        phone: str,
        verification_token: str,
        device_id: UUID,
    ) -> tuple[User, TokenPair]:
        phone = self.normalizer.normalize(phone)
        await self.access.accounts.lock_phone(phone)
        digest = self.secrets.digest("proof", verification_token)
        proof = await self.access.accounts.get_proof(digest)
        user, current = await self.access.require_recent(token, device_id)
        user = await self.access.accounts.lock_user(user.id)
        # Recheck under the account lock to serialize revocation and phone changes.
        await self.access.require_recent(token, device_id)
        device_digest = self.secrets.digest("device", str(device_id))
        now = datetime.now(UTC)
        if (
            not proof
            or proof.actor_user_id != user.id
            or proof.purpose != "change_phone"
            or proof.phone != phone
            or proof.device_digest != device_digest
            or proof.consumed_at
            or proof.expires_at <= now
        ):
            raise InvalidPhoneCodeError()
        owner = await self.access.accounts.find_by_phone(phone)
        if owner and owner.id != user.id:
            raise IdentityAlreadyLinkedError()
        await self.challenges.consume(
            digest, phone, "change_phone", device_digest, now, actor_user_id=user.id
        )
        await self.access.accounts.set_verified_phone(user.id, phone, now)
        await self.access.sessions.revoke_for_user(user.id, now, "phone_changed")
        grant = await self.access.create(user.id, device_id, current.device_name)
        await self.access.accounts.audit("identity.phone_changed", user.id, user.id, {}, now)
        user = await self.access.accounts.lock_user(user.id)
        await self.uow.commit()
        return user, self.access.tokens.create_session_pair(grant)
