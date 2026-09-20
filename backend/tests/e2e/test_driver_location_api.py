"""Private live GPS through HTTP and WebSocket boundaries."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from starlette.websockets import WebSocketDisconnect

from app.api.deps import build_managed_sessions
from app.domain.entities import VehicleType
from app.infrastructure.db.models import UserModel
from tests.e2e.helpers import sign_in_sync
from tests.e2e.helpers import test_settings as _test_settings
from tests.e2e.test_negotiation_ws import (
    _headers,
    _promote_driver,
    _register,
    _ride_payload,
)
from tests.e2e.test_negotiation_ws import (
    ws_client as ws_client,
)


def _sample(**changes):
    return {
        "latitude": -16.50,
        "longitude": -68.13,
        "accuracy_meters": 8,
        "heading": 90,
        "captured_at": datetime.now(UTC).isoformat(),
        **changes,
    }


def _trip(client, service="taxi"):
    client.gps_rider = sign_in_sync(client, "gps-rider")
    rider = client.gps_rider.token
    driver = _register(client, "gps-driver")
    outsider = _register(client, "gps-outsider")
    _promote_driver(client, "gps-driver", VehicleType(service))
    response = client.post("/api/v1/rides", json=_ride_payload(service), headers=_headers(rider))
    assert response.status_code == 201, response.text
    path = f"/api/v1/rides/{response.json()['id']}"
    offer = client.post(f"{path}/offers", json={"accept_at_fare": True}, headers=_headers(driver))
    assert offer.status_code == 201, offer.text
    accepted = client.post(
        f"/api/v1/rides/offers/{offer.json()['id']}/accept", headers=_headers(rider)
    )
    assert accepted.status_code == 200, accepted.text
    return path, rider, driver, outsider


@pytest.mark.parametrize("service", ["taxi", "moto"])
def test_live_updates_reconnect_and_terminal_state(ws_client, service):
    client = ws_client
    path, rider, driver, outsider = _trip(client, service)
    gps = f"{path}/driver-location"
    socket_path = path.replace("/api/v1/rides/", "/api/v1/ws/rides/") + "/driver-location"
    assert client.get(gps, headers=_headers(rider)).json() is None
    for token in (rider, outsider):
        assert client.put(gps, json=_sample(), headers=_headers(token)).status_code == 403
    assert client.get(gps, headers=_headers(outsider)).status_code == 403
    with client.websocket_connect(socket_path, subprotocols=["viajaya.auth", rider]) as socket:
        assert socket.receive_json() == {"type": "driver_location", "data": None}
        first = _sample()
        assert client.put(gps, json=first, headers=_headers(driver)).json() == {"accepted": True}
        frame = socket.receive_json()
        assert frame["type"] == "driver_location"
        assert frame["data"]["latitude"] == first["latitude"]
        assert frame["data"]["ride_id"] == path.rsplit("/", 1)[1]
        assert client.put(gps, json=first, headers=_headers(driver)).json() == {"accepted": False}
        for status in ("arriving", "in_progress"):
            assert (
                client.patch(
                    f"{path}/status", json={"status": status}, headers=_headers(driver)
                ).status_code
                == 200
            )
            updated = _sample(latitude=-16.501 if status == "arriving" else -16.502)
            assert client.put(gps, json=updated, headers=_headers(driver)).status_code == 200
            assert socket.receive_json()["data"]["latitude"] == updated["latitude"]
    with client.websocket_connect(socket_path, subprotocols=["viajaya.auth", rider]) as socket:
        assert socket.receive_json()["data"]["latitude"] == -16.502
    assert (
        client.patch(
            f"{path}/status", json={"status": "completed"}, headers=_headers(driver)
        ).status_code
        == 200
    )
    assert client.get(gps, headers=_headers(rider)).json() is None
    assert client.put(gps, json=_sample(), headers=_headers(driver)).status_code == 409
    with client.websocket_connect(socket_path, subprotocols=["viajaya.auth", rider]) as socket:
        assert socket.receive_json()["data"] is None
    for protocols in ([], ["viajaya.auth", outsider]):
        with pytest.raises(WebSocketDisconnect) as failure:
            with client.websocket_connect(socket_path, subprotocols=protocols) as socket:
                socket.receive_json()
        assert failure.value.code == 1008


@pytest.mark.parametrize(
    "changes",
    [
        {"latitude": 91},
        {"longitude": -181},
        {"accuracy_meters": 101},
        {"accuracy_meters": -1},
        {"heading": 360},
        {"captured_at": "2026-01-01T00:00:00"},
        {"captured_at": "2020-01-01T00:00:00Z"},
        {"captured_at": (datetime.now(UTC) + timedelta(days=2)).isoformat()},
    ],
)
def test_invalid_gps_does_not_replace_latest(ws_client, changes):
    path, rider, driver, _ = _trip(ws_client)
    path += "/driver-location"
    good = _sample()
    assert ws_client.put(path, json=good, headers=_headers(driver)).status_code == 200
    rejected = ws_client.put(path, json=_sample(**changes), headers=_headers(driver))
    assert rejected.status_code in (400, 422), rejected.text
    assert ws_client.get(path, headers=_headers(rider)).json()["latitude"] == good["latitude"]


def test_late_sample_and_cancellation_cannot_restore_location(ws_client):
    path, rider, driver, _ = _trip(ws_client)
    gps = f"{path}/driver-location"
    first = _sample()
    assert ws_client.put(gps, json=first, headers=_headers(driver)).status_code == 200
    older = _sample(
        latitude=-16.9, captured_at=(datetime.now(UTC) - timedelta(seconds=10)).isoformat()
    )
    assert ws_client.put(gps, json=older, headers=_headers(driver)).json() == {"accepted": False}
    assert ws_client.get(gps, headers=_headers(rider)).json()["latitude"] == first["latitude"]
    assert ws_client.post(f"{path}/cancel", headers=_headers(rider)).status_code == 200
    assert ws_client.get(gps, headers=_headers(rider)).json() is None
    assert ws_client.put(gps, json=_sample(), headers=_headers(driver)).status_code == 409


def test_revoked_session_cannot_receive_next_gps_or_reconnect(ws_client):
    path, _, driver, _ = _trip(ws_client)
    rider = ws_client.gps_rider
    socket_path = path.replace("/api/v1/rides/", "/api/v1/ws/rides/") + "/driver-location"

    async def create_session():
        async with ws_client.factory() as session:
            user = await session.get(UserModel, uuid.UUID(rider.user_id))
            access = build_managed_sessions(session, _test_settings())
            await access.accounts.lock_user(user.id)
            grant = await access.create(user.id, uuid.uuid4(), "GPS test")
            await session.commit()
            return access.tokens.create_session_pair(grant)

    tokens = ws_client.portal.call(create_session)
    protocols = ["viajaya.auth", tokens.access_token]
    with ws_client.websocket_connect(socket_path, subprotocols=protocols) as socket:
        assert socket.receive_json()["data"] is None
        assert (
            ws_client.post(
                "/api/v1/auth/logout", json={"refresh_token": tokens.refresh_token}
            ).status_code
            == 204
        )
        assert (
            ws_client.put(
                f"{path}/driver-location", json=_sample(), headers=_headers(driver)
            ).status_code
            == 200
        )
        with pytest.raises(WebSocketDisconnect) as rejected:
            socket.receive_json()
        assert rejected.value.code == 1008
    with ws_client.websocket_connect(socket_path, subprotocols=protocols) as socket:
        with pytest.raises(WebSocketDisconnect) as rejected:
            socket.receive_json()
        assert rejected.value.code == 1008
