"""Public phone onboarding and owned-session contracts."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.api.v1.schemas.auth import AuthResponse


class PhoneCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phone: str = Field(min_length=8, max_length=40)
    verification_token: str = Field(min_length=20, max_length=256, repr=False)
    device_id: UUID
    device_name: str = Field(default="Teléfono", min_length=1, max_length=100)
    request_id: UUID
    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    terms_version: str | None = Field(default=None, max_length=80)


class LegacyPhoneLinkRequest(PhoneCompleteRequest):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256, repr=False)


class PhoneCompleteResponse(BaseModel):
    status: Literal["profile_required", "authenticated"]
    auth: AuthResponse | None = None


class PhoneCountry(BaseModel):
    region: str
    calling_code: str


class PhoneCapabilitiesResponse(BaseModel):
    enabled: bool
    countries: list[PhoneCountry]
    terms_version: str
    terms_text: str


class AccountSessionResponse(BaseModel):
    id: UUID
    device_name: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool


class AccountSessionsResponse(BaseModel):
    sessions: list[AccountSessionResponse]
    managed: bool


class LogoutRequest(BaseModel):
    refresh_token: str = Field(max_length=4096, repr=False)


class PhoneChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phone: str = Field(min_length=8, max_length=40)
    verification_token: str = Field(min_length=20, max_length=256, repr=False)
    device_id: UUID


class RecoverySubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verification_token: str = Field(min_length=20, max_length=256, repr=False)
    device_id: UUID
    request_id: UUID
    account_hint: str = Field(min_length=3, max_length=255)
    reason: str = Field(min_length=10, max_length=1000)


class RecoveryCaseResponse(BaseModel):
    case_id: UUID
    status: str


class RecoveryCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: UUID
    verification_token: str = Field(min_length=20, max_length=256, repr=False)
    device_id: UUID
    request_id: UUID
    device_name: str = Field(default="Teléfono", min_length=1, max_length=100)
