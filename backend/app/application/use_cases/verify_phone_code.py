"""Verify once and return a short-lived proof, never an operational session."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.application.phone_verification import (
    PhoneChallengeStore,
    PhoneNumberNormalizer,
    PhoneVerificationResult,
    PhoneVerificationSecrets,
    RateBudget,
)
from app.domain.phone_identity import PhoneVerificationUnavailableError, VerificationPurpose


class VerifyPhoneCode:
    def __init__(
        self, store: PhoneChallengeStore, normalizer: PhoneNumberNormalizer,
        secrets: PhoneVerificationSecrets, *, mock_enabled: bool,
    ) -> None:
        self._store = store
        self._normalizer = normalizer
        self._secrets = secrets
        self._mock_enabled = mock_enabled

    async def execute(
        self, challenge_id: UUID, phone: str, code: str, device_id: str, ip_address: str,
        *, purpose: VerificationPurpose = "sign_in", actor_user_id: UUID | None = None,
    ) -> PhoneVerificationResult:
        if not self._mock_enabled:
            raise PhoneVerificationUnavailableError()
        phone = self._normalizer.normalize(phone)
        now = datetime.now(UTC)
        token = self._secrets.token()
        expires_at = now + timedelta(minutes=5)
        device_digest = self._secrets.digest("device", device_id)
        ip_digest = self._secrets.digest("ip", ip_address)
        await self._store.verify(
            challenge_id, phone, purpose, device_digest,
            self._secrets.digest(f"code:{challenge_id}", code),
            self._secrets.digest("proof", token), expires_at,
            [RateBudget(f"verify:device:{device_digest}", 30, 300),
             RateBudget(f"verify:ip:{ip_digest}", 100, 300)], now,
            actor_user_id=actor_user_id,
        )
        return PhoneVerificationResult(token, expires_at)
