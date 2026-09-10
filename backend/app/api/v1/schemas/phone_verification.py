"""Phone verification schemas; the production response has no test-code field."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PhoneCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phone: str = Field(min_length=8, max_length=40)
    device_id: UUID
    purpose: Literal["sign_in", "recovery"] = "sign_in"


class PhoneCodeVerifyRequest(PhoneCodeRequest):
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{6}$", repr=False)


class PhoneChallengeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    challenge_id: UUID
    phone: str
    purpose: Literal["sign_in", "recovery", "change_phone"]
    expires_at: datetime
    resend_after_seconds: int


class PhoneChangeCodeRequest(PhoneCodeRequest):
    purpose: Literal["change_phone"] = "change_phone"


class PhoneChangeCodeVerifyRequest(PhoneChangeCodeRequest):
    challenge_id: UUID
    code: str = Field(pattern=r"^[0-9]{6}$", repr=False)


class TestPhoneChallengeResponse(PhoneChallengeResponse):
    test_code: str | None = Field(default=None, repr=False)


class PhoneVerificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    verification_token: str = Field(repr=False)
    expires_at: datetime
