"""Certify account and credential races on the real PostgreSQL lock boundary."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.deps import (
    build_managed_sessions,
    get_complete_phone_sign_in,
    get_refresh_token,
    get_request_phone_code,
    get_social_accounts,
    get_verify_phone_code,
)
from app.domain.entities import AuthProvider
from app.domain.phone_identity import IdentityAlreadyLinkedError, InvalidPhoneCodeError
from app.infrastructure.config import Settings
from app.infrastructure.db.account_access import SqlAlchemyPhoneAccountRepository
from app.infrastructure.db.models import (
    AccountAuditModel,
    AuthSessionModel,
    PhoneChallengeModel,
    PhoneCompletionModel,
    PhoneRateBudgetModel,
    RecoveryRequestModel,
    RefreshCredentialModel,
    UserIdentityModel,
    UserModel,
)
from tests.fakes import FakeVerifier
from tests.unit.test_environment import environment_values

PHONE = "+59173456789"
SETTINGS = Settings(_env_file=None, phone_otp_enabled=True, **environment_values("development"))


@pytest_asyncio.fixture
async def accounts_db(pg_test_db):
    factory = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    yield factory
    async with factory() as session:
        for model in (
            RecoveryRequestModel,
            PhoneCompletionModel,
            RefreshCredentialModel,
            AuthSessionModel,
            UserIdentityModel,
            AccountAuditModel,
            PhoneChallengeModel,
            PhoneRateBudgetModel,
        ):
            await session.execute(delete(model))
        await session.execute(delete(UserModel).where(UserModel.email.is_(None)))
        await session.commit()


async def proof(factory, phone=PHONE):
    device_id = uuid4()
    async with factory() as session:
        challenge = await get_request_phone_code(session, SETTINGS).execute(
            phone, str(device_id), "127.0.0.1"
        )
        result = await get_verify_phone_code(session, SETTINGS).execute(
            challenge.challenge_id,
            phone,
            challenge.test_code,
            str(device_id),
            "127.0.0.1",
        )
    return {
        "phone": phone,
        "device_id": device_id,
        "device_name": "PostgreSQL test",
        "verification_token": result.verification_token,
        "request_id": uuid4(),
    }


async def complete(factory, payload):
    async with factory() as session:
        access = build_managed_sessions(session, SETTINGS)
        use_case = get_complete_phone_sign_in(
            session, SETTINGS, access, get_social_accounts(session, access.users, {
                "google": FakeVerifier(AuthProvider.GOOGLE),
            }),
        )
        return await use_case.execute(**payload)


async def test_eight_identical_completion_retries_create_one_account_and_session(accounts_db):
    payload = {
        **await proof(accounts_db),
        "full_name": "Concurrent User",
        "terms_version": "testing-2026-09",
    }
    results = await asyncio.gather(*(complete(accounts_db, payload) for _ in range(8)))
    assert len({result.user.id for result in results}) == 1
    assert len({result.tokens.refresh_token for result in results}) == 1
    async with accounts_db() as session:
        assert await session.scalar(select(func.count()).select_from(AuthSessionModel)) == 1
        assert await session.scalar(select(func.count()).select_from(RefreshCredentialModel)) == 1


async def test_completion_proof_cannot_be_claimed_by_different_requests(accounts_db):
    payload = {
        **await proof(accounts_db),
        "full_name": "Concurrent User",
        "terms_version": "testing-2026-09",
    }
    results = await asyncio.gather(
        *(complete(accounts_db, {**payload, "request_id": uuid4()}) for _ in range(8)),
        return_exceptions=True,
    )
    assert sum(not isinstance(result, Exception) for result in results) == 1
    assert sum(isinstance(result, InvalidPhoneCodeError) for result in results) == 7


async def test_simultaneous_refresh_retries_rotate_only_once(accounts_db):
    result = await complete(
        accounts_db,
        {
            **await proof(accounts_db),
            "full_name": "Refresh User",
            "terms_version": "testing-2026-09",
        },
    )
    request_id = uuid4()

    async def rotate():
        async with accounts_db() as session:
            use_case = get_refresh_token(session, build_managed_sessions(session, SETTINGS))
            return await use_case.execute(result.tokens.refresh_token, request_id)

    results = await asyncio.gather(*(rotate() for _ in range(8)))
    assert len({tokens.refresh_token for tokens in results}) == 1
    async with accounts_db() as session:
        assert await session.scalar(select(func.count()).select_from(RefreshCredentialModel)) == 2


async def test_waiting_sign_in_cannot_restore_the_previous_phone_owner(accounts_db):
    first = await complete(
        accounts_db,
        {
            **await proof(accounts_db),
            "full_name": "Original User",
            "terms_version": "testing-2026-09",
        },
    )
    async with accounts_db() as session:
        await session.execute(
            update(PhoneRateBudgetModel).values(resets_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    payload = await proof(accounts_db)
    reached_user_lock = asyncio.Event()
    async with accounts_db() as owner:
        accounts = SqlAlchemyPhoneAccountRepository(owner)
        await accounts.lock_user(first.user.id)

        async def waiting_sign_in():
            async with accounts_db() as session:
                access = build_managed_sessions(session, SETTINGS)
                original_lock = access.accounts.lock_user

                async def observed_lock(user_id):
                    reached_user_lock.set()
                    return await original_lock(user_id)

                access.accounts.lock_user = observed_lock
                return await get_complete_phone_sign_in(
                    session, SETTINGS, access, get_social_accounts(session, access.users, {}),
                ).execute(
                    **payload
                )

        pending = asyncio.create_task(waiting_sign_in())
        await asyncio.wait_for(reached_user_lock.wait(), timeout=5)
        await accounts.set_verified_phone(first.user.id, "+59174567890", datetime.now(UTC))
        await owner.commit()
    outcome = await asyncio.wait_for(pending, timeout=5)
    assert outcome.user is None and outcome.tokens is None


async def test_nullable_email_migration_refuses_a_lossy_downgrade(accounts_db, pg_test_db):
    result = await complete(
        accounts_db,
        {**await proof(accounts_db), "full_name": "Phone Only", "terms_version": "testing-2026-09"},
    )
    with pytest.raises(RuntimeError, match="Phone-only accounts"):
        await pg_test_db.migrate_async("downgrade", "0024_phone_verification")
    async with accounts_db() as session:
        user = await session.get(UserModel, result.user.id)
        assert user.email is None and user.phone == PHONE
        assert user.id == UUID(str(result.user.id))


async def test_social_link_retries_are_atomic_on_postgresql(accounts_db):
    payload = {
        **await proof(accounts_db), "social_provider": "google", "social_token": "social-subject",
        "full_name": "Social Passenger", "terms_version": "testing-2026-09",
    }
    results = await asyncio.gather(*(complete(accounts_db, payload) for _ in range(8)))
    assert len({result.user.id for result in results}) == 1
    assert len({result.tokens.refresh_token for result in results}) == 1
    async with accounts_db() as session:
        identities = list(await session.scalars(select(UserIdentityModel)))
        assert len(identities) == 2
        assert {identity.provider for identity in identities} == {"google", "phone"}


async def test_two_phone_accounts_cannot_claim_the_same_social_subject(accounts_db):
    payloads = [{
        **await proof(accounts_db, phone=phone),
        "social_provider": "google", "social_token": "contested-subject",
        "full_name": "Social Passenger", "terms_version": "testing-2026-09",
    } for phone in (PHONE, "+59174567890")]
    results = await asyncio.gather(
        *(complete(accounts_db, payload) for payload in payloads), return_exceptions=True,
    )
    assert sum(not isinstance(result, Exception) for result in results) == 1
    assert sum(isinstance(result, IdentityAlreadyLinkedError) for result in results) == 1
    async with accounts_db() as session:
        assert await session.scalar(select(func.count()).select_from(AuthSessionModel)) == 1
