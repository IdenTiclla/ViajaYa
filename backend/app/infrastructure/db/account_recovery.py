"""Lock recovery cases and preserve review evidence without matching accounts automatically."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.account_recovery import RecoveryRequest
from app.infrastructure.db.account_access import utc
from app.infrastructure.db.models import RecoveryRequestModel


class SqlAlchemyRecoveryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session

    @staticmethod
    def _entity(row: RecoveryRequestModel | None) -> RecoveryRequest | None:
        if not row:
            return None
        values = {name: getattr(row, name) for name in RecoveryRequest.__dataclass_fields__}
        for key in ("created_at", "reviewed_at", "completed_at"):
            if values[key]:
                values[key] = utc(values[key])
        return RecoveryRequest(**values)

    async def get(self, request_id: UUID) -> RecoveryRequest | None:
        row = await self.db.scalar(
            select(RecoveryRequestModel)
            .where(
                RecoveryRequestModel.id == request_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return self._entity(row)

    async def find_by_proof(self, proof_digest: str) -> RecoveryRequest | None:
        row = await self.db.scalar(
            select(RecoveryRequestModel)
            .where(
                RecoveryRequestModel.proof_digest == proof_digest,
            )
            .execution_options(populate_existing=True)
        )
        return self._entity(row)

    async def add(self, request: RecoveryRequest) -> None:
        self.db.add(RecoveryRequestModel(**vars(request)))

    async def review(
        self,
        request_id: UUID,
        user_id: UUID | None,
        reviewer_id: UUID,
        approved: bool,
        evidence_reference: str,
        now: datetime,
    ) -> None:
        await self.db.execute(
            update(RecoveryRequestModel)
            .where(
                RecoveryRequestModel.id == request_id,
            )
            .values(
                user_id=user_id,
                reviewer_id=reviewer_id,
                reviewed_at=now,
                status="approved" if approved else "denied",
                evidence_reference=evidence_reference,
            )
        )

    async def complete(self, request_id: UUID, now: datetime) -> None:
        await self.db.execute(
            update(RecoveryRequestModel)
            .where(
                RecoveryRequestModel.id == request_id,
            )
            .values(status="completed", completed_at=now)
        )
