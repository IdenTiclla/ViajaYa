"""E2E: a request with ``auto_accept`` is assigned to the first driver who accepts its fare."""

from __future__ import annotations

import uuid

from app.domain.entities import VehicleType
from app.infrastructure.realtime.hub import hub, ride_topic
from tests.e2e.helpers import promote_to_driver, sign_in

RIDES = "/api/v1/rides"


class _FakeWS:
    """WebSocket double that keeps the passenger present so the request stays in the pool."""

    async def send_json(self, message: dict) -> None:  # pragma: no cover - no-op
        pass


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _ride_payload(*, auto_accept: bool | None) -> dict:
    payload: dict = {
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
    if auto_accept is not None:
        payload["auto_accept"] = auto_accept
    return payload


async def _driver(client, session_factory, label: str) -> dict[str, str]:
    account = await sign_in(client, label)
    await promote_to_driver(session_factory, label, VehicleType.TAXI)
    return _headers(account.token)


async def test_first_driver_accepting_the_fare_gets_the_ride(client, session_factory):
    rider_h = _headers((await sign_in(client, "auto-rider")).token)
    counter_h = await _driver(client, session_factory, "auto-counter")
    winner_h = await _driver(client, session_factory, "auto-winner")
    late_h = await _driver(client, session_factory, "auto-late")

    created = await client.post(RIDES, json=_ride_payload(auto_accept=True), headers=rider_h)
    assert created.status_code == 201, created.text
    assert created.json()["auto_accept"] is True
    ride_id = created.json()["id"]
    presence = _FakeWS()
    hub.subscribe(ride_topic(uuid.UUID(ride_id)), presence)
    try:
        pool = (await client.get(f"{RIDES}/open", headers=winner_h)).json()["items"]
        assert next(ride for ride in pool if ride["id"] == ride_id)["auto_accept"] is True

        # A counter-offer above the fare still waits for the passenger.
        counter = await client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": False, "price": "30.00", "eta_min": 6},
            headers=counter_h,
        )
        assert counter.status_code == 201, counter.text
        assert counter.json()["status"] == "pending"

        # Accepting the passenger's fare assigns the ride right away.
        winner = await client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": True, "eta_min": 4},
            headers=winner_h,
        )
        assert winner.status_code == 201, winner.text
        assert winner.json()["status"] == "accepted"

        ride = (await client.get(f"{RIDES}/{ride_id}", headers=rider_h)).json()
        assert ride["status"] == "accepted"
        assert ride["driver"]["full_name"] == "auto-winner"
        assert ride["accepted_price"] == "25.00"
        assert ride["auto_accept"] is True
        assert (await client.get(f"{RIDES}/{ride_id}/offers", headers=rider_h)).json() == []

        late = await client.post(
            f"{RIDES}/{ride_id}/offers", json={"accept_at_fare": True}, headers=late_h
        )
        assert late.status_code == 409, late.text
    finally:
        hub.unsubscribe(ride_topic(uuid.UUID(ride_id)), presence)


async def test_without_auto_accept_the_passenger_still_decides(client, session_factory):
    rider_h = _headers((await sign_in(client, "manual-rider")).token)
    driver_h = await _driver(client, session_factory, "manual-driver")

    created = await client.post(RIDES, json=_ride_payload(auto_accept=None), headers=rider_h)
    assert created.status_code == 201, created.text
    assert created.json()["auto_accept"] is False
    ride_id = created.json()["id"]
    presence = _FakeWS()
    hub.subscribe(ride_topic(uuid.UUID(ride_id)), presence)
    try:
        offer = await client.post(
            f"{RIDES}/{ride_id}/offers", json={"accept_at_fare": True}, headers=driver_h
        )
        assert offer.status_code == 201, offer.text
        assert offer.json()["status"] == "pending"
        ride = (await client.get(f"{RIDES}/{ride_id}", headers=rider_h)).json()
        assert ride["status"] == "searching"
        assert ride["auto_accept"] is False
    finally:
        hub.unsubscribe(ride_topic(uuid.UUID(ride_id)), presence)


async def test_editing_the_request_can_turn_auto_accept_on(client):
    rider_h = _headers((await sign_in(client, "edit-auto-rider")).token)
    created = await client.post(RIDES, json=_ride_payload(auto_accept=False), headers=rider_h)
    ride_id = created.json()["id"]

    paused = await client.post(f"{RIDES}/{ride_id}/pause-edit", headers=rider_h)
    assert paused.status_code == 200, paused.text
    edited = await client.patch(
        f"{RIDES}/{ride_id}", json=_ride_payload(auto_accept=True), headers=rider_h
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["auto_accept"] is True
