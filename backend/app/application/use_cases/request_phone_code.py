"""Issue an isolated, random test challenge without contacting an SMS provider."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.application.phone_verification import (
    PhoneChallenge,
    PhoneChallengeResult,
    PhoneChallengeStore,
    PhoneNumberNormalizer,
    PhoneVerificationSecrets,
    RateBudget,
)
from app.domain.phone_identity import PhoneVerificationUnavailableError, VerificationPurpose


class RequestPhoneCode:
    def __init__(
        self, store: PhoneChallengeStore, normalizer: PhoneNumberNormalizer,
        secrets: PhoneVerificationSecrets, *, mock_enabled: bool,
        expose_test_code: bool, ttl_seconds: int = 300,
    ) -> None:
        self._store = store
        self._normalizer = normalizer
        self._secrets = secrets
        self._mock_enabled = mock_enabled
        self._expose_test_code = expose_test_code
        self._ttl_seconds = ttl_seconds

    async def execute(
        self, phone: str, device_id: str, ip_address: str, *,
        purpose: VerificationPurpose = "sign_in", actor_user_id: UUID | None = None,
    ) -> PhoneChallengeResult:
        # The real adapter is a separate F02-C integration; never fall back to mock.
        if not self._mock_enabled:
            raise PhoneVerificationUnavailableError()
        phone = self._normalizer.normalize(phone)
        now = datetime.now(UTC)
        challenge_id = uuid4()
        code = self._secrets.code()
        expires_at = now + timedelta(seconds=self._ttl_seconds)
        device_digest = self._secrets.digest("device", device_id)
        phone_digest = self._secrets.digest("phone", phone)
        ip_digest = self._secrets.digest("ip", ip_address)
        budgets = [
            RateBudget(f"send:cooldown:{phone_digest}", 1, 60),
            RateBudget(f"send:phone:{phone_digest}", 5, 900),
            RateBudget(f"send:device:{device_digest}", 10, 900),
            RateBudget(f"send:ip:{ip_digest}", 30, 900),
        ]
        await self._store.create(PhoneChallenge(
            id=challenge_id, phone=phone, purpose=purpose, device_digest=device_digest,
            code_digest=self._secrets.digest(f"code:{challenge_id}", code),
            provider_id=f"mock:{challenge_id}", expires_at=expires_at,
            actor_user_id=actor_user_id,
        ), budgets, now)
        return PhoneChallengeResult(
            challenge_id=challenge_id, phone=phone, purpose=purpose, expires_at=expires_at,
            resend_after_seconds=60, test_code=code if self._expose_test_code else None,
        )
