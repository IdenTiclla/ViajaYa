"""E2E: a user registers vehicles, enters driver mode with one of them and sees its pool."""

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


def _vehicle(vehicle_type: str, services: list[str], plate: str = "1234-abc") -> dict:
    return {
        "vehicle_type": vehicle_type,
        "plate": plate,
        "vehicle_model": "Toyota Corolla",
        "services": services,
    }


async def _register(client, account, vehicle_type: str, services: list[str], plate="1234-abc"):
    response = await client.post(
        f"{DRIVERS}/me/vehicles",
        json=_vehicle(vehicle_type, services, plate),
        headers=account.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _switch(client, account, mode: str, vehicle_type: str | None = None):
    return await client.post(
        f"{DRIVERS}/me/mode",
        json={"mode": mode, "vehicle_type": vehicle_type},
        headers=account.headers,
    )


async def test_vehicle_is_pending_until_reviewed(client):
    account = await sign_in(client, "pending-driver")

    body = await _register(client, account, "taxi", ["taxi"])
    assert body["vehicle"]["status"] == "pending"
    assert body["vehicle"]["plate"] == "1234-ABC"
    assert body["vehicle"]["services"] == ["taxi"]
    assert body["user"]["role"] == "passenger"
    assert body["user"]["driver_status"] == "pending"
    assert body["user"]["vehicle_type"] == "taxi"

    me = await client.get(f"{AUTH}/me", headers=account.headers)
    assert me.json()["driver_status"] == "pending"

    listed = await client.get(f"{DRIVERS}/me/vehicles", headers=account.headers)
    assert [v["vehicle_type"] for v in listed.json()] == ["taxi"]

    denied = await _switch(client, account, "driver")
    assert denied.status_code == 403, denied.text


async def test_vehicle_rejects_services_outside_its_type(client):
    account = await sign_in(client, "wrong-services")
    for vehicle_type, services in (("moto", ["moto", "moving"]), ("truck", ["delivery"])):
        response = await client.post(
            f"{DRIVERS}/me/vehicles",
            json=_vehicle(vehicle_type, services),
            headers=account.headers,
        )
        assert response.status_code == 422, response.text


@pytest.mark.settings(driver_auto_approve=True)
async def test_driver_with_three_vehicles_chooses_which_one_to_drive(client):
    driver = await sign_in(client, "multi-vehicle")

    await _register(client, driver, "taxi", ["taxi"], plate="T-1")
    await _register(client, driver, "moto", ["moto", "delivery"], plate="M-1")
    third = await _register(client, driver, "truck", ["moving"], plate="C-1")
    assert third["user"]["driver_status"] == "approved"
    assert third["user"]["role"] == "passenger"
    # The first registered vehicle is the active one until the driver picks another.
    assert third["user"]["vehicle_type"] == "taxi"
    listed = await client.get(f"{DRIVERS}/me/vehicles", headers=driver.headers)
    assert [v["vehicle_type"] for v in listed.json()] == ["taxi", "moto", "truck"]

    # Several approved vehicles and no choice: the active one (taxi) is kept.
    kept = await _switch(client, driver, "driver")
    assert kept.status_code == 200, kept.text
    assert kept.json()["role"] == "driver"
    assert kept.json()["vehicle_type"] == "taxi"

    # Switch vehicle while offline: the moto (with deliveries) becomes active.
    moto = await _switch(client, driver, "driver", "moto")
    assert moto.status_code == 200, moto.text
    assert moto.json()["vehicle_type"] == "moto"
    assert moto.json()["plate"] == "M-1"
    assert moto.json()["driver_services"] == ["moto", "delivery"]

    online = await client.post(
        f"{DRIVERS}/me/online", json={"is_online": True}, headers=driver.headers
    )
    assert online.status_code == 200, online.text
    # Changing vehicle while online is refused.
    assert (await _switch(client, driver, "driver", "truck")).status_code == 409

    presences = []
    ride_ids: dict[str, str] = {}
    for service in ("taxi", "delivery", "moving"):
        passenger = await sign_in(client, f"multi-passenger-{service}")
        created = await client.post(RIDES, json=_ride_payload(service), headers=passenger.headers)
        assert created.status_code == 201, created.text
        ride_ids[service] = created.json()["id"]
        presences.append(_mark_present(ride_ids[service]))

    pool = (await client.get(f"{RIDES}/open", headers=driver.headers)).json()["items"]
    assert [ride["id"] for ride in pool] == [ride_ids["delivery"]]

    # The active vehicle cannot be edited or removed while driving with it…
    editing = await client.post(
        f"{DRIVERS}/me/vehicles", json=_vehicle("moto", ["moto"], "M-2"), headers=driver.headers
    )
    assert editing.status_code == 403, editing.text
    assert (
        await client.delete(f"{DRIVERS}/me/vehicles/moto", headers=driver.headers)
    ).status_code == 403
    # …but another one can be removed.
    removed = await client.delete(f"{DRIVERS}/me/vehicles/truck", headers=driver.headers)
    assert removed.status_code == 200, removed.text
    assert (
        await client.delete(f"{DRIVERS}/me/vehicles/truck", headers=driver.headers)
    ).status_code == 404

    # Back to passenger mode requires being offline; vehicles survive.
    assert (await _switch(client, driver, "passenger")).status_code == 409
    assert (
        await client.post(f"{DRIVERS}/me/online", json={"is_online": False}, headers=driver.headers)
    ).status_code == 200
    back = await _switch(client, driver, "passenger")
    assert back.status_code == 200, back.text
    assert back.json()["role"] == "passenger"
    assert back.json()["driver_status"] == "approved"
    listed = await client.get(f"{DRIVERS}/me/vehicles", headers=driver.headers)
    assert [v["vehicle_type"] for v in listed.json()] == ["taxi", "moto"]

    for presence in presences:
        for ride_id in ride_ids.values():
            hub.unsubscribe(ride_topic(uuid.UUID(ride_id)), presence)
