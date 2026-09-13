"""Transactional account and session persistence; callers own the commit boundary."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.account_access import (
    ManagedSession,
    PhoneProof,
    RefreshCredential,
    SessionGrant,
)
from app.domain.entities import User
from app.infrastructure.db.models import (
    AccountAuditModel,
    AuthSessionModel,
    PhoneChallengeModel,
    PhoneCompletionModel,
    RefreshCredentialModel,
    UserIdentityModel,
    UserModel,
)
from app.infrastructure.db.repositories import _to_entity


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _managed(row: AuthSessionModel) -> ManagedSession:
    return ManagedSession(
        row.id,
        row.user_id,
        row.device_id,
        row.device_name,
        utc(row.created_at),
        utc(row.last_seen_at),
        utc(row.expires_at),
        utc(row.revoked_at) if row.revoked_at else None,
    )


class SqlAlchemySessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session

    async def get(self, session_id: UUID, *, lock: bool = False) -> ManagedSession | None:
        query = select(AuthSessionModel).where(AuthSessionModel.id == session_id)
        if lock:
            query = query.with_for_update()
        row = await self.db.scalar(query.execution_options(populate_existing=True))
        return _managed(row) if row else None

    async def add(self, session: ManagedSession) -> None:
        self.db.add(AuthSessionModel(**vars(session)))
        await self.db.flush()

    async def list_for_user(self, user_id: UUID) -> list[ManagedSession]:
        rows = await self.db.scalars(
            select(AuthSessionModel)
            .where(
                AuthSessionModel.user_id == user_id,
                AuthSessionModel.revoked_at.is_(None),
                AuthSessionModel.expires_at > datetime.now(UTC),
            )
            .order_by(AuthSessionModel.created_at.desc())
        )
        return [_managed(row) for row in rows]

    async def revoke(self, session_id: UUID, now: datetime, reason: str) -> None:
        await self.db.execute(
            update(AuthSessionModel)
            .where(
                AuthSessionModel.id == session_id,
                AuthSessionModel.revoked_at.is_(None),
            )
            .values(revoked_at=now, revocation_reason=reason)
        )

    async def revoke_for_user(
        self,
        user_id: UUID,
        now: datetime,
        reason: str,
        *,
        device_id: UUID | None = None,
        except_session_id: UUID | None = None,
    ) -> None:
        query = update(AuthSessionModel).where(
            AuthSessionModel.user_id == user_id,
            AuthSessionModel.revoked_at.is_(None),
        )
        if device_id:
            query = query.where(AuthSessionModel.device_id == device_id)
        if except_session_id:
            query = query.where(AuthSessionModel.id != except_session_id)
        await self.db.execute(query.values(revoked_at=now, revocation_reason=reason))

    async def touch(self, session_id: UUID, now: datetime) -> None:
        await self.db.execute(
            update(AuthSessionModel)
            .where(
                AuthSessionModel.id == session_id,
            )
            .values(last_seen_at=now)
        )

    async def get_credential(self, credential_id: UUID) -> RefreshCredential | None:
        row = await self.db.scalar(
            select(RefreshCredentialModel)
            .where(
                RefreshCredentialModel.id == credential_id,
            )
            .execution_options(populate_existing=True)
        )
        return (
            RefreshCredential(
                row.id,
                row.session_id,
                utc(row.issued_at),
                utc(row.access_expires_at),
                utc(row.consumed_at) if row.consumed_at else None,
                row.request_id,
                row.successor_id,
            )
            if row
            else None
        )

    async def add_credential(self, credential: RefreshCredential) -> None:
        self.db.add(RefreshCredentialModel(**vars(credential)))
        await self.db.flush()

    async def consume_credential(
        self,
        credential_id: UUID,
        request_id: UUID,
        successor_id: UUID,
        now: datetime,
    ) -> None:
        await self.db.execute(
            update(RefreshCredentialModel)
            .where(
                RefreshCredentialModel.id == credential_id,
            )
            .values(consumed_at=now, request_id=request_id, successor_id=successor_id)
        )


class SqlAlchemyPhoneAccountRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session

    async def lock_phone(self, phone: str) -> None:
        if self.db.bind.dialect.name == "postgresql":
            key = int.from_bytes(
                hashlib.sha256(f"phone-account:{phone}".encode()).digest()[:8], "big", signed=True
            )
            await self.db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})

    async def lock_user(self, user_id: UUID) -> User | None:
        row = await self.db.scalar(
            select(UserModel)
            .where(UserModel.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return _to_entity(row) if row else None

    async def find_by_phone(self, phone: str) -> User | None:
        row = await self.db.scalar(
            select(UserModel)
            .join(
                UserIdentityModel,
                UserIdentityModel.user_id == UserModel.id,
            )
            .where(UserIdentityModel.provider == "phone", UserIdentityModel.subject == phone)
            .execution_options(populate_existing=True)
        )
        return _to_entity(row) if row else None

    async def create(self, user: User) -> User:
        row = UserModel(**vars(user))
        self.db.add(row)
        await self.db.flush()
        await self.db.refresh(row)
        return _to_entity(row)

    async def set_verified_phone(self, user_id: UUID, phone: str, now: datetime) -> None:
        await self.db.execute(
            delete(UserIdentityModel).where(
                UserIdentityModel.user_id == user_id,
                UserIdentityModel.provider == "phone",
            )
        )
        self.db.add(
            UserIdentityModel(provider="phone", subject=phone, user_id=user_id, verified_at=now)
        )
        await self.db.execute(
            update(UserModel)
            .where(UserModel.id == user_id)
            .values(phone=phone, phone_verified_at=now)
        )
        await self.db.flush()

    async def accept_terms(self, user_id: UUID, version: str, now: datetime) -> None:
        await self.db.execute(
            update(UserModel)
            .where(UserModel.id == user_id)
            .values(
                terms_version=version,
                terms_accepted_at=now,
            )
        )

    async def get_proof(self, digest: str, *, lock: bool = True) -> PhoneProof | None:
        query = select(PhoneChallengeModel).where(PhoneChallengeModel.proof_digest == digest)
        if lock:
            query = query.with_for_update()
        row = await self.db.scalar(query.execution_options(populate_existing=True))
        if not row or not row.verified_at or not row.proof_expires_at:
            return None
        return PhoneProof(
            row.phone,
            row.device_digest,
            row.purpose,
            row.actor_user_id,
            utc(row.proof_expires_at),
            utc(row.consumed_at) if row.consumed_at else None,
        )

    async def get_completion(
        self,
        proof_digest: str,
        request_id: UUID,
        device_digest: str,
        now: datetime,
    ) -> SessionGrant | None:
        result = (
            await self.db.execute(
                select(PhoneCompletionModel, AuthSessionModel, RefreshCredentialModel)
                .join(
                    AuthSessionModel,
                    AuthSessionModel.id == PhoneCompletionModel.session_id,
                )
                .join(
                    RefreshCredentialModel,
                    RefreshCredentialModel.id == PhoneCompletionModel.credential_id,
                )
                .where(
                    PhoneCompletionModel.proof_digest == proof_digest,
                    PhoneCompletionModel.request_id == request_id,
                    PhoneCompletionModel.device_digest == device_digest,
                    PhoneCompletionModel.expires_at > now,
                    AuthSessionModel.revoked_at.is_(None),
                    AuthSessionModel.expires_at > now,
                    RefreshCredentialModel.consumed_at.is_(None),
                )
            )
        ).first()
        if not result:
            return None
        _, session, credential = result
        return SessionGrant(
            session.user_id,
            session.id,
            credential.id,
            utc(credential.issued_at),
            utc(credential.access_expires_at),
            utc(session.expires_at),
        )

    async def save_completion(
        self,
        proof_digest: str,
        request_id: UUID,
        device_digest: str,
        grant: SessionGrant,
        expires_at: datetime,
    ) -> None:
        self.db.add(
            PhoneCompletionModel(
                proof_digest=proof_digest,
                request_id=request_id,
                device_digest=device_digest,
                session_id=grant.session_id,
                credential_id=grant.credential_id,
                expires_at=expires_at,
            )
        )

    async def audit(
        self,
        event: str,
        user_id: UUID | None,
        actor_id: UUID | None,
        details: dict[str, str],
        now: datetime,
    ) -> None:
        self.db.add(
            AccountAuditModel(
                event=event, user_id=user_id, actor_id=actor_id, details=details, created_at=now
            )
        )
