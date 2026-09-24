"""Test e2e del ciclo Modificar solicitud: pausar, editar y re-publicar."""

from __future__ import annotations

from app.domain.entities import VehicleType
from tests.e2e.helpers import promote_to_driver, sign_in

RIDES = "/api/v1/rides"


async def _register(client, label: str) -> tuple[str, str]:
    account = await sign_in(client, label)
    return account.user_id, account.token


async def _promote_to_driver(session_factory, label: str, vehicle: VehicleType) -> None:
    await promote_to_driver(session_factory, label, vehicle)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _ride_payload(fare: str = "25.00", dest_name: str = "Trabajo") -> dict:
    return {
        "origin": {"latitude": -16.5, "longitude": -68.13, "name": "Casa", "address": "Calle 1"},
        "destination": {
            "latitude": -16.49,
            "longitude": -68.14,
            "name": dest_name,
            "address": "Av. 2",
        },
        "service_type": "taxi",
        "fare": fare,
    }


async def test_pause_edit_and_republish_ride(client, session_factory):
    _, rider_token = await _register(client, "rider")
    _, drv_token = await _register(client, "driver")
    await _promote_to_driver(session_factory, "driver", VehicleType.TAXI)
    rider_h, drv_h = _headers(rider_token), _headers(drv_token)

    ride_id = (await client.post(RIDES, json=_ride_payload(), headers=rider_h)).json()["id"]

    # A driver offers on the request.
    offer = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=drv_h,
    )
    assert offer.status_code == 201

    # Pause to edit: the request stays searching but is hidden from the pool.
    paused = await client.post(f"{RIDES}/{ride_id}/pause-edit", headers=rider_h)
    assert paused.status_code == 200
    assert paused.json()["status"] == "searching"

    # The live offers were withdrawn: the passenger no longer sees any.
    offers_after_pause = await client.get(f"{RIDES}/{ride_id}/offers", headers=rider_h)
    assert offers_after_pause.json() == []

    # Editar: nuevo destino y mayor monto.
    edited = await client.patch(
        f"{RIDES}/{ride_id}",
        json=_ride_payload(fare="35.00", dest_name="Mercado"),
        headers=rider_h,
    )
    assert edited.status_code == 200
    body = edited.json()
    assert body["status"] == "searching"
    assert body["fare"] == "35.00"
    assert body["destination"]["name"] == "Mercado"

    # After editing, a driver can offer again on the updated request.
    offer_again = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=drv_h,
    )
    assert offer_again.status_code == 201
    assert offer_again.json()["price"] == "35.00"

    # And the passenger can accept (direct assignment).
    offer_id = offer_again.json()["id"]
    accepted = await client.post(f"{RIDES}/offers/{offer_id}/accept", headers=rider_h)
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"


async def test_edit_without_pause_rejected(client, session_factory):
    _, rider_token = await _register(client, "rider2")
    rider_h = _headers(rider_token)
    ride_id = (await client.post(RIDES, json=_ride_payload(), headers=rider_h)).json()["id"]

    # It cannot be edited without pausing first.
    edited = await client.patch(
        f"{RIDES}/{ride_id}",
        json=_ride_payload(fare="35.00"),
        headers=rider_h,
    )
    assert edited.status_code == 409


async def test_edit_rejects_destination_outside_bolivia_and_keeps_ride_paused(
    client,
):
    _, rider_token = await _register(client, "border-rider")
    rider_h = _headers(rider_token)
    created = await client.post(RIDES, json=_ride_payload(), headers=rider_h)
    ride_id = created.json()["id"]
    paused = await client.post(f"{RIDES}/{ride_id}/pause-edit", headers=rider_h)
    assert paused.status_code == 200, paused.text

    payload = _ride_payload(fare="35.00", dest_name="Fuerte Olimpo")
    payload["destination"] = {
        "latitude": -21.041,
        "longitude": -57.873,
        "name": "Fuerte Olimpo",
        "address": "Paraguay",
        "country_code": "BO",
    }
    edited = await client.patch(
        f"{RIDES}/{ride_id}", json=payload, headers=rider_h
    )

    assert edited.status_code == 422
    assert "Bolivia" in edited.json()["detail"]
    stored = await client.get(f"{RIDES}/{ride_id}", headers=rider_h)
    assert stored.status_code == 200
    assert stored.json()["paused"] is True
    assert stored.json()["destination"]["name"] == "Trabajo"
