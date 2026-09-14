"""Recovery requires separate operator authorization; contact proof alone grants no account."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True)
class RecoveryRequest:
    id: UUID
    proof_digest: str
    device_digest: str
    request_id: UUID
    contact_phone: str
    account_hint: str
    reason: str
    created_at: datetime
    status: str = "pending"
    user_id: UUID | None = None
    reviewer_id: UUID | None = None
    evidence_reference: str | None = None
    reviewed_at: datetime | None = None
    completed_at: datetime | None = None


class RecoveryRepository(Protocol):
    async def get(self, request_id: UUID) -> RecoveryRequest | None: ...
    async def find_by_proof(self, proof_digest: str) -> RecoveryRequest | None: ...
    async def add(self, request: RecoveryRequest) -> None: ...
    async def review(
        self,
        request_id: UUID,
        user_id: UUID | None,
        reviewer_id: UUID,
        approved: bool,
        evidence_reference: str,
        now: datetime,
    ) -> None: ...
    async def complete(self, request_id: UUID, now: datetime) -> None: ...


class RecoveryReviewer(Protocol):
    async def authorize(self, actor_id: UUID) -> None:
        """Require an active operator, recovery permission, and recent step-up authentication."""
        ...
