"""Sign in against a live low environment through the mock-OTP phone flow.

Shared by the smoke scripts: requests a challenge, verifies the ``test_code``
the environment returns, and completes the sign-in (creating the account when
the number is new). Production never returns ``test_code``.
"""

from __future__ import annotations

import uuid

import httpx


async def sign_in(
    client: httpx.AsyncClient,
    phone: str,
    *,
    full_name: str = "Cuenta de prueba",
    base: str = "/api/v1",
    device_name: str = "Smoke script",
) -> str:
    """Return an access token for ``phone``; the account is created if needed."""
    capabilities = await client.get(f"{base}/auth/phone/capabilities")
    capabilities.raise_for_status()
    device_id = str(uuid.uuid4())
    binding = {"phone": phone, "device_id": device_id, "purpose": "sign_in"}
    challenge = await client.post(f"{base}/auth/phone/challenges", json=binding)
    challenge.raise_for_status()
    test_code = challenge.json().get("test_code")
    if not test_code:
        raise RuntimeError("This environment does not return a mock OTP; use a real device.")
    proof = await client.post(
        f"{base}/auth/phone/verify",
        json={**binding, "challenge_id": challenge.json()["challenge_id"], "code": test_code},
    )
    proof.raise_for_status()
    completed = await client.post(
        f"{base}/auth/phone/complete",
        json={
            "phone": phone,
            "device_id": device_id,
            "device_name": device_name,
            "verification_token": proof.json()["verification_token"],
            "request_id": str(uuid.uuid4()),
            "full_name": full_name,
            "terms_version": capabilities.json()["terms_version"],
        },
    )
    completed.raise_for_status()
    body = completed.json()
    if body["status"] != "authenticated":
        raise RuntimeError(f"Phone sign-in did not complete: {body['status']}")
    return body["auth"]["tokens"]["access_token"]
