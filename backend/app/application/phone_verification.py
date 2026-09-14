"""Ports and transport-independent results for the phone verification boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol
from uuid import UUID

from app.domain.phone_identity import VerificationPurpose


@dataclass(frozen=True)
class PhoneChallenge:
    id: UUID
    phone: str
    purpose: VerificationPurpose
    device_digest: str
    code_digest: str = field(repr=False)
    provider_id: str
    expires_at: datetime
    actor_user_id: UUID | None = None


@dataclass(frozen=True)
class PhoneChallengeResult:
    challenge_id: UUID
    phone: str
    purpose: VerificationPurpose
    expires_at: datetime
    resend_after_seconds: int
    test_code: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class PhoneVerificationResult:
    verification_token: str = field(repr=False)
    expires_at: datetime


@dataclass(frozen=True)
class RateBudget:
    key: str
    limit: int
    window_seconds: int


class PhoneNumberNormalizer(Protocol):
    def normalize(self, phone: str) -> str: ...


class PhoneVerificationSecrets(Protocol):
    def code(self) -> str: ...

    def token(self) -> str: ...

    def digest(self, scope: str, value: str) -> str: ...


class PhoneChallengeStore(Protocol):
    """Each operation atomically commits its challenge and rate-limit mutations."""

    async def create(
        self, challenge: PhoneChallenge, budgets: list[RateBudget], now: datetime,
    ) -> None: ...

    async def verify(
        self, challenge_id: UUID, phone: str, purpose: VerificationPurpose,
        device_digest: str, code_digest: str, proof_digest: str,
        proof_expires_at: datetime, budgets: list[RateBudget], now: datetime,
        *, actor_user_id: UUID | None = None,
    ) -> None: ...

    async def consume(
        self, proof_digest: str, phone: str, purpose: VerificationPurpose,
        device_digest: str, now: datetime,
        *, actor_user_id: UUID | None = None,
    ) -> None:
        """Consume within the caller's account transaction; do not commit here."""
        ...
