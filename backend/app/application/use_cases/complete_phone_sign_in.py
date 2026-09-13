"""Complete phone sign-in or explicitly migrate a password account in one transaction."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from app.application.dto import TokenPair
from app.application.interfaces import PasswordHasher, UnitOfWork
from app.application.managed_sessions import ManagedSessions
from app.application.phone_verification import (
    PhoneChallengeStore,
    PhoneNumberNormalizer,
    PhoneVerificationSecrets,
)
from app.application.social_accounts import SocialAccounts
from app.domain.account_access import InvalidAccountProfileError
from app.domain.entities import User
from app.domain.exceptions import InvalidCredentialsError
from app.domain.phone_identity import (
    IdentityAlreadyLinkedError,
    InvalidPhoneCodeError,
    PhoneVerificationUnavailableError,
)


@dataclass(frozen=True)
class PhoneSignInResult:
    user: User | None = None
    tokens: TokenPair | None = None


class CompletePhoneSignIn:
    def __init__(
        self,
        access: ManagedSessions,
        challenges: PhoneChallengeStore,
        secrets: PhoneVerificationSecrets,
        normalizer: PhoneNumberNormalizer,
        passwords: PasswordHasher,
        uow: UnitOfWork,
        *,
        enabled: bool,
        terms_version: str,
        social: SocialAccounts | None = None,
    ) -> None:
        self.access, self.challenges, self.secrets = access, challenges, secrets
        self.normalizer, self.passwords, self.uow = normalizer, passwords, uow
        self.enabled, self.terms_version = enabled, terms_version
        self.social = social

    async def execute(
        self,
        phone: str,
        verification_token: str,
        device_id: UUID,
        device_name: str,
        request_id: UUID,
        *,
        full_name: str | None = None,
        terms_version: str | None = None,
        legacy_email: str | None = None,
        legacy_password: str | None = None,
        social_provider: str | None = None,
        social_token: str | None = None,
    ) -> PhoneSignInResult:
        if not self.enabled:
            raise PhoneVerificationUnavailableError()
        phone = self.normalizer.normalize(phone)
        digest = self.secrets.digest("proof", verification_token)
        device_digest = self.secrets.digest("device", str(device_id))
        accounts = self.access.accounts
        profile = None
        if social_provider is not None:
            if not self.social or not social_token or legacy_email is not None:
                raise InvalidCredentialsError("Vuelve a elegir tu cuenta social.")
            profile = await self.social.verify(social_provider, social_token)
            # Every social mutation locks subject, then phone, then account.
            await self.social.identities.lock(social_provider, profile.provider_id)
        # Phone lock precedes proof/account locks in every phone mutation.
        await accounts.lock_phone(phone)
        proof = await accounts.get_proof(digest)
        now = datetime.now(UTC)
        if (
            not proof
            or proof.phone != phone
            or proof.device_digest != device_digest
            or proof.purpose != "sign_in"
            or proof.actor_user_id
            or proof.expires_at <= now
        ):
            raise InvalidPhoneCodeError()
        if proof.consumed_at:
            receipt = await accounts.get_completion(digest, request_id, device_digest, now)
            user = await accounts.lock_user(receipt.user_id) if receipt else None
            if not user or not user.is_active:
                raise InvalidPhoneCodeError()
            if profile:
                identity = await self.social.identities.find(
                    profile.provider.value, profile.provider_id,
                )
                if not identity or identity.user_id != user.id:
                    raise InvalidPhoneCodeError()
            return PhoneSignInResult(user, self.access.tokens.create_session_pair(receipt))

        user = await accounts.find_by_phone(phone)
        if profile:
            candidate = await self.social.owner(profile)
            if candidate:
                if user and user.id != candidate.id:
                    raise IdentityAlreadyLinkedError()
                user = await accounts.lock_user(candidate.id)
                if user and user.phone_verified_at and user.phone != phone:
                    raise IdentityAlreadyLinkedError()
            elif user:
                user = await accounts.lock_user(user.id)
                if user and user.phone != phone:
                    user = None
        elif legacy_email is not None:
            candidate = await self.access.users.get_by_email(legacy_email.strip().lower())
            candidate = await accounts.lock_user(candidate.id) if candidate else None
            # A verified number cannot be replaced through the legacy password bridge.
            if (
                not candidate
                or candidate.legacy_auth_disabled
                or not candidate.is_active
                or not candidate.hashed_password
                or not legacy_password
                or len(legacy_password.encode("utf-8")) >= 72
                or not self.passwords.verify(legacy_password, candidate.hashed_password)
            ):
                # One credential attempt per proof bounds password guessing even after a valid OTP.
                await self.challenges.consume(digest, phone, "sign_in", device_digest, now)
                await self.uow.commit()
                raise InvalidCredentialsError(
                    "No pudimos vincular la cuenta. Verifica los datos y pide otro código."
                )
            if user and user.id != candidate.id:
                raise IdentityAlreadyLinkedError()
            user = candidate
        elif user:
            user = await accounts.lock_user(user.id)
            # A phone change may have committed while this request waited for the user lock.
            if user and user.phone != phone:
                user = None
        if user and not user.is_active:
            raise InvalidCredentialsError("La cuenta no está disponible. Solicita una revisión.")
        if not user:
            if full_name is None or terms_version is None:
                return PhoneSignInResult()
            full_name = " ".join(full_name.split())
            if len(full_name) < 2 or len(full_name) > 100 or terms_version != self.terms_version:
                raise InvalidAccountProfileError(
                    "Revisa tu nombre y acepta las condiciones vigentes."
                )
            user = await accounts.create(
                User(full_name=full_name, email=None, legacy_auth_disabled=True)
            )
            await accounts.accept_terms(user.id, terms_version, now)
            await accounts.audit("account.created", user.id, user.id, {}, now)
        await self.challenges.consume(digest, phone, "sign_in", device_digest, now)
        if profile:
            await self.social.link(profile, user.id, now)
            await accounts.audit(
                "identity.social_linked", user.id, user.id,
                {"provider": profile.provider.value}, now,
            )
        if not user.phone_verified_at:
            await accounts.set_verified_phone(user.id, phone, now)
            await accounts.audit(
                "identity.phone_verified",
                user.id,
                user.id,
                {"source": profile.provider.value if profile else (
                    "legacy_password" if legacy_email else "phone"
                )},
                now,
            )
            user = await accounts.lock_user(user.id)
        grant = await self.access.create(user.id, device_id, device_name)
        await accounts.save_completion(digest, request_id, device_digest, grant, proof.expires_at)
        await accounts.audit(
            "session.created", user.id, user.id, {"session_id": str(grant.session_id)}, now
        )
        await self.uow.commit()
        return PhoneSignInResult(user, self.access.tokens.create_session_pair(grant))
