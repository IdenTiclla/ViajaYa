"""Account, session, and recovery contracts independent of HTTP and persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from app.application.dto import TokenPair
from app.domain.entities import User
from app.domain.phone_identity import VerificationPurpose


@dataclass(frozen=True)
class SessionClaims:
    user_id: UUID
    session_id: UUID | None
    credential_id: UUID | None
    issued_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class SessionGrant:
    user_id: UUID
    session_id: UUID
    credential_id: UUID
    issued_at: datetime
    access_expires_at: datetime
    refresh_expires_at: datetime


@dataclass(frozen=True)
class ManagedSession:
    id: UUID
    user_id: UUID
    device_id: UUID
    device_name: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None


@dataclass(frozen=True)
class RefreshCredential:
    id: UUID
    session_id: UUID
    issued_at: datetime
    access_expires_at: datetime
    consumed_at: datetime | None = None
    request_id: UUID | None = None
    successor_id: UUID | None = None


@dataclass(frozen=True)
class PhoneProof:
    phone: str
    device_digest: str
    purpose: VerificationPurpose
    actor_user_id: UUID | None
    expires_at: datetime
    consumed_at: datetime | None


class SessionTokenCodec(Protocol):
    def decode_access_claims(self, token: str) -> SessionClaims: ...
    def decode_refresh_claims(self, token: str) -> SessionClaims: ...
    def create_session_pair(self, grant: SessionGrant) -> TokenPair: ...


class SessionRepository(Protocol):
    async def get(self, session_id: UUID, *, lock: bool = False) -> ManagedSession | None: ...
    async def add(self, session: ManagedSession) -> None: ...
    async def list_for_user(self, user_id: UUID) -> list[ManagedSession]: ...
    async def revoke(self, session_id: UUID, now: datetime, reason: str) -> None: ...
    async def revoke_for_user(
        self,
        user_id: UUID,
        now: datetime,
        reason: str,
        *,
        device_id: UUID | None = None,
        except_session_id: UUID | None = None,
    ) -> None: ...
    async def touch(self, session_id: UUID, now: datetime) -> None: ...
    async def get_credential(self, credential_id: UUID) -> RefreshCredential | None: ...
    async def add_credential(self, credential: RefreshCredential) -> None: ...
    async def consume_credential(
        self,
        credential_id: UUID,
        request_id: UUID,
        successor_id: UUID,
        now: datetime,
    ) -> None: ...


class PhoneAccountRepository(Protocol):
    async def lock_phone(self, phone: str) -> None: ...
    async def lock_user(self, user_id: UUID) -> User | None: ...
    async def find_by_phone(self, phone: str) -> User | None: ...
    async def create(self, user: User) -> User: ...
    async def set_verified_phone(self, user_id: UUID, phone: str, now: datetime) -> None: ...
    async def accept_terms(self, user_id: UUID, version: str, now: datetime) -> None: ...
    async def get_proof(self, digest: str, *, lock: bool = True) -> PhoneProof | None: ...
    async def get_completion(
        self,
        proof_digest: str,
        request_id: UUID,
        device_digest: str,
        now: datetime,
    ) -> SessionGrant | None: ...
    async def save_completion(
        self,
        proof_digest: str,
        request_id: UUID,
        device_digest: str,
        grant: SessionGrant,
        expires_at: datetime,
    ) -> None: ...
    async def audit(
        self,
        event: str,
        user_id: UUID | None,
        actor_id: UUID | None,
        details: dict[str, str],
        now: datetime,
    ) -> None: ...
