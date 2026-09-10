"""Persist verification attempts and serialize budgets across API workers."""

from __future__ import annotations

import hmac
import math
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.phone_verification import PhoneChallenge, RateBudget
from app.domain.phone_identity import (
    InvalidPhoneCodeError,
    PhoneVerificationRateLimitError,
    VerificationPurpose,
)
from app.infrastructure.db.models import PhoneChallengeModel, PhoneRateBudgetModel


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class SqlAlchemyPhoneChallengeStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _reserve(self, budgets: list[RateBudget], now: datetime) -> None:
        insert = pg_insert if self._session.bind.dialect.name == "postgresql" else sqlite_insert
        locked = []
        retry_after = 0
        # Every writer locks the same ordered keys, including brand-new buckets.
        for budget in sorted(budgets, key=lambda item: item.key):
            resets_at = now + timedelta(seconds=budget.window_seconds)
            await self._session.execute(insert(PhoneRateBudgetModel).values(
                key=budget.key, count=0, resets_at=resets_at,
            ).on_conflict_do_nothing(index_elements=["key"]))
            row = await self._session.scalar(select(PhoneRateBudgetModel).where(
                PhoneRateBudgetModel.key == budget.key,
            ).with_for_update().execution_options(populate_existing=True))
            if _utc(row.resets_at) <= now:
                row.count, row.resets_at = 0, resets_at
            if row.count >= budget.limit:
                remaining = math.ceil((_utc(row.resets_at) - now).total_seconds())
                retry_after = max(retry_after, remaining)
            locked.append(row)
        if retry_after:
            await self._session.commit()
            raise PhoneVerificationRateLimitError(retry_after)
        for row in locked:
            row.count += 1

    async def create(
        self, challenge: PhoneChallenge, budgets: list[RateBudget], now: datetime,
    ) -> None:
        await self._reserve(budgets, now)
        await self._session.execute(update(PhoneChallengeModel).where(
            PhoneChallengeModel.phone == challenge.phone,
            PhoneChallengeModel.purpose == challenge.purpose,
            PhoneChallengeModel.actor_user_id == challenge.actor_user_id,
            PhoneChallengeModel.device_digest == challenge.device_digest,
            PhoneChallengeModel.consumed_at.is_(None),
        ).values(expires_at=now, proof_expires_at=now))
        self._session.add(PhoneChallengeModel(
            id=challenge.id, phone=challenge.phone, purpose=challenge.purpose,
            actor_user_id=challenge.actor_user_id,
            device_digest=challenge.device_digest, code_digest=challenge.code_digest,
            provider_id=challenge.provider_id, expires_at=challenge.expires_at, attempts=0,
        ))
        # Bounded cleanup keeps expired phone data out of an indefinitely growing table.
        cutoff = now - timedelta(days=1)
        await self._session.execute(delete(PhoneChallengeModel).where(
            PhoneChallengeModel.id.in_(select(PhoneChallengeModel.id).where(
                PhoneChallengeModel.expires_at < cutoff,
            ).limit(100)),
        ).execution_options(synchronize_session=False))
        await self._session.execute(delete(PhoneRateBudgetModel).where(
            PhoneRateBudgetModel.key.in_(select(PhoneRateBudgetModel.key).where(
                PhoneRateBudgetModel.resets_at < cutoff,
            ).limit(100)),
        ).execution_options(synchronize_session=False))
        await self._session.commit()

    async def verify(
        self, challenge_id: UUID, phone: str, purpose: VerificationPurpose,
        device_digest: str, code_digest: str, proof_digest: str,
        proof_expires_at: datetime, budgets: list[RateBudget], now: datetime,
        *, actor_user_id: UUID | None = None,
    ) -> None:
        await self._reserve(budgets, now)
        row = await self._session.scalar(select(PhoneChallengeModel).where(
            PhoneChallengeModel.id == challenge_id,
        ).with_for_update().execution_options(populate_existing=True))
        # A request may have waited for another worker past the original deadline.
        now = max(now, datetime.now(UTC))
        valid = bool(
            row and row.phone == phone and row.purpose == purpose
            and row.actor_user_id == actor_user_id
            and row.device_digest == device_digest and row.verified_at is None
            and row.attempts < 5 and _utc(row.expires_at) > now
        )
        if valid:
            row.attempts += 1
            valid = hmac.compare_digest(row.code_digest, code_digest)
        if not valid:
            # Failed attempts and request budgets must survive the HTTP error.
            await self._session.commit()
            raise InvalidPhoneCodeError()
        row.verified_at = now
        row.proof_digest = proof_digest
        row.proof_expires_at = proof_expires_at
        await self._session.commit()

    async def consume(
        self, proof_digest: str, phone: str, purpose: VerificationPurpose,
        device_digest: str, now: datetime,
        *, actor_user_id: UUID | None = None,
    ) -> None:
        await self._session.scalar(select(PhoneChallengeModel.id).where(
            PhoneChallengeModel.proof_digest == proof_digest,
        ).with_for_update())
        now = max(now, datetime.now(UTC))
        claimed = await self._session.scalar(update(PhoneChallengeModel).where(
            PhoneChallengeModel.proof_digest == proof_digest,
            PhoneChallengeModel.phone == phone,
            PhoneChallengeModel.purpose == purpose,
            PhoneChallengeModel.actor_user_id == actor_user_id,
            PhoneChallengeModel.device_digest == device_digest,
            PhoneChallengeModel.verified_at.is_not(None),
            PhoneChallengeModel.proof_expires_at > now,
            PhoneChallengeModel.consumed_at.is_(None),
        ).values(consumed_at=now).returning(PhoneChallengeModel.id))
        if claimed is None:
            raise InvalidPhoneCodeError()
        # The eventual account operation commits this claim together with its changes.
