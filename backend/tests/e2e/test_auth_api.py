"""Tests e2e de los endpoints de autenticación."""

from __future__ import annotations

import pytest

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
ME = "/api/v1/auth/me"


def _register_payload(**over):
    base = {
        "full_name": "Alex Walker",
        "email": "alex@example.com",
        "password": "secret123",
        "phone": "+34600000000",
    }
    base.update(over)
    return base


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_register_then_me(client):
    resp = await client.post(REGISTER, json=_register_payload())
    assert resp.status_code == 201
    body = resp.json()
    assert body["user"]["email"] == "alex@example.com"
    assert body["user"]["auth_provider"] == "local"
    access = body["tokens"]["access_token"]

    me = await client.get(ME, headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["email"] == "alex@example.com"


async def test_register_duplicate_email_conflict(client):
    await client.post(REGISTER, json=_register_payload())
    resp = await client.post(REGISTER, json=_register_payload())
    assert resp.status_code == 409


async def test_login_success_and_wrong_password(client):
    await client.post(REGISTER, json=_register_payload())

    ok = await client.post(LOGIN, json={"email": "alex@example.com", "password": "secret123"})
    assert ok.status_code == 200

    bad = await client.post(LOGIN, json={"email": "alex@example.com", "password": "nope12345"})
    assert bad.status_code == 401


async def test_refresh_flow(client):
    reg = await client.post(REGISTER, json=_register_payload())
    refresh_token = reg.json()["tokens"]["refresh_token"]

    resp = await client.post(REFRESH, json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


async def test_me_requires_token(client):
    resp = await client.get(ME)
    assert resp.status_code == 401


async def test_me_rejects_invalid_token(client):
    resp = await client.get(ME, headers={"Authorization": "Bearer not-a-jwt"})
    assert resp.status_code == 401


@pytest.mark.parametrize("provider", ["google", "facebook"])
async def test_oauth_login_creates_user(client, provider):
    resp = await client.post(f"/api/v1/auth/oauth/{provider}", json={"token": "uid-42"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["auth_provider"] == provider
    assert body["user"]["email"] == f"uid-42.{provider}@example.com"
    assert "access_token" in body["tokens"]


async def test_oauth_unsupported_provider(client):
    resp = await client.post("/api/v1/auth/oauth/twitter", json={"token": "x"})
    assert resp.status_code == 400
