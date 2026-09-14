"""Certify migration preservation and cross-worker OTP races on disposable PostgreSQL."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.application.use_cases.request_phone_code import RequestPhoneCode
from app.application.use_cases.verify_phone_code import VerifyPhoneCode
from app.domain.phone_identity import InvalidPhoneCodeError, PhoneVerificationRateLimitError
from app.infrastructure.db.models import (
    PhoneChallengeModel,
    PhoneRateBudgetModel,
    UserIdentityModel,
    UserModel,
)
from app.infrastructure.db.phone_challenges import SqlAlchemyPhoneChallengeStore
from app.infrastructure.security.phone_verification import (
    HmacPhoneVerificationSecrets,
    LibPhoneNumberNormalizer,
)

PHONE = "+59171234567"
DEVICE = "84911e87-9189-45fc-919f-47fe0c2fe8cf"
SECRETS = HmacPhoneVerificationSecrets("synthetic-test-secret", "testing")
NORMALIZER = LibPhoneNumberNormalizer(("BO",))


async def clean(factory):
    async with factory() as session:
        await session.execute(delete(PhoneChallengeModel))
        await session.execute(delete(PhoneRateBudgetModel))
        await session.commit()


async def test_migration_preserves_account_ids_roles_and_unverified_legacy_phone(pg_test_db):
    await pg_test_db.migrate_async("downgrade", "0023_outbox_correlation_id")
    factory = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    user_id = uuid4()
    async with factory() as session:
        await session.execute(text(
            "INSERT INTO users (id, full_name, email, role, phone, auth_provider) "
            "VALUES (:id, 'Existing driver', :email, 'driver', :phone, 'local')"
        ), {"id": user_id, "email": f"{user_id}@example.com", "phone": PHONE})
        await session.commit()
    await pg_test_db.migrate_async("upgrade", "0024_phone_verification")
    async with factory() as session:
        user = (await session.execute(text("SELECT role, phone FROM users WHERE id=:id"),
                                      {"id": user_id})).one()
        assert user.role == "driver" and user.phone == PHONE
        assert (await session.scalars(select(UserIdentityModel))).all() == []
        session.add(
            UserIdentityModel(
                provider="phone", subject=PHONE, user_id=user_id, verified_at=datetime.now(UTC)
            )
        )
        await session.commit()
    # The database, rather than an in-process precheck, owns phone uniqueness.
    async with factory() as session:
        session.add(
            UserIdentityModel(
                provider="phone", subject=PHONE, user_id=user_id, verified_at=datetime.now(UTC)
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
    await pg_test_db.migrate_async("downgrade", "0023_outbox_correlation_id")
    async with factory() as session:
        assert await session.scalar(text("SELECT role FROM users WHERE id=:id"),
                                    {"id": user_id}) == "driver"
        await session.execute(delete(UserModel).where(UserModel.id == user_id))
        await session.commit()
    await pg_test_db.migrate_async("upgrade", "head")


async def test_concurrent_sends_allow_only_one_challenge(pg_test_db):
    factory = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    await clean(factory)

    async def request():
        async with factory() as session:
            return await RequestPhoneCode(
                SqlAlchemyPhoneChallengeStore(session),
                NORMALIZER,
                SECRETS,
                mock_enabled=True,
                expose_test_code=True,
            ).execute(PHONE, DEVICE, "192.0.2.1")

    results = await asyncio.gather(*(request() for _ in range(8)), return_exceptions=True)
    assert sum(not isinstance(item, Exception) for item in results) == 1
    assert sum(isinstance(item, PhoneVerificationRateLimitError) for item in results) == 7
    async with factory() as session:
        assert len((await session.scalars(select(PhoneChallengeModel))).all()) == 1


async def test_concurrent_verification_and_consumption_have_single_winners(pg_test_db):
    factory = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    await clean(factory)
    async with factory() as session:
        challenge = await RequestPhoneCode(
            SqlAlchemyPhoneChallengeStore(session),
            NORMALIZER,
            SECRETS,
            mock_enabled=True,
            expose_test_code=True,
        ).execute(PHONE, DEVICE, "192.0.2.1")

    async def verify():
        async with factory() as session:
            return await VerifyPhoneCode(
                SqlAlchemyPhoneChallengeStore(session),
                NORMALIZER,
                SECRETS,
                mock_enabled=True,
            ).execute(challenge.challenge_id, PHONE, challenge.test_code, DEVICE, "192.0.2.1")

    results = await asyncio.gather(*(verify() for _ in range(8)), return_exceptions=True)
    proofs = [item for item in results if not isinstance(item, Exception)]
    assert len(proofs) == 1
    assert sum(isinstance(item, InvalidPhoneCodeError) for item in results) == 7

    async def consume():
        async with factory() as session:
            await SqlAlchemyPhoneChallengeStore(session).consume(
                SECRETS.digest("proof", proofs[0].verification_token),
                PHONE,
                "sign_in",
                SECRETS.digest("device", DEVICE),
                datetime.now(UTC),
            )
            await session.commit()
            return True

    claims = await asyncio.gather(*(consume() for _ in range(8)), return_exceptions=True)
    assert sum(item is True for item in claims) == 1
    assert sum(isinstance(item, InvalidPhoneCodeError) for item in claims) == 7
    async with factory() as session:
        # The disposable database must sit at the current head, whatever it is.
        alembic_ini = Path(__file__).resolve().parents[2] / "alembic.ini"
        head = ScriptDirectory.from_config(Config(str(alembic_ini))).get_current_head()
        assert await session.scalar(text("SELECT version_num FROM alembic_version")) == head


async def test_waiting_for_a_row_lock_cannot_extend_code_validity(pg_test_db):
    factory = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    await clean(factory)
    async with factory() as session:
        challenge = await RequestPhoneCode(
            SqlAlchemyPhoneChallengeStore(session), NORMALIZER, SECRETS,
            mock_enabled=True, expose_test_code=True,
        ).execute(PHONE, DEVICE, "192.0.2.1")
    expires_at = datetime.now(UTC) + timedelta(milliseconds=300)
    async with factory() as session:
        await session.execute(update(PhoneChallengeModel).values(expires_at=expires_at))
        await session.commit()

    async def verify():
        async with factory() as session:
            return await VerifyPhoneCode(
                SqlAlchemyPhoneChallengeStore(session), NORMALIZER, SECRETS, mock_enabled=True,
            ).execute(challenge.challenge_id, PHONE, challenge.test_code, DEVICE, "192.0.2.1")

    async with factory() as blocking_session:
        await blocking_session.scalar(select(PhoneChallengeModel).with_for_update())
        pending = asyncio.create_task(verify())
        try:
            await asyncio.sleep(0.5)
        finally:
            await blocking_session.rollback()
        with pytest.raises(InvalidPhoneCodeError):
            await pending
