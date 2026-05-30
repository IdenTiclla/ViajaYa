"""Tests e2e de los endpoints de lugares guardados."""

from __future__ import annotations

REGISTER = "/api/v1/auth/register"
SAVED_PLACES = "/api/v1/saved-places"


async def _auth_header(client, email: str = "alex@example.com") -> dict[str, str]:
    resp = await client.post(
        REGISTER,
        json={"full_name": "Alex", "email": email, "password": "secret123"},
    )
    access = resp.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {access}"}


def _payload(**over):
    base = {
        "label": "Casa",
        "category": "home",
        "location": {
            "latitude": -16.5,
            "longitude": -68.13,
            "name": "Mi casa",
            "address": "Calle 1",
        },
    }
    base.update(over)
    return base


async def test_saved_places_require_auth(client):
    resp = await client.get(SAVED_PLACES)
    assert resp.status_code == 401


async def test_create_and_list_saved_place(client):
    headers = await _auth_header(client)

    empty = await client.get(SAVED_PLACES, headers=headers)
    assert empty.status_code == 200
    assert empty.json() == []

    created = await client.post(SAVED_PLACES, json=_payload(), headers=headers)
    assert created.status_code == 201
    body = created.json()
    assert body["label"] == "Casa"
    assert body["category"] == "home"
    assert body["location"]["address"] == "Calle 1"
    assert "id" in body

    listed = await client.get(SAVED_PLACES, headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1


async def test_create_saved_place_rejects_bad_coordinates(client):
    headers = await _auth_header(client)
    payload = _payload(
        location={"latitude": 200, "longitude": -68.0, "name": "X", "address": "Y"}
    )
    resp = await client.post(SAVED_PLACES, json=payload, headers=headers)
    assert resp.status_code == 422


async def test_update_saved_place(client):
    headers = await _auth_header(client)
    created = await client.post(SAVED_PLACES, json=_payload(), headers=headers)
    place_id = created.json()["id"]

    updated = await client.put(
        f"{SAVED_PLACES}/{place_id}",
        json=_payload(label="Trabajo", category="work"),
        headers=headers,
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["label"] == "Trabajo"
    assert body["category"] == "work"


async def test_delete_saved_place(client):
    headers = await _auth_header(client)
    created = await client.post(SAVED_PLACES, json=_payload(), headers=headers)
    place_id = created.json()["id"]

    deleted = await client.delete(f"{SAVED_PLACES}/{place_id}", headers=headers)
    assert deleted.status_code == 204

    listed = await client.get(SAVED_PLACES, headers=headers)
    assert listed.json() == []


async def test_saved_places_isolated_between_users(client):
    alice = await _auth_header(client, email="alice@example.com")
    bob = await _auth_header(client, email="bob@example.com")

    created = await client.post(SAVED_PLACES, json=_payload(), headers=alice)
    place_id = created.json()["id"]

    # Bob no ve los lugares de Alice...
    assert (await client.get(SAVED_PLACES, headers=bob)).json() == []
    # ...ni puede editarlos o borrarlos (404, no se revela su existencia).
    assert (
        await client.put(f"{SAVED_PLACES}/{place_id}", json=_payload(), headers=bob)
    ).status_code == 404
    assert (
        await client.delete(f"{SAVED_PLACES}/{place_id}", headers=bob)
    ).status_code == 404
