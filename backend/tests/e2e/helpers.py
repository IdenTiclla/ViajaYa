"""Shared e2e helpers: phone sign-in (the only access flow) and driver promotion."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass

from app.domain.entities import (
    DriverStatus,
    DriverVehicle,
    UserRole,
    VehicleType,
    services_for_vehicle,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.account_access import SqlAlchemyPhoneAccountRepository
from app.infrastructure.db.driver_vehicles import SqlAlchemyDriverVehicleRepository
from app.infrastructure.db.repositories import SqlAlchemyUserRepository
from tests.unit.test_environment import environment_values

AUTH = "/api/v1/auth"
TERMS_VERSION = "testing-2026-09"


def test_settings(**overrides) -> Settings:
    """Synthetic development settings with the mock OTP enabled; never reads .env."""
    values = {"phone_otp_enabled": True, **environment_values("development"), **overrides}
    return Settings(_env_file=None, **values)


def phone_for(label: str) -> str:
    """Stable Bolivian mobile number derived from a readable label."""
    digits = int(hashlib.sha256(label.encode()).hexdigest(), 16) % 10_000_000
    return f"+5917{digits:07d}"


@dataclass(frozen=True)
class Account:
    user_id: str
    token: str
    phone: str

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


def _binding(phone: str) -> dict:
    return {"phone": phone, "device_id": str(uuid.uuid4()), "purpose": "sign_in"}


def _completion(binding: dict, proof: dict, label: str) -> dict:
    return {
        "phone": binding["phone"],
        "device_id": binding["device_id"],
        "device_name": "Test Android",
        "verification_token": proof["verification_token"],
        "request_id": str(uuid.uuid4()),
        "full_name": label,
        "terms_version": TERMS_VERSION,
    }


def _account(body: dict, phone: str) -> Account:
    assert body["status"] == "authenticated", body
    return Account(body["auth"]["user"]["id"], body["auth"]["tokens"]["access_token"], phone)


async def sign_in(client, label: str) -> Account:
    """Create (or reuse) the account for ``label`` through the mock OTP flow."""
    binding = _binding(phone_for(label))
    challenge = await client.post(f"{AUTH}/phone/challenges", json=binding)
    assert challenge.status_code == 201, challenge.text
    proof = await client.post(f"{AUTH}/phone/verify", json={
        **binding, "challenge_id": challenge.json()["challenge_id"],
        "code": challenge.json()["test_code"],
    })
    assert proof.status_code == 200, proof.text
    completed = await client.post(
        f"{AUTH}/phone/complete", json=_completion(binding, proof.json(), label),
    )
    assert completed.status_code == 200, completed.text
    return _account(completed.json(), binding["phone"])


def sign_in_sync(client, label: str) -> Account:
    """``sign_in`` for Starlette's synchronous ``TestClient``."""
    binding = _binding(phone_for(label))
    challenge = client.post(f"{AUTH}/phone/challenges", json=binding)
    assert challenge.status_code == 201, challenge.text
    proof = client.post(f"{AUTH}/phone/verify", json={
        **binding, "challenge_id": challenge.json()["challenge_id"],
        "code": challenge.json()["test_code"],
    })
    assert proof.status_code == 200, proof.text
    completed = client.post(
        f"{AUTH}/phone/complete", json=_completion(binding, proof.json(), label),
    )
    assert completed.status_code == 200, completed.text
    return _account(completed.json(), binding["phone"])


async def promote_to_driver(
    session_factory,
    account: Account | str,
    vehicle: VehicleType = VehicleType.TAXI,
    *,
    online: bool = True,
) -> None:
    """Drivers are approved out of band (F04); tests promote them directly.

    ``account`` may be the label used with ``sign_in`` instead of the result.
    """
    async with session_factory() as session:
        users = SqlAlchemyUserRepository(session)
        if isinstance(account, str):
            user = await SqlAlchemyPhoneAccountRepository(session).find_by_phone(phone_for(account))
        else:
            user = await users.get_by_id(uuid.UUID(account.user_id))
        assert user is not None
        user.role = UserRole.DRIVER
        user.vehicle_type = vehicle
        user.driver_services = services_for_vehicle(vehicle)
        user.driver_status = DriverStatus.APPROVED
        user.is_online = online
        await users.update(user)
        await SqlAlchemyDriverVehicleRepository(session).save(
            DriverVehicle(
                user_id=user.id,
                vehicle_type=vehicle,
                plate="TEST-1",
                vehicle_model="Test",
                services=services_for_vehicle(vehicle),
                status=DriverStatus.APPROVED,
            )
        )
