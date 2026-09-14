"""Exercise the phone boundary through HTTP and a real SQL repository."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.domain.phone_identity import InvalidPhoneCodeError
from app.infrastructure.config import Settings
from app.infrastructure.db.models import (
    PhoneChallengeModel,
    PhoneRateBudgetModel,
    UserIdentityModel,
)
from app.infrastructure.db.phone_challenges import SqlAlchemyPhoneChallengeStore
from app.infrastructure.security.phone_verification import HmacPhoneVerificationSecrets
from app.main import create_app
from tests.unit.test_environment import environment_values

REQUEST = "/api/v1/auth/phone/challenges"
VERIFY = "/api/v1/auth/phone/verify"
PHONE = "+59171234567"
DEVICE = "84911e87-9189-45fc-919f-47fe0c2fe8cf"


def payload(**changes):
    return {"phone": PHONE, "device_id": DEVICE, **changes}


def verification(challenge, **changes):
    return payload(
        **{
            "challenge_id": challenge["challenge_id"],
            "code": challenge["test_code"],
            **changes,
        }
    )


@pytest_asyncio.fixture
async def phone_client(session_factory):
    settings = Settings(_env_file=None, phone_otp_enabled=True, **environment_values("development"))
    app = create_app(settings=settings, session_factory=session_factory)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        yield client


@pytest.mark.parametrize("environment", ["development", "testing"])
async def test_mock_send_verify_resend_never_calls_external_transport(
    environment,
    session_factory,
    monkeypatch,
    caplog,
):
    async def forbidden_transport(*args, **kwargs):
        pytest.fail("A lower environment attempted external OTP I/O")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", forbidden_transport)
    settings = Settings(_env_file=None, phone_otp_enabled=True, **environment_values(environment))
    app = create_app(settings=settings, session_factory=session_factory)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        requested = await client.post(REQUEST, json=payload(phone="+591 7123-4567"))
        assert requested.status_code == 201
        assert requested.headers["cache-control"] == "no-store"
        challenge = requested.json()
        assert challenge["phone"] == PHONE
        assert len(challenge["test_code"]) == 6
        assert "user" not in challenge and "account_exists" not in challenge
        accepted = await client.post(VERIFY, json=verification(challenge))
        assert accepted.status_code == 200
        proof = accepted.json()["verification_token"]
        assert "access_token" not in accepted.json()
        assert (
            await client.get(
                "/api/v1/auth/me",
                headers={
                    "Authorization": f"Bearer {proof}",
                },
            )
        ).status_code == 401
        assert (await client.post(VERIFY, json=verification(challenge))).status_code == 400
        async with session_factory() as session:
            row = await session.get(PhoneChallengeModel, UUID(challenge["challenge_id"]))
            assert row.code_digest != challenge["test_code"]
            assert row.proof_digest != proof
            assert row.provider_id.startswith("mock:")
            assert (await session.scalars(select(UserIdentityModel))).all() == []
            await session.execute(
                update(PhoneRateBudgetModel).values(
                    resets_at=datetime.now(UTC) - timedelta(seconds=1),
                )
            )
            await session.commit()
        resent = await client.post(REQUEST, json=payload())
        assert resent.status_code == 201
        assert resent.json()["challenge_id"] != challenge["challenge_id"]
        assert (await client.post(VERIFY, json=verification(resent.json()))).status_code == 200
        assert challenge["test_code"] not in caplog.text
        assert proof not in caplog.text


async def test_wrong_attempts_remain_committed_and_lock_the_challenge(
    phone_client, session_factory
):
    challenge = (await phone_client.post(REQUEST, json=payload())).json()
    wrong = f"{(int(challenge['test_code']) + 1) % 1_000_000:06d}"
    for _ in range(5):
        response = await phone_client.post(VERIFY, json=verification(challenge, code=wrong))
        assert response.status_code == 400
    assert (await phone_client.post(VERIFY, json=verification(challenge))).status_code == 400
    async with session_factory() as session:
        row = await session.get(PhoneChallengeModel, UUID(challenge["challenge_id"]))
        assert row.attempts == 5 and row.verified_at is None


async def test_expired_unknown_and_reused_codes_have_the_same_error(phone_client, session_factory):
    challenge = (await phone_client.post(REQUEST, json=payload())).json()
    async with session_factory() as session:
        await session.execute(
            update(PhoneChallengeModel).values(
                expires_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        await session.commit()
    expired = await phone_client.post(VERIFY, json=verification(challenge))
    unknown = await phone_client.post(
        VERIFY, json=verification(challenge, challenge_id=str(uuid4()))
    )
    assert expired.status_code == unknown.status_code == 400
    assert expired.json() == unknown.json()


@pytest.mark.parametrize(
    "changes",
    [
        {"phone": "+59176543210"},
        {"device_id": "21a63214-e7c4-4bcf-89e7-5c650bf00c88"},
    ],
)
async def test_proof_is_bound_to_the_phone_and_device(phone_client, changes):
    challenge = (await phone_client.post(REQUEST, json=payload())).json()
    assert (
        await phone_client.post(VERIFY, json=verification(challenge, **changes))
    ).status_code == 400
    assert (await phone_client.post(VERIFY, json=verification(challenge))).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"test_code": "123456"},
        {"otp_mode": "mock"},
        {"purpose": "change_phone"},
        {"phone": "71234567"},
        {"phone": "+591123"},
        {"phone": "+14155552671"},
        {"device_id": ""},
    ],
)
async def test_invalid_or_client_controlled_policy_is_rejected(phone_client, changes):
    assert (await phone_client.post(REQUEST, json=payload(**changes))).status_code == 422


async def test_cooldown_applies_across_devices_and_discloses_retry_after(phone_client):
    assert (await phone_client.post(REQUEST, json=payload())).status_code == 201
    limited = await phone_client.post(REQUEST, json=payload(device_id=str(uuid4())))
    assert limited.status_code == 429
    assert 1 <= int(limited.headers["retry-after"]) <= 60
    assert limited.json()["retry_after_seconds"] == int(limited.headers["retry-after"])


async def test_resend_invalidates_the_previous_challenge(phone_client, session_factory):
    old = (await phone_client.post(REQUEST, json=payload())).json()
    async with session_factory() as session:
        await session.execute(
            update(PhoneRateBudgetModel).values(
                resets_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        await session.commit()
    new = (await phone_client.post(REQUEST, json=payload())).json()
    assert (await phone_client.post(VERIFY, json=verification(old))).status_code == 400
    assert (await phone_client.post(VERIFY, json=verification(new))).status_code == 200


@pytest.mark.parametrize("scope,limit", [("phone", 5), ("device", 10), ("ip", 30)])
async def test_request_budgets_cover_phone_ip_and_device(
    phone_client, session_factory, scope, limit
):
    for index in range(limit + 1):
        phone = PHONE if scope == "phone" else f"+5917{index:07d}"
        device = str(uuid4()) if scope == "ip" else DEVICE
        response = await phone_client.post(REQUEST, json=payload(phone=phone, device_id=device))
        assert response.status_code == (429 if index == limit else 201)
        if scope == "phone":
            async with session_factory() as session:
                await session.execute(
                    update(PhoneRateBudgetModel)
                    .where(
                        PhoneRateBudgetModel.key.like("send:cooldown:%"),
                    )
                    .values(resets_at=datetime.now(UTC) - timedelta(seconds=1))
                )
                await session.commit()


async def test_unknown_challenges_are_also_verification_rate_limited(phone_client):
    for index in range(31):
        response = await phone_client.post(
            VERIFY,
            json=payload(
                challenge_id=str(uuid4()),
                code="000000",
            ),
        )
        assert response.status_code == (429 if index == 30 else 400)


async def test_proof_consumption_is_one_use_and_part_of_the_account_transaction(
    phone_client,
    session_factory,
):
    challenge = (await phone_client.post(REQUEST, json=payload())).json()
    proof = (await phone_client.post(VERIFY, json=verification(challenge))).json()[
        "verification_token"
    ]
    settings = Settings(_env_file=None, **environment_values("development"))
    secrets = HmacPhoneVerificationSecrets(settings.jwt_secret, settings.app_env)
    args = (secrets.digest("proof", proof), PHONE, "sign_in", secrets.digest("device", DEVICE))
    async with session_factory() as session:
        store = SqlAlchemyPhoneChallengeStore(session)
        with pytest.raises(InvalidPhoneCodeError):
            await store.consume(args[0], PHONE, "change_phone", args[3], datetime.now(UTC))
        await session.rollback()
        await store.consume(*args, datetime.now(UTC))
        await session.rollback()
        await store.consume(*args, datetime.now(UTC))
        await session.commit()
        with pytest.raises(InvalidPhoneCodeError):
            await store.consume(*args, datetime.now(UTC))


async def test_production_schema_and_routes_never_expose_or_accept_mock(session_factory):
    settings = Settings(_env_file=None, phone_otp_enabled=True, **environment_values("production"))
    app = create_app(settings=settings, session_factory=session_factory)
    schema = app.openapi()
    assert "TestPhoneChallengeResponse" not in schema["components"]["schemas"]
    assert "test_code" not in str(schema)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        assert (await client.post(REQUEST, json=payload())).status_code == 503
        assert (
            await client.post(
                VERIFY,
                json=payload(
                    challenge_id=str(uuid4()),
                    code="123456",
                ),
            )
        ).status_code == 503
        assert (
            await client.post(
                REQUEST,
                json=payload(),
                headers={
                    "X-App-Environment": "testing",
                },
            )
        ).status_code == 400


async def test_feature_is_disabled_until_rollout_and_server_autofill_can_be_disabled(
    session_factory,
):
    for enabled in (False, True):
        settings = Settings(_env_file=None, phone_otp_enabled=enabled, otp_test_autofill=False)
        app = create_app(settings=settings, session_factory=session_factory)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            response = await client.post(REQUEST, json=payload())
            assert response.status_code == (201 if enabled else 503)
            assert "test_code" not in response.json()
