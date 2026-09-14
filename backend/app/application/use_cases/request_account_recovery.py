"""Record a contact-verified recovery request without revealing or selecting an account."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.application.account_access import PhoneAccountRepository
from app.application.account_recovery import RecoveryRepository, RecoveryRequest
from app.application.interfaces import UnitOfWork
from app.application.phone_verification import PhoneChallengeStore, PhoneVerificationSecrets
from app.domain.phone_identity import InvalidPhoneCodeError


class RequestAccountRecovery:
    def __init__(
        self,
        accounts: PhoneAccountRepository,
        recovery: RecoveryRepository,
        challenges: PhoneChallengeStore,
        secrets: PhoneVerificationSecrets,
        uow: UnitOfWork,
    ) -> None:
        self.accounts, self.recovery, self.challenges = accounts, recovery, challenges
        self.secrets, self.uow = secrets, uow

    async def execute(
        self,
        verification_token: str,
        device_id: UUID,
        request_id: UUID,
        account_hint: str,
        reason: str,
    ) -> RecoveryRequest:
        digest = self.secrets.digest("proof", verification_token)
        device_digest = self.secrets.digest("device", str(device_id))
        proof = await self.accounts.get_proof(digest)
        now = datetime.now(UTC)
        if (
            not proof
            or proof.purpose != "recovery"
            or proof.device_digest != device_digest
            or proof.actor_user_id
            or proof.expires_at <= now
        ):
            raise InvalidPhoneCodeError()
        previous = await self.recovery.find_by_proof(digest)
        if previous and previous.request_id == request_id:
            return previous
        if proof.consumed_at:
            raise InvalidPhoneCodeError()
        await self.challenges.consume(digest, proof.phone, "recovery", device_digest, now)
        request = RecoveryRequest(
            uuid4(),
            digest,
            device_digest,
            request_id,
            proof.phone,
            account_hint.strip(),
            reason.strip(),
            now,
        )
        await self.recovery.add(request)
        await self.accounts.audit(
            "recovery.requested", None, None, {"case_id": str(request.id)}, now
        )
        await self.uow.commit()
        return request
