"""Serialize subject ownership alongside the existing account row locks."""

import hashlib
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.phone_identity import VerifiedIdentity
from app.infrastructure.db.account_access import utc
from app.infrastructure.db.models import UserIdentityModel


class SqlAlchemySocialIdentityRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session

    async def lock(self, provider: str, subject: str) -> None:
        if self.db.bind.dialect.name == "postgresql":
            key = int.from_bytes(
                hashlib.sha256(f"social-account:{provider}:{subject}".encode()).digest()[:8],
                "big", signed=True,
            )
            await self.db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})

    async def find(self, provider: str, subject: str) -> VerifiedIdentity | None:
        row = await self.db.scalar(select(UserIdentityModel).where(
            UserIdentityModel.provider == provider, UserIdentityModel.subject == subject,
        ).execution_options(populate_existing=True))
        return self._identity(row)

    async def for_user(self, user_id: UUID, provider: str) -> VerifiedIdentity | None:
        row = await self.db.scalar(select(UserIdentityModel).where(
            UserIdentityModel.user_id == user_id, UserIdentityModel.provider == provider,
        ).execution_options(populate_existing=True))
        return self._identity(row)

    async def add(self, identity: VerifiedIdentity) -> None:
        self.db.add(UserIdentityModel(
            user_id=identity.user_id, provider=identity.provider,
            subject=identity.subject, verified_at=identity.verified_at,
        ))
        await self.db.flush()

    @staticmethod
    def _identity(row: UserIdentityModel | None) -> VerifiedIdentity | None:
        return VerifiedIdentity(
            row.user_id, row.provider, row.subject, utc(row.verified_at),
        ) if row else None
