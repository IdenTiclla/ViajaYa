"""E2E: a passenger registers as a driver, switches mode and sees only their pool."""

from __future__ import annotations

import uuid

import pytest

from app.infrastructure.realtime.hub import hub, ride_topic
from tests.e2e.helpers import sign_in

AUTH = "/api/v1/auth"
DRIVERS = "/api/v1/drivers"
RIDES = "/api/v1/rides"


class _FakeWS:
    async def send_json(self, message: dict) -> None:  # pragma: no cover - no-op
        pass


def _mark_present(ride_id: str) -> _FakeWS:
    ws = _FakeWS()
    hub.subscribe(ride_topic(uuid.UUID(ride_id)), ws)
    return ws


def _ride_payload(service_type: str) -> dict:
    return {
        "origin": {"latitude": -16.5, "longitude": -68.13, "name": "Casa", "address": "Calle 1"},
        "destination": {
            "latitude": -16.49,
            "longitude": -68.14,
            "name": "Trabajo",
            "address": "Av. 2",
        },
        "service_type": service_type,
        "fare": "25.00",
    }


def _application(vehicle_type: str, services: list[str]) -> dict:
    return {
        "vehicle_type": vehicle_type,
        "plate": "1234-abc",
        "vehicle_model": "Toyota Corolla",
        "services": services,
    }


async def test_application_is_pending_until_reviewed(client):
    account = await sign_in(client, "pending-driver")

    applied = await client.post(
        f"{DRIVERS}/me/application",
        json=_application("taxi", ["taxi"]),
        headers=account.headers,
    )
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert body["role"] == "passenger"
    assert body["driver_status"] == "pending"
    assert body["vehicle_type"] == "taxi"
    assert body["plate"] == "1234-ABC"
    assert body["driver_services"] == ["taxi"]

    me = await client.get(f"{AUTH}/me", headers=account.headers)
    assert me.json()["driver_status"] == "pending"

    denied = await client.post(
        f"{DRIVERS}/me/mode", json={"mode": "driver"}, headers=account.headers
    )
    assert denied.status_code == 403, denied.text


async def test_application_rejects_services_outside_the_vehicle(client):
    account = await sign_in(client, "wrong-services")

    response = await client.post(
        f"{DRIVERS}/me/application",
        json=_application("moto", ["moto", "moving"]),
        headers=account.headers,
    )
    assert response.status_code == 422, response.text

    response = await client.post(
        f"{DRIVERS}/me/application",
        json=_application("truck", ["delivery"]),
        headers=account.headers,
    )
    assert response.status_code == 422, response.text


@pytest.mark.settings(driver_auto_approve=True)
async def test_auto_approved_driver_switches_mode_and_sees_only_chosen_services(client):
    rider = await sign_in(client, "mode-rider")
    taxi_only = await sign_in(client, "mode-taxi-only")
    mover = await sign_in(client, "mode-mover")

    applied = await client.post(
        f"{DRIVERS}/me/application",
        json=_application("taxi", ["taxi"]),
        headers=taxi_only.headers,
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["driver_status"] == "approved"
    assert applied.json()["role"] == "passenger"

    # Still a passenger: the driver pool is off limits until the mode changes.
    assert (await client.get(f"{RIDES}/open", headers=taxi_only.headers)).status_code == 403

    switched = await client.post(
        f"{DRIVERS}/me/mode", json={"mode": "driver"}, headers=taxi_only.headers
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["role"] == "driver"
    online = await client.post(
        f"{DRIVERS}/me/online", json={"is_online": True}, headers=taxi_only.headers
    )
    assert online.status_code == 200, online.text

    mover_applied = await client.post(
        f"{DRIVERS}/me/application",
        json=_application("truck", ["moving"]),
        headers=mover.headers,
    )
    assert mover_applied.status_code == 200, mover_applied.text
    assert mover_applied.json()["driver_services"] == ["moving"]
    assert (
        await client.post(f"{DRIVERS}/me/mode", json={"mode": "driver"}, headers=mover.headers)
    ).status_code == 200
    assert (
        await client.post(f"{DRIVERS}/me/online", json={"is_online": True}, headers=mover.headers)
    ).status_code == 200

    presences = []
    ride_ids: dict[str, str] = {}
    for service in ("taxi", "delivery", "moving"):
        passenger = await sign_in(client, f"mode-passenger-{service}")
        created = await client.post(RIDES, json=_ride_payload(service), headers=passenger.headers)
        assert created.status_code == 201, created.text
        ride_ids[service] = created.json()["id"]
        presences.append(_mark_present(ride_ids[service]))
    del rider

    taxi_pool = (await client.get(f"{RIDES}/open", headers=taxi_only.headers)).json()["items"]
    assert [ride["id"] for ride in taxi_pool] == [ride_ids["taxi"]]

    mover_pool = (await client.get(f"{RIDES}/open", headers=mover.headers)).json()["items"]
    assert [ride["id"] for ride in mover_pool] == [ride_ids["moving"]]

    # A taxi that did not choose deliveries cannot offer on one.
    refused = await client.post(
        f"{RIDES}/{ride_ids['delivery']}/offers",
        json={"accept_at_fare": True},
        headers=taxi_only.headers,
    )
    assert refused.status_code == 403, refused.text

    # Going back to passenger mode requires being offline; driver data survives.
    blocked = await client.post(
        f"{DRIVERS}/me/mode", json={"mode": "passenger"}, headers=taxi_only.headers
    )
    assert blocked.status_code == 409, blocked.text
    assert (
        await client.post(
            f"{DRIVERS}/me/online", json={"is_online": False}, headers=taxi_only.headers
        )
    ).status_code == 200
    back = await client.post(
        f"{DRIVERS}/me/mode", json={"mode": "passenger"}, headers=taxi_only.headers
    )
    assert back.status_code == 200, back.text
    assert back.json()["role"] == "passenger"
    assert back.json()["driver_status"] == "approved"
    assert back.json()["vehicle_type"] == "taxi"

    for presence in presences:
        for service in ride_ids.values():
            hub.unsubscribe(ride_topic(uuid.UUID(service)), presence)
