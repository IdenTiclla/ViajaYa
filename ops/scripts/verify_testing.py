"""Verify the public testing API and its separation from local development."""

import asyncio
import json
import sys
from pathlib import Path

import httpx
from websockets.asyncio.client import connect

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

state = _workspace.read_state()
testing_url = state["api_url"]
report = {"api_url": testing_url}


async def verify_websocket(access_token: str) -> None:
    uri = testing_url.replace("https://", "wss://", 1) + "/ws/driver"
    async with connect(
        uri, subprotocols=["viajaya.auth", access_token],
        additional_headers={"X-App-Environment": "testing"},
        open_timeout=20, close_timeout=5,
    ) as socket:
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=15))
        assert message["type"] in {
            "open_rides_snapshot", "driver_offers_snapshot", "driver_snapshot", "snapshot",
        }, message["type"]
        report["public_websocket"] = "passed"
        report["websocket_first_event"] = message["type"]


with httpx.Client(timeout=25) as client:
    ready = client.get(testing_url.removesuffix("/api/v1") + "/health/ready")
    ready.raise_for_status()
    assert ready.headers["X-App-Environment"] == "testing"
    report["public_https_readiness"] = "passed"

    credentials = {"email": "driver.auto1@viajaya.com", "password": state["account_password"]}
    login = client.post(testing_url + "/auth/login",
                        headers={"X-App-Environment": "testing"}, json=credentials)
    login.raise_for_status()
    session = login.json()
    assert session["user"]["role"] == "driver"
    access_token = session["tokens"]["access_token"]
    auth_headers = {"X-App-Environment": "testing", "Authorization": f"Bearer {access_token}"}
    profile = client.get(testing_url + "/auth/me", headers=auth_headers)
    profile.raise_for_status()
    assert profile.json()["email"] == "driver.auto1@viajaya.com"
    report["login_and_profile"] = "passed"

    refresh = client.post(testing_url + "/auth/refresh", headers={"X-App-Environment": "testing"},
                          json={"refresh_token": session["tokens"]["refresh_token"]})
    refresh.raise_for_status()
    report["refresh"] = "passed"

    mismatch = client.post(testing_url + "/auth/login",
                           headers={"X-App-Environment": "development"}, json=credentials)
    assert mismatch.status_code == 400
    report["wrong_environment_header"] = "rejected"

    cross_environment = client.get(_workspace.development_origin() + "/api/v1/auth/me", headers={
        "X-App-Environment": "development", "Authorization": f"Bearer {access_token}",
    })
    assert cross_environment.status_code == 401
    report["testing_token_in_development"] = "rejected"

    development = client.get(_workspace.development_origin() + "/health/ready")
    development.raise_for_status()
    assert development.headers["X-App-Environment"] == "development"
    report["development_still_healthy"] = "passed"

asyncio.run(verify_websocket(access_token))
(_workspace.state_dir() / "verification-report.json").write_text(
    json.dumps(report, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(report))
