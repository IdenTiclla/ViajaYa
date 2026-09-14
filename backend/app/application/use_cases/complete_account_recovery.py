"""Apply an approved case only after a fresh proof of the reviewed contact number."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.application.account_recovery import RecoveryRepository
from app.application.interfaces import UnitOfWork
from app.application.managed_sessions import ManagedSessions
from app.application.phone_verification import PhoneChallengeStore, PhoneVerificationSecrets
from app.application.use_cases.complete_phone_sign_in import PhoneSignInResult
from app.domain.account_access import AccountAccessDeniedError
from app.domain.phone_identity import IdentityAlreadyLinkedError, InvalidPhoneCodeError


class CompleteAccountRecovery:
    def __init__(
        self,
        access: ManagedSessions,
        recovery: RecoveryRepository,
        challenges: PhoneChallengeStore,
        secrets: PhoneVerificationSecrets,
        uow: UnitOfWork,
    ) -> None:
        self.access, self.recovery, self.challenges = access, recovery, challenges
        self.secrets, self.uow = secrets, uow

    async def execute(
        self,
        case_id: UUID,
        verification_token: str,
        device_id: UUID,
        device_name: str,
        request_id: UUID,
    ) -> PhoneSignInResult:
        digest = self.secrets.digest("proof", verification_token)
        device_digest = self.secrets.digest("device", str(device_id))
        unlocked = await self.access.accounts.get_proof(digest, lock=False)
        if not unlocked:
            raise InvalidPhoneCodeError()
        await self.access.accounts.lock_phone(unlocked.phone)
        proof = await self.access.accounts.get_proof(digest)
        now = datetime.now(UTC)
        if (
            not proof
            or proof.purpose != "recovery"
            or proof.device_digest != device_digest
            or proof.actor_user_id
            or proof.expires_at <= now
        ):
            raise InvalidPhoneCodeError()
        request = await self.recovery.get(case_id)
        if not request or request.contact_phone != proof.phone:
            raise AccountAccessDeniedError()
        if proof.consumed_at:
            receipt = await self.access.accounts.get_completion(
                digest, request_id, device_digest, now
            )
            user = await self.access.accounts.lock_user(receipt.user_id) if receipt else None
            if not user or not user.is_active or user.id != request.user_id:
                raise InvalidPhoneCodeError()
            return PhoneSignInResult(user, self.access.tokens.create_session_pair(receipt))
        if (
            request.status != "approved"
            or not request.user_id
            or not request.reviewed_at
            or request.reviewed_at + timedelta(hours=24) <= now
            or digest == request.proof_digest
        ):
            raise AccountAccessDeniedError(
                "La recuperación aún no está aprobada o debe revisarse otra vez."
            )
        user = await self.access.accounts.lock_user(request.user_id)
        if not user or not user.is_active:
            raise AccountAccessDeniedError()
        owner = await self.access.accounts.find_by_phone(proof.phone)
        if owner and owner.id != user.id:
            raise IdentityAlreadyLinkedError()
        await self.challenges.consume(digest, proof.phone, "recovery", device_digest, now)
        await self.access.accounts.set_verified_phone(user.id, proof.phone, now)
        await self.access.sessions.revoke_for_user(user.id, now, "account_recovered")
        grant = await self.access.create(user.id, device_id, device_name)
        await self.recovery.complete(case_id, now)
        await self.access.accounts.save_completion(
            digest, request_id, device_digest, grant, proof.expires_at
        )
        await self.access.accounts.audit(
            "recovery.completed", user.id, request.reviewer_id, {"case_id": str(case_id)}, now
        )
        user = await self.access.accounts.lock_user(user.id)
        await self.uow.commit()
        return PhoneSignInResult(user, self.access.tokens.create_session_pair(grant))
