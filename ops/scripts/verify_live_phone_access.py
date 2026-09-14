"""Certify phone onboarding and session revocation against both low environments."""
import json
import secrets
import sys
from pathlib import Path
from uuid import uuid4

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

ROOT = _workspace.phase_dir("phase02")
state = _workspace.read_state()
targets = {
    "development": _workspace.development_origin() + "/api/v1",
    "testing": (_workspace.testing_origin() + "/api/v1"
                if "--local" in sys.argv else state["api_url"]),
}
report = {}
report_path = ROOT / ("live-phone-verification-local.json" if "--local" in sys.argv
                      else "live-phone-verification.json")


def checked(response, expected=200):
    assert response.status_code == expected, (
        f"{response.request.method} {response.request.url.path}: "
        f"expected {expected}, received {response.status_code}"
    )
    return response.json() if response.content else None


for environment, api_url in targets.items():
    with httpx.Client(timeout=25, headers={"X-App-Environment": environment}) as client:
        ready = client.get(api_url.removesuffix("/api/v1") + "/health/ready")
        checked(ready)
        assert ready.headers["X-App-Environment"] == environment
        capabilities = checked(client.get(api_url + "/auth/phone/capabilities"))
        assert capabilities["enabled"] is True
        assert {"region": "BO", "calling_code": "+591"} in capabilities["countries"]
        binding = {
            "phone": "+5917" + str(secrets.randbelow(10_000_000)).zfill(7),
            "device_id": str(uuid4()),
            "purpose": "sign_in",
        }
        challenge = checked(client.post(api_url + "/auth/phone/challenges", json=binding), 201)
        assert len(challenge["test_code"]) == 6
        proof = checked(client.post(api_url + "/auth/phone/verify", json={
            **binding, "challenge_id": challenge["challenge_id"], "code": challenge["test_code"],
        }))
        payload = {
            "phone": binding["phone"], "device_id": binding["device_id"],
            "device_name": "F02-B live verification", "request_id": str(uuid4()),
            "verification_token": proof["verification_token"],
        }
        profile = checked(client.post(api_url + "/auth/phone/complete", json=payload))
        assert profile == {"status": "profile_required", "auth": None}
        completed = checked(client.post(api_url + "/auth/phone/complete", json={
            **payload, "full_name": "Verificación F02-B",
            "terms_version": capabilities["terms_version"],
        }))
        assert completed["status"] == "authenticated"
        auth = completed["auth"]
        assert auth["user"]["email"] is None and auth["user"]["role"] == "passenger"
        assert auth["user"]["phone_verified_at"]
        assert checked(client.post(api_url + "/auth/phone/complete", json=payload)) == completed
        tokens = auth["tokens"]
        headers = {"Authorization": "Bearer " + tokens["access_token"]}
        sessions = checked(client.get(api_url + "/auth/sessions", headers=headers))
        assert sessions["managed"] is True and len(sessions["sessions"]) == 1
        assert sessions["sessions"][0]["current"] is True
        other_environment = "testing" if environment == "development" else "development"
        cross_environment = client.get(targets[other_environment] + "/auth/me", headers={
            "X-App-Environment": other_environment, **headers,
        })
        checked(cross_environment, 401)
        refresh_payload = {"refresh_token": tokens["refresh_token"], "request_id": str(uuid4())}
        rotated = checked(client.post(api_url + "/auth/refresh", json=refresh_payload))
        assert rotated["refresh_token"] != tokens["refresh_token"]
        assert checked(client.post(api_url + "/auth/refresh", json=refresh_payload)) == rotated
        checked(client.post(api_url + "/auth/logout",
                            json={"refresh_token": rotated["refresh_token"]}), 204)
        checked(client.get(api_url + "/auth/me", headers={
            "Authorization": "Bearer " + rotated["access_token"],
        }), 401)
        checked(client.post(api_url + "/auth/refresh", json={
            "refresh_token": rotated["refresh_token"], "request_id": str(uuid4()),
        }), 401)
        report[environment] = {
            "api_url": api_url, "readiness": "passed", "mock_otp": "passed",
            "phone_account_without_email": "passed", "completion_retry": "passed",
            "managed_session": "passed", "refresh_rotation_and_retry": "passed",
            "logout_revokes_access_and_refresh": "passed", "environment_isolation": "passed",
            "verification_account_id": auth["user"]["id"],
        }
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"environment": environment, "phone_access": "passed",
                          "session_checks": "passed"}), flush=True)
