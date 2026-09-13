"""Validate provider adapter boundaries with controlled HTTP and signing responses."""

import threading
import time

import httpx
import pytest

from app.domain.exceptions import InvalidTokenError
from app.infrastructure.oauth.facebook_verifier import FacebookIdentityVerifier
from app.infrastructure.oauth.google_verifier import GoogleIdentityVerifier


@pytest.mark.parametrize("change", [
    {"app_id": "foreign-app"}, {"type": "PAGE"}, {"is_valid": False},
    {"expires_at": 1}, {"data_access_expires_at": 1}, {"user_id": "wrong-subject"},
    {"expires_at": "invalid"},
])
async def test_facebook_rejects_invalid_app_type_expiry_and_subject(monkeypatch, change):
    claims = {"app_id": "app-1", "type": "USER", "is_valid": True,
              "user_id": "subject-1", "expires_at": time.time() + 600,
              "data_access_expires_at": time.time() + 600, **change}

    async def respond(_self, request):
        return httpx.Response(200, json={"data": claims}
                              if request.url.path.endswith("debug_token")
                              else {"id": "subject-1", "name": "Test User"})

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", respond)
    with pytest.raises(InvalidTokenError):
        await FacebookIdentityVerifier("app-1", "app-secret").verify("user-token")


async def test_facebook_accepts_identity_without_email_and_keeps_credentials_out_of_logs(
    monkeypatch, caplog,
):
    requests = []

    async def respond(_self, request):
        requests.append(request)
        return httpx.Response(200, json={"data": {
            "app_id": "app-1", "type": "USER", "is_valid": True, "user_id": "subject-1",
            "expires_at": time.time() + 600, "data_access_expires_at": 0,
        }} if request.url.path.endswith("debug_token") else {"id": "subject-1"})

    caplog.set_level("INFO")
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", respond)
    profile = await FacebookIdentityVerifier("app-1", "app-secret").verify("user-token")
    assert profile.provider_id == "subject-1" and profile.email == ""
    assert requests[0].headers["Authorization"] == "Bearer app-1|app-secret"
    assert "app-secret" not in str(requests[0].url)
    assert "user-token" not in caplog.text and "app-secret" not in caplog.text


async def test_google_verification_runs_off_event_loop_and_checks_server_audience(monkeypatch):
    loop_thread = threading.get_ident()

    def verify(token, request, audience):
        assert threading.get_ident() != loop_thread
        assert audience == "server-web-client" and token == "id-token"
        assert request.keywords["timeout"] == 10
        return {"sub": "google-subject", "email": "test@example.com", "email_verified": True}

    monkeypatch.setattr(
        "app.infrastructure.oauth.google_verifier.google_id_token.verify_oauth2_token", verify,
    )
    profile = await GoogleIdentityVerifier("server-web-client").verify("id-token")
    assert profile.provider_id == "google-subject"
