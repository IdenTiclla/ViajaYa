"""Verify the complete account boundary using HTTP and transactional SQL persistence."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from jose import jwt
from sqlalchemy import select, update

from app.api.deps import build_managed_sessions
from app.application.use_cases.review_account_recovery import ReviewAccountRecovery
from app.domain.account_access import AccountAccessDeniedError
from app.domain.entities import UserRole
from app.infrastructure.config import Settings
from app.infrastructure.db.account_recovery import SqlAlchemyRecoveryRepository
from app.infrastructure.db.models import AuthSessionModel, PhoneRateBudgetModel, UserModel
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from tests.e2e.test_phone_verification_api import phone_client as phone_client
from tests.unit.test_environment import environment_values

PHONE = "+59171234567"
OTHER_PHONE = "+59172345678"
BASE = "/api/v1/auth"


async def proof_payload(client, *, phone=PHONE, device_id=None, purpose="sign_in", headers=None):
    binding = {"phone": phone, "device_id": device_id or str(uuid4()), "purpose": purpose}
    prefix = f"{BASE}/phone/change" if purpose == "change_phone" else f"{BASE}/phone"
    challenge = await client.post(f"{prefix}/challenges", json=binding, headers=headers)
    assert challenge.status_code == 201, challenge.text
    proof = await client.post(
        f"{prefix}/verify",
        json={
            **binding,
            "challenge_id": challenge.json()["challenge_id"],
            "code": challenge.json()["test_code"],
        },
        headers=headers,
    )
    assert proof.status_code == 200, proof.text
    return {
        "phone": phone,
        "device_id": binding["device_id"],
        "device_name": "Test Android",
        "verification_token": proof.json()["verification_token"],
        "request_id": str(uuid4()),
    }


async def sign_in(client, **kwargs):
    payload = await proof_payload(client, **kwargs)
    response = await client.post(
        f"{BASE}/phone/complete",
        json={
            **payload,
            "full_name": "Phone Passenger",
            "terms_version": "testing-2026-09",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "authenticated"
    return response.json()["auth"], payload


def auth_headers(auth):
    return {"Authorization": f"Bearer {auth['tokens']['access_token']}"}


async def reset_budgets(factory):
    async with factory() as session:
        await session.execute(
            update(PhoneRateBudgetModel).values(
                resets_at=datetime.now(UTC) - timedelta(seconds=1),
            )
        )
        await session.commit()


async def test_profile_required_terms_role_and_idempotent_completion(phone_client, session_factory):
    payload = await proof_payload(phone_client)
    response = await phone_client.post(f"{BASE}/phone/complete", json=payload)
    assert response.json() == {"status": "profile_required", "auth": None}
    invalid = await phone_client.post(
        f"{BASE}/phone/complete",
        json={
            **payload,
            "full_name": "New Passenger",
            "terms_version": "outdated",
        },
    )
    assert invalid.status_code == 422
    escalated = await phone_client.post(
        f"{BASE}/phone/complete", json={**payload, "role": "driver"}
    )
    assert escalated.status_code == 422
    completed = await phone_client.post(
        f"{BASE}/phone/complete",
        json={
            **payload,
            "full_name": "New Passenger",
            "terms_version": "testing-2026-09",
        },
    )
    assert completed.status_code == 200, completed.text
    auth = completed.json()["auth"]
    assert auth["user"]["email"] is None
    assert auth["user"]["phone_verified_at"]
    assert auth["user"]["role"] == "passenger"
    claims = jwt.get_unverified_claims(auth["tokens"]["access_token"])
    assert claims["sid"] and claims["jti"]
    repeated = await phone_client.post(f"{BASE}/phone/complete", json=payload)
    assert repeated.json() == completed.json()
    reused = await phone_client.post(
        f"{BASE}/phone/complete", json={**payload, "request_id": str(uuid4())}
    )
    assert reused.status_code == 400
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(auth))).status_code == 200
    async with session_factory() as session:
        users = list(await session.scalars(select(UserModel)))
        assert len(users) == 1 and users[0].terms_version == "testing-2026-09"


async def test_unverified_historical_phone_never_merges_accounts(phone_client):
    old = await phone_client.post(
        f"{BASE}/register",
        json={
            "email": "old@example.com",
            "password": "Legacy1234#",
            "full_name": "Old User",
            "phone": PHONE,
        },
    )
    auth, _ = await sign_in(phone_client)
    assert auth["user"]["id"] != old.json()["user"]["id"]


async def test_legacy_migration_preserves_uuid_role_and_revokes_legacy(
    phone_client, session_factory
):
    old = await phone_client.post(
        f"{BASE}/register",
        json={
            "email": "driver@example.com",
            "password": "Legacy1234#",
            "full_name": "Old Driver",
        },
    )
    old_id = old.json()["user"]["id"]
    async with session_factory() as session:
        await session.execute(
            update(UserModel).where(UserModel.id == UUID(old_id)).values(role=UserRole.DRIVER)
        )
        await session.commit()
    payload = await proof_payload(phone_client)
    linked = await phone_client.post(
        f"{BASE}/phone/link-legacy",
        json={
            **payload,
            "email": "driver@example.com",
            "password": "Legacy1234#",
        },
    )
    assert linked.status_code == 200, linked.text
    auth = linked.json()["auth"]
    assert auth["user"]["id"] == old_id and auth["user"]["role"] == "driver"
    assert (
        await phone_client.get(f"{BASE}/me", headers=auth_headers(old.json()))
    ).status_code == 401
    assert (
        await phone_client.post(
            f"{BASE}/refresh",
            json={
                "refresh_token": old.json()["tokens"]["refresh_token"],
            },
        )
    ).status_code == 401
    assert (
        await phone_client.post(
            f"{BASE}/login",
            json={
                "email": "driver@example.com",
                "password": "Legacy1234#",
            },
        )
    ).status_code == 401


async def test_legacy_wrong_password_consumes_proof(phone_client):
    payload = await proof_payload(phone_client)
    body = {**payload, "email": "absent@example.com", "password": "wrong-password"}
    assert (await phone_client.post(f"{BASE}/phone/link-legacy", json=body)).status_code == 401
    assert (await phone_client.post(f"{BASE}/phone/link-legacy", json=body)).status_code == 400


@pytest.mark.parametrize(
    "changes",
    [
        {"device_id": "a8df53c9-1299-4d0f-94d6-eb0cf9e92a65"},
        {"phone": OTHER_PHONE},
        {"verification_token": "untrusted-proof-with-no-authority"},
    ],
)
async def test_completion_rejects_a_proof_outside_its_binding(phone_client, changes):
    payload = await proof_payload(phone_client)
    result = await phone_client.post(
        f"{BASE}/phone/complete",
        json={
            **payload,
            "full_name": "Untrusted",
            "terms_version": "testing-2026-09",
            **changes,
        },
    )
    assert result.status_code == 400


async def test_legacy_bridge_rejects_ambiguous_bcrypt_boundary(phone_client):
    password = "a" * 72
    registered = await phone_client.post(
        f"{BASE}/register",
        json={
            "full_name": "Boundary password",
            "email": "boundary@example.com",
            "password": password,
        },
    )
    assert registered.status_code == 201
    payload = await proof_payload(phone_client)
    result = await phone_client.post(
        f"{BASE}/phone/link-legacy",
        json={
            **payload,
            "email": "boundary@example.com",
            "password": password,
        },
    )
    assert result.status_code == 401


async def test_refresh_retry_is_idempotent_and_reuse_revokes_access(phone_client):
    auth, _ = await sign_in(phone_client)
    body = {"refresh_token": auth["tokens"]["refresh_token"], "request_id": str(uuid4())}
    first = await phone_client.post(f"{BASE}/refresh", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["refresh_token"] != body["refresh_token"]
    assert (await phone_client.post(f"{BASE}/refresh", json=body)).json() == first.json()
    reused = await phone_client.post(f"{BASE}/refresh", json={**body, "request_id": str(uuid4())})
    assert reused.status_code == 401
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(auth))).status_code == 401
    assert (
        await phone_client.post(
            f"{BASE}/refresh",
            json={
                "refresh_token": first.json()["refresh_token"],
            },
        )
    ).status_code == 401


async def test_devices_are_separate_and_owned_revocation_is_enforced(phone_client, session_factory):
    first, _ = await sign_in(phone_client)
    await reset_budgets(session_factory)
    second, _ = await sign_in(phone_client)
    stranger, _ = await sign_in(phone_client, phone=OTHER_PHONE)
    listing = await phone_client.get(f"{BASE}/sessions", headers=auth_headers(second))
    rows = listing.json()["sessions"]
    assert len(rows) == 2 and sum(row["current"] for row in rows) == 1
    first_id = next(row["id"] for row in rows if not row["current"])
    await phone_client.delete(f"{BASE}/sessions/{first_id}", headers=auth_headers(stranger))
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(first))).status_code == 200
    await phone_client.delete(f"{BASE}/sessions/others", headers=auth_headers(second))
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(first))).status_code == 401
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(second))).status_code == 200
    await phone_client.post(
        f"{BASE}/logout", json={"refresh_token": second["tokens"]["refresh_token"]}
    )
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(second))).status_code == 401


async def test_phone_change_requires_recent_session_and_preserves_account(
    phone_client, session_factory
):
    auth, original = await sign_in(phone_client)
    changed = await proof_payload(
        phone_client,
        phone=OTHER_PHONE,
        device_id=original["device_id"],
        purpose="change_phone",
        headers=auth_headers(auth),
    )
    response = await phone_client.post(
        f"{BASE}/phone/change",
        headers=auth_headers(auth),
        json={key: changed[key] for key in ("phone", "device_id", "verification_token")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == auth["user"]["id"]
    assert response.json()["user"]["phone"] == OTHER_PHONE
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(auth))).status_code == 401
    async with session_factory() as session:
        await session.execute(
            update(AuthSessionModel).values(
                created_at=datetime.now(UTC) - timedelta(minutes=6),
            )
        )
        await session.commit()
    denied = await phone_client.post(
        f"{BASE}/phone/change/challenges",
        headers=auth_headers(response.json()),
        json={"phone": PHONE, "device_id": original["device_id"]},
    )
    assert denied.status_code == 403


async def test_recovery_requires_authorized_review_and_fresh_contact_proof(
    phone_client, session_factory
):
    auth, _ = await sign_in(phone_client)
    payload = await proof_payload(phone_client, phone=OTHER_PHONE, purpose="recovery")
    request_body = {key: payload[key] for key in ("device_id", "request_id", "verification_token")}
    submitted = await phone_client.post(
        f"{BASE}/recovery",
        json={
            **request_body,
            "account_hint": PHONE,
            "reason": "I lost access to my old phone number",
        },
    )
    assert submitted.status_code == 201, submitted.text
    case_id = submitted.json()["case_id"]
    complete_body = {**request_body, "case_id": case_id, "device_name": "Recovery Android"}
    assert (
        await phone_client.post(f"{BASE}/recovery/complete", json=complete_body)
    ).status_code == 400
    settings = Settings(_env_file=None, phone_otp_enabled=True, **environment_values("development"))

    class Reviewer:
        allowed = False

        async def authorize(self, actor_id):
            if not self.allowed:
                raise AccountAccessDeniedError()

    reviewer = Reviewer()
    async with session_factory() as session:
        access = build_managed_sessions(session, settings)
        review = ReviewAccountRecovery(
            access.accounts,
            SqlAlchemyRecoveryRepository(session),
            reviewer,
            SqlAlchemyUnitOfWork(session),
        )
        with pytest.raises(AccountAccessDeniedError):
            await review.execute(
                UUID(case_id),
                uuid4(),
                approved=True,
                target_user_id=UUID(auth["user"]["id"]),
                evidence_reference="review-0001",
            )
        reviewer.allowed = True
        await review.execute(
            UUID(case_id),
            uuid4(),
            approved=True,
            target_user_id=UUID(auth["user"]["id"]),
            evidence_reference="review-0001",
        )
    await reset_budgets(session_factory)
    fresh = await proof_payload(phone_client, phone=OTHER_PHONE, purpose="recovery")
    recovered = await phone_client.post(
        f"{BASE}/recovery/complete",
        json={
            **{
                key: fresh[key]
                for key in ("device_id", "request_id", "verification_token", "device_name")
            },
            "case_id": case_id,
        },
    )
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["auth"]["user"]["id"] == auth["user"]["id"]
    assert (await phone_client.get(f"{BASE}/me", headers=auth_headers(auth))).status_code == 401
