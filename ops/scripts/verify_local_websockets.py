"""Check legacy driver compatibility and WebSocket transport after API activation."""
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from websockets.asyncio.client import connect

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

ROOT = _workspace.phase_dir("phase02")
state = _workspace.read_state()
SEED_PASSWORD = os.environ.get("VIAJAYA_SEED_PASSWORD", "ViajaYa1234#")


async def main():
    report = {}
    targets = [
        ("development", _workspace.development_origin(), SEED_PASSWORD),
        ("testing", _workspace.testing_origin(), state["account_password"]),
    ]
    for environment, origin, password in targets:
        headers = {"X-App-Environment": environment}
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            response = await client.post(origin + "/api/v1/auth/login", json={
                "email": "driver.auto1@viajaya.com", "password": password,
            })
            response.raise_for_status()
            auth = response.json()
            assert auth["user"]["role"] == "driver"
            async with connect(
                origin.replace("http://", "ws://", 1) + "/api/v1/ws/driver",
                subprotocols=["viajaya.auth", auth["tokens"]["access_token"]],
                additional_headers={"X-App-Environment": environment},
                open_timeout=15, close_timeout=5,
            ) as socket:
                event = json.loads(await asyncio.wait_for(socket.recv(), timeout=15))
                assert event["type"] in {"open_rides_snapshot", "driver_offers_snapshot",
                                        "driver_snapshot", "snapshot"}
            ready = await client.get(origin + "/health/ready")
            ready.raise_for_status()
            report[environment] = {"legacy_driver_login": "passed", "local_websocket": "passed",
                                   "first_event": event["type"], "ready_after_disconnect": "passed"}
            print(json.dumps({"environment": environment, "local_websocket": "passed"}), flush=True)
    (ROOT / "local-websocket-verification.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )


asyncio.run(main())
