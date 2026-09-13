"""Exercise explicit social linking and historical account migration over HTTP."""

from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, update

from app.api.deps import get_oauth_verifiers
from app.domain.entities import AuthProvider
from app.infrastructure.config import Settings
from app.infrastructure.db.models import AuthSessionModel, UserIdentityModel, UserModel
from app.main import create_app
from tests.e2e.test_phone_accounts import (
    BASE,
    OTHER_PHONE,
    auth_headers,
    proof_payload,
    reset_budgets,
    sign_in,
)
from tests.fakes import FakeVerifier
from tests.unit.test_environment import environment_values


@pytest_asyncio.fixture
async def social_client(session_factory):
    settings = Settings(_env_file=None, phone_otp_enabled=True, **environment_values("development"))
    app = create_app(settings=settings, session_factory=session_factory)
    app.dependency_overrides[get_oauth_verifiers] = lambda: {
        provider.value: FakeVerifier(provider)
        for provider in (AuthProvider.GOOGLE, AuthProvider.FACEBOOK)
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test",
    ) as client:
        yield client


async def social_access(client, provider="google", token="social-1", **changes):
    return await client.post(f"{BASE}/social/{provider}/sign-in", json={
        "token": token, "device_id": str(uuid4()), "device_name": "Test Android", **changes,
    })


@pytest.mark.parametrize("provider", ["google", "facebook"])
async def test_social_requires_phone_profile_and_explicit_link(
    social_client, session_factory, provider,
):
    response = await social_access(social_client, provider)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "phone_required", "auth": None}
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(AuthSessionModel)) == 0
        assert await session.scalar(select(func.count()).select_from(UserModel)) == 0
    payload = {
        **await proof_payload(social_client),
        "social_provider": provider, "social_token": "social-1",
    }
    response = await social_client.post(f"{BASE}/phone/link-social", json=payload)
    assert response.json() == {"status": "profile_required", "auth": None}
    completed = await social_client.post(f"{BASE}/phone/link-social", json={
        **payload, "full_name": "New Social Passenger", "terms_version": "testing-2026-09",
    })
    assert completed.status_code == 200, completed.text
    auth = completed.json()["auth"]
    assert auth["user"]["phone_verified_at"]
    assert auth["user"]["role"] == "passenger" and auth["user"]["email"] is None
    repeated = await social_client.post(f"{BASE}/phone/link-social", json=payload)
    assert repeated.json() == completed.json()
    wrong = await social_client.post(f"{BASE}/phone/link-social", json={
        **payload, "social_token": "someone-else",
    })
    assert wrong.status_code == 400
    response = await social_access(social_client, provider)
    assert response.json()["status"] == "authenticated"
    assert response.json()["auth"]["user"]["id"] == auth["user"]["id"]
    sessions = await social_client.get(f"{BASE}/sessions", headers=auth_headers(auth))
    assert sessions.json()["managed"] and len(sessions.json()["sessions"]) == 2


@pytest.mark.parametrize("provider", ["google", "facebook"])
async def test_migrating_social_driver_preserves_identity_role_and_disables_old_tokens(
    social_client, session_factory, provider,
):
    user_id = uuid4()
    async with session_factory() as session:
        session.add(UserModel(
            id=user_id, email="legacy@example.com", full_name="Historical Driver",
            role="driver", auth_provider=provider, provider_id="social-1",
        ))
        await session.commit()
    legacy = await social_client.post(f"{BASE}/oauth/{provider}", json={"token": "social-1"})
    assert legacy.status_code == 200, legacy.text
    assert (await social_access(social_client, provider)).json()["auth"] is None
    payload = {**await proof_payload(social_client),
               "social_provider": provider, "social_token": "social-1"}
    completed = await social_client.post(f"{BASE}/phone/link-social", json=payload)
    assert completed.status_code == 200, completed.text
    user = completed.json()["auth"]["user"]
    assert user["id"] == str(user_id) and user["role"] == "driver"
    assert user["full_name"] == "Historical Driver" and user["email"] == "legacy@example.com"
    old_access = await social_client.get(f"{BASE}/me", headers=auth_headers(legacy.json()))
    old_login = await social_client.post(f"{BASE}/oauth/{provider}", json={"token": "social-1"})
    assert old_access.status_code == old_login.status_code == 401


async def test_social_email_match_never_merges_password_account(social_client, session_factory):
    old = await social_client.post(f"{BASE}/register", json={
        "email": "social-1.google@example.com", "password": "Legacy1234#",
        "full_name": "Existing Password Account",
    })
    assert old.status_code == 201
    old_login = await social_client.post(f"{BASE}/oauth/google", json={"token": "social-1"})
    assert old_login.status_code == 401
    payload = {**await proof_payload(social_client), "social_provider": "google",
               "social_token": "social-1", "full_name": "Separate Phone Account",
               "terms_version": "testing-2026-09"}
    result = await social_client.post(f"{BASE}/phone/link-social", json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["auth"]["user"]["id"] != old.json()["user"]["id"]
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(UserModel)) == 2


async def test_phone_owner_can_link_but_conflicting_social_identity_cannot_move(
    social_client, session_factory,
):
    auth, _ = await sign_in(social_client)
    await reset_budgets(session_factory)
    payload = {**await proof_payload(social_client),
               "social_provider": "google", "social_token": "social-1"}
    result = await social_client.post(f"{BASE}/phone/link-social", json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["auth"]["user"]["id"] == auth["user"]["id"]
    other_payload = {**await proof_payload(social_client, phone=OTHER_PHONE),
                     "social_provider": "google", "social_token": "social-1"}
    conflict = await social_client.post(f"{BASE}/phone/link-social", json=other_payload)
    assert conflict.status_code == 409
    async with session_factory() as session:
        identity = await session.get(UserIdentityModel, ("google", "social-1"))
        assert identity.user_id == UUID(auth["user"]["id"])
    await reset_budgets(session_factory)
    replace = {**await proof_payload(social_client),
               "social_provider": "google", "social_token": "another-social"}
    assert (await social_client.post(f"{BASE}/phone/link-social", json=replace)).status_code == 409


async def test_social_proof_cannot_replace_otp_or_activate_disabled_account(
    social_client, session_factory,
):
    payload = {**await proof_payload(social_client),
               "social_provider": "google", "social_token": "social-1",
               "full_name": "Test User", "terms_version": "testing-2026-09"}
    wrong = await social_client.post(f"{BASE}/phone/link-social", json={
        **payload, "device_id": str(uuid4()),
    })
    assert wrong.status_code == 400
    result = await social_client.post(f"{BASE}/phone/link-social", json=payload)
    assert result.status_code == 200, result.text
    async with session_factory() as session:
        await session.execute(update(UserModel).values(is_active=False))
        await session.commit()
    assert (await social_access(social_client)).status_code == 401
