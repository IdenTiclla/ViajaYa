"""Authorize and audit manual identity review; never expose this to ordinary user roles."""

from datetime import UTC, datetime
from uuid import UUID

from app.application.account_access import PhoneAccountRepository
from app.application.account_recovery import RecoveryRepository, RecoveryReviewer
from app.application.interfaces import UnitOfWork
from app.domain.account_access import AccountAccessDeniedError


class ReviewAccountRecovery:
    def __init__(
        self,
        accounts: PhoneAccountRepository,
        recovery: RecoveryRepository,
        reviewer: RecoveryReviewer,
        uow: UnitOfWork,
    ) -> None:
        self.accounts, self.recovery, self.reviewer, self.uow = accounts, recovery, reviewer, uow

    async def execute(
        self,
        case_id: UUID,
        actor_id: UUID,
        *,
        approved: bool,
        target_user_id: UUID | None,
        evidence_reference: str,
    ) -> None:
        await self.reviewer.authorize(actor_id)
        request = await self.recovery.get(case_id)
        if (
            not request
            or request.status != "pending"
            or len(evidence_reference.strip()) < 8
            or len(evidence_reference) > 255
            or actor_id == target_user_id
        ):
            raise AccountAccessDeniedError()
        if approved:
            user = await self.accounts.lock_user(target_user_id) if target_user_id else None
            if not user or not user.is_active:
                raise AccountAccessDeniedError()
        now = datetime.now(UTC)
        await self.recovery.review(
            case_id, target_user_id, actor_id, approved, evidence_reference.strip(), now
        )
        await self.accounts.audit(
            "recovery.reviewed",
            target_user_id,
            actor_id,
            {"case_id": str(case_id), "approved": str(approved)},
            now,
        )
        await self.uow.commit()
