"""Tests e2e de los endpoints de viajes."""

from __future__ import annotations

REGISTER = "/api/v1/auth/register"
RIDES = "/api/v1/rides"
RECENT = "/api/v1/rides/recent-destinations"


async def _auth_header(client) -> dict[str, str]:
    resp = await client.post(
        REGISTER,
        json={"full_name": "Alex", "email": "alex@example.com", "password": "secret123"},
    )
    access = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {access}"}


def _ride_payload(**over):
    base = {
        "origin": {"latitude": -16.5, "longitude": -68.13, "name": "Casa", "address": "Calle 1"},
        "destination": {
            "latitude": -16.49,
            "longitude": -68.14,
            "name": "Trabajo",
            "address": "Av. 2",
        },
        "service_type": "taxi",
        "fare": "25.00",
    }
    base.update(over)
    return base


async def test_create_ride_requires_auth(client):
    resp = await client.post(RIDES, json=_ride_payload())
    assert resp.status_code == 401


async def test_create_ride_success(client):
    headers = await _auth_header(client)
    resp = await client.post(RIDES, json=_ride_payload(), headers=headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "searching"
    assert body["service_type"] == "taxi"
    assert body["payment_method"] == "cash"
    assert body["destination"]["name"] == "Trabajo"
    assert "id" in body


async def test_create_ride_with_qr_payment(client):
    headers = await _auth_header(client)
    resp = await client.post(
        RIDES, json=_ride_payload(service_type="moto", payment_method="qr"), headers=headers
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["service_type"] == "moto"
    assert body["payment_method"] == "qr"


async def test_create_ride_rejects_bad_fare(client):
    headers = await _auth_header(client)
    resp = await client.post(RIDES, json=_ride_payload(fare="0"), headers=headers)
    assert resp.status_code == 422


async def test_create_ride_rejects_out_of_range_coordinates(client):
    headers = await _auth_header(client)
    payload = _ride_payload(
        destination={"latitude": 200, "longitude": -68.14, "name": "X", "address": "Y"}
    )
    resp = await client.post(RIDES, json=payload, headers=headers)
    assert resp.status_code == 422


async def test_recent_destinations_empty_then_populated(client):
    headers = await _auth_header(client)

    empty = await client.get(RECENT, headers=headers)
    assert empty.status_code == 200
    assert empty.json() == []

    await client.post(RIDES, json=_ride_payload(), headers=headers)

    populated = await client.get(RECENT, headers=headers)
    assert populated.status_code == 200
    data = populated.json()
    assert len(data) == 1
    assert data[0]["name"] == "Trabajo"
