"""E2E test of the negotiation WebSocket channel (snapshot + events + auth).

Uses Starlette's synchronous ``TestClient`` (it supports ``websocket_connect``). The
DB setup and driver promotion run on the client's same
event loop through ``client.portal``.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.deps import get_session_factory
from app.api.v1.schemas.realtime import (
    DriverOffersSnapshotMessage,
    DriverSnapshotMessageV2,
    OfferCreatedMessage,
    OffersSnapshotMessage,
    OpenRidesSnapshotMessage,
    PausedRidesSnapshotMessage,
    RealtimeEventEnvelopeV2,
    RideSnapshotMessageV2,
    RideStatusMessage,
    parse_negotiation_message,
)
from app.domain.entities import OfferStatus, VehicleType
from app.infrastructure.db.account_access import SqlAlchemyPhoneAccountRepository
from app.infrastructure.db.base import Base
from app.infrastructure.db.models import OfferModel
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.session import get_session
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from app.main import create_app
from tests.e2e.helpers import phone_for, promote_to_driver, sign_in_sync, test_settings

RIDES = "/api/v1/rides"


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
def test_multiple_negotiations_survive_reconnect_and_only_winner_offers_are_withdrawn(
    ws_client: TestClient, service_type: str,
) -> None:
    passengers = [_register(ws_client, f"multi-passenger-{index}") for index in range(3)]
    drivers = [_register(ws_client, f"multi-driver-{index}") for index in range(2)]
    for index in range(2):
        _promote_driver(ws_client, f"multi-driver-{index}", VehicleType(service_type))
    rides = [
        ws_client.post(RIDES, json=_ride_payload(service_type), headers=_headers(token)).json()
        for token in passengers
    ]
    with ExitStack() as sockets:
        passenger_sockets = [
            sockets.enter_context(_websocket_connect(
                ws_client, f"/api/v1/ws/rides/{ride['id']}?token={token}",
            ))
            for ride, token in zip(rides, passengers, strict=True)
        ]
        for socket in passenger_sockets:
            assert socket.receive_json()["type"] == "offers_snapshot"
        offers = []
        for driver in drivers:
            driver_offers = []
            for ride, socket in zip(rides, passenger_sockets, strict=True):
                response = ws_client.post(
                    f"{RIDES}/{ride['id']}/offers", headers=_headers(driver),
                    json={"accept_at_fare": True, "eta_min": 4},
                )
                assert response.status_code == 201, response.text
                offer = response.json()
                driver_offers.append(offer)
                event = socket.receive_json()
                assert event["type"] == "offer_created"
                assert event["data"]["id"] == offer["id"]
            offers.append(driver_offers)

        # Reconnection restores every pending negotiation, without assigning a trip.
        driver_socket = sockets.enter_context(_websocket_connect(
            ws_client, f"/api/v1/ws/driver?token={drivers[0]}",
        ))
        pool, snapshot = _receive_driver_handshake(driver_socket)
        assert {item["id"] for item in pool["data"]["items"]} == {r["id"] for r in rides}
        assert {item["id"] for item in snapshot["data"]} == {o["id"] for o in offers[0]}
        assert ws_client.get(
            "/api/v1/drivers/me/active-ride", headers=_headers(drivers[0]),
        ).json() is None
        for ride, token in zip(rides, passengers, strict=True):
            available = ws_client.get(f"{RIDES}/{ride['id']}/offers", headers=_headers(token))
            assert len(available.json()) == 2

        accepted = ws_client.post(
            f"{RIDES}/offers/{offers[0][0]['id']}/accept", headers=_headers(passengers[0]),
        )
        assert accepted.status_code == 200, accepted.text
        assert passenger_sockets[0].receive_json()["data"]["status"] == "accepted"
        for index in (1, 2):
            withdrawn = passenger_sockets[index].receive_json()
            assert withdrawn["type"] == "offer_withdrawn"
            assert withdrawn["data"]["offer_id"] == offers[0][index]["id"]
            available = ws_client.get(
                f"{RIDES}/{rides[index]['id']}/offers", headers=_headers(passengers[index]),
            ).json()
            assert [item["id"] for item in available] == [offers[1][index]["id"]]

        events = [driver_socket.receive_json() for _ in range(3)]
        assert [event["type"] for event in events] == [
            "ride_closed", "offer_accepted", "offers_withdrawn",
        ]
        assert events[1]["data"]["id"] == rides[0]["id"]
        assert set(events[2]["data"]["ride_ids"]) == {r["id"] for r in rides[1:]}
        stale_accept = ws_client.post(
            f"{RIDES}/offers/{offers[0][1]['id']}/accept", headers=_headers(passengers[1]),
        )
        assert stale_accept.status_code == 409
        busy_offer = ws_client.post(
            f"{RIDES}/{rides[2]['id']}/offers", headers=_headers(drivers[0]),
            json={"accept_at_fare": True, "eta_min": 4},
        )
        assert busy_offer.status_code == 409
        second = ws_client.post(
            f"{RIDES}/offers/{offers[1][1]['id']}/accept", headers=_headers(passengers[1]),
        )
        assert second.status_code == 200, second.text
        assert second.json()["driver"]["id"] != accepted.json()["driver"]["id"]


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
def test_v2_reconnect_restores_all_negotiations_and_converges_after_assignment(
    ws_client_v2: TestClient, service_type: str,
) -> None:
    client = ws_client_v2
    passengers = [_register(client, f"v2-multi-passenger-{index}") for index in range(3)]
    drivers = [_register(client, f"v2-multi-driver-{index}") for index in range(2)]
    for index in range(2):
        _promote_driver(client, f"v2-multi-driver-{index}", VehicleType(service_type))
    rides = []
    for token in passengers:
        created = client.post(RIDES, json=_ride_payload(service_type), headers=_headers(token))
        assert created.status_code == 201, created.text
        rides.append(created.json())

    with ExitStack() as sockets:
        passenger_sockets = [
            sockets.enter_context(_websocket_connect(
                client, f"/api/v1/ws/rides/{ride['id']}?token={token}",
            ))
            for ride, token in zip(rides, passengers, strict=True)
        ]
        versions = []
        for socket in passenger_sockets:
            snapshot = RideSnapshotMessageV2.model_validate(socket.receive_json())
            assert snapshot.data.offers == []
            versions.append(snapshot.watermarks[0].stream_version)
        offers = []
        for driver in drivers:
            driver_offers = []
            for index, (ride, socket) in enumerate(zip(rides, passenger_sockets, strict=True)):
                response = client.post(
                    f"{RIDES}/{ride['id']}/offers", headers=_headers(driver),
                    json={"accept_at_fare": True, "eta_min": 4},
                )
                assert response.status_code == 201, response.text
                driver_offers.append(response.json())
                event = RealtimeEventEnvelopeV2.model_validate(socket.receive_json())
                assert event.type == "offer_created"
                assert event.data["id"] == response.json()["id"]
                assert event.stream == f"ride:{ride['id']}"
                assert event.stream_version == versions[index] + 1
                versions[index] = event.stream_version
            offers.append(driver_offers)

        # The durable snapshot must recover every pending offer after disconnection.
        with _websocket_connect(client, f"/api/v1/ws/driver?token={drivers[0]}") as driver_ws:
            before = DriverSnapshotMessageV2.model_validate(driver_ws.receive_json())
            assert {str(item.id) for item in before.data.offers} == {
                offer["id"] for offer in offers[0]
            }
            assert before.data.active_ride is None

        accepted = client.post(
            f"{RIDES}/offers/{offers[0][0]['id']}/accept", headers=_headers(passengers[0]),
        )
        assert accepted.status_code == 200, accepted.text
        for index, socket in enumerate(passenger_sockets):
            event = RealtimeEventEnvelopeV2.model_validate(socket.receive_json())
            assert event.stream_version == versions[index] + 1
            assert event.stream == f"ride:{rides[index]['id']}"
            if index == 0:
                assert event.type == "ride_status"
                assert event.data == accepted.json()
            else:
                assert event.type == "offer_withdrawn"
                assert event.data["offer_id"] == offers[0][index]["id"]

        # Reconnect both drivers: only the winner is assigned; the other keeps two offers.
        for index, token in enumerate(drivers):
            with _websocket_connect(client, f"/api/v1/ws/driver?token={token}") as driver_ws:
                after = DriverSnapshotMessageV2.model_validate(driver_ws.receive_json())
                if index == 0:
                    assert after.data.active_ride.model_dump(mode="json") == accepted.json()
                    assert after.data.offers == []
                else:
                    assert after.data.active_ride is None
                    assert {str(item.id) for item in after.data.offers} == {
                        offer["id"] for offer in offers[1][1:]
                    }
        for index in (1, 2):
            with _websocket_connect(
                client, f"/api/v1/ws/rides/{rides[index]['id']}?token={passengers[index]}",
            ) as passenger_ws:
                after = RideSnapshotMessageV2.model_validate(passenger_ws.receive_json())
                assert after.data.ride.status.value == "searching"
                assert [str(item.id) for item in after.data.offers] == [offers[1][index]["id"]]
                assert after.watermarks[0].stream_version == versions[index] + 1


def _ride_payload(service_type: str = "taxi") -> dict:
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


def _register(client: TestClient, label: str) -> str:
    return sign_in_sync(client, label).token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _websocket_connect(client: TestClient, url: str):
    """Convert the test's historical URLs to the secure protocol-based handshake."""
    parsed = urlsplit(url)
    token = parse_qs(parsed.query).get("token", [None])[0]
    subprotocols = [AUTH_SUBPROTOCOL, token] if token else None
    return client.websocket_connect(parsed.path, subprotocols=subprotocols)


def _receive_driver_handshake(ws) -> tuple[dict, dict]:
    """Consume the driver's authoritative handshake in its contractual order."""
    open_rides = ws.receive_json()
    assert isinstance(parse_negotiation_message(open_rides), OpenRidesSnapshotMessage)
    paused_rides = ws.receive_json()
    assert isinstance(
        parse_negotiation_message(paused_rides), PausedRidesSnapshotMessage
    )
    offers = ws.receive_json()
    assert isinstance(parse_negotiation_message(offers), DriverOffersSnapshotMessage)
    return open_rides, offers


@pytest.fixture
def ws_client(tmp_path):
    """TestClient with a file-backed SQLite to allow concurrent sessions."""
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'negotiation.db'}",
        future=True,
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_session():
        async with factory() as session:
            yield session

    async def create_tables() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(create_tables())
    app = create_app(settings=test_settings(), session_factory=factory)
    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_session_factory] = lambda: factory

    with TestClient(app) as client:
        client.factory = factory  # type: ignore[attr-defined]
        try:
            yield client
        finally:
            client.portal.call(engine.dispose)


@pytest.fixture
def ws_client_v2(tmp_path):
    """Servidor canary con outbox→hub local y handshake v2 habilitados."""
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'negotiation-v2.db'}",
        future=True,
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    settings = test_settings(
        realtime_outbox_dispatch_mode="live_local",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=0.01,
    )

    async def create_tables() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(create_tables())
    app = create_app(settings=settings, session_factory=factory)

    with TestClient(app) as client:
        client.factory = factory  # type: ignore[attr-defined]
        try:
            yield client
        finally:
            client.portal.call(engine.dispose)


@pytest.fixture(autouse=True)
def _reset_presence(ws_client: TestClient):
    """Cancel tasks and clear the global presence between tests."""
    from app.api.v1 import presence

    async def reset() -> None:
        tasks = set(presence._CANCEL_TASKS)
        tasks.update(presence._pending_cancels.values())
        tasks.update(presence._critical_cancels.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        presence._pending_cancels.clear()
        presence._critical_cancels.clear()
        presence._CANCEL_TASKS.clear()
        presence._last_seen.clear()

    ws_client.portal.call(reset)
    yield
    ws_client.portal.call(reset)


def _promote_driver(
    client: TestClient,
    label: str,
    vehicle: VehicleType = VehicleType.TAXI,
) -> None:
    client.portal.call(
        promote_to_driver, client.factory, label, vehicle,  # type: ignore[attr-defined]
    )


def _wait_for_ride_status(
    client: TestClient,
    ride_id: str,
    token: str,
    expected: str,
    *,
    timeout: float = 1.0,
) -> dict:
    """Wait for a presence task to converge without fragile sleeps."""
    from app.api.v1 import presence

    # SQLite does not model Postgres's concurrent access; we let the
    # presence transaction finish before querying with another fixture session.
    parsed_id = uuid.UUID(ride_id)
    deadline = time.monotonic() + timeout
    client.portal.call(asyncio.sleep, 0.05)
    while parsed_id in presence._last_seen and time.monotonic() < deadline:
        time.sleep(0.005)
    while True:
        response = client.get(f"{RIDES}/{ride_id}", headers=_headers(token))
        assert response.status_code == 200, response.text
        ride = response.json()
        if ride["status"] == expected:
            return ride
        if time.monotonic() >= deadline:
            pytest.fail(
                f"El viaje {ride_id} did not reach {expected}; estado actual: {ride['status']}"
            )
        time.sleep(0.01)


def test_passenger_receives_snapshot_and_live_offer(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    ride_id = ride["id"]

    url = f"/api/v1/ws/rides/{ride_id}?token={rider_token}"
    with _websocket_connect(ws_client, url) as ws:
        snapshot = ws.receive_json()
        assert isinstance(parse_negotiation_message(snapshot), OffersSnapshotMessage)
        assert snapshot["data"] == []

        # The driver offers over HTTP → the passenger receives it live.
        offer = ws_client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": True, "eta_min": 4},
            headers=_headers(driver_token),
        )
        assert offer.status_code == 201, offer.text
        event = ws.receive_json()
        assert isinstance(parse_negotiation_message(event), OfferCreatedMessage)
        assert event["data"]["ride_id"] == ride_id

        # On accepting, the passenger receives the assigned ride (final decision):
        # the ride_status event arrives with status=accepted.
        offer_id = offer.json()["id"]
        accepted = ws_client.post(
            f"{RIDES}/offers/{offer_id}/accept", headers=_headers(rider_token)
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["status"] == "accepted"
        status_event = ws.receive_json()
        assert isinstance(parse_negotiation_message(status_event), RideStatusMessage)
        assert status_event["data"]["status"] == "accepted"


def test_live_local_sends_single_v2_snapshot_and_durable_delta(
    ws_client_v2: TestClient,
) -> None:
    rider_token = _register(ws_client_v2, "rider-v2")
    driver_token = _register(ws_client_v2, "driver-v2")
    _promote_driver(ws_client_v2, "driver-v2")
    ride = ws_client_v2.post(
        RIDES,
        json=_ride_payload(),
        headers=_headers(rider_token),
    ).json()

    with _websocket_connect(
        ws_client_v2,
        f"/api/v1/ws/rides/{ride['id']}?token={rider_token}",
    ) as rider_ws:
        rider_snapshot = RideSnapshotMessageV2.model_validate(
            rider_ws.receive_json()
        )
        assert rider_snapshot.kind == "snapshot"
        assert rider_snapshot.data.ride.id == uuid.UUID(ride["id"])
        assert [item.stream for item in rider_snapshot.watermarks] == [
            f"ride:{ride['id']}"
        ]

        # Lets the presence announcement commit its outbox before the
        # driver's snapshot. The barrier still guarantees the snapshot goes first.
        ws_client_v2.portal.call(asyncio.sleep, 0.05)
        with _websocket_connect(
            ws_client_v2,
            f"/api/v1/ws/driver?token={driver_token}",
        ) as driver_ws:
            driver_snapshot = DriverSnapshotMessageV2.model_validate(
                driver_ws.receive_json()
            )
            assert driver_snapshot.kind == "snapshot"
            assert [item.id for item in driver_snapshot.data.open_rides.items] == [
                uuid.UUID(ride["id"])
            ]

            offer = ws_client_v2.post(
                f"{RIDES}/{ride['id']}/offers",
                json={"accept_at_fare": True, "eta_min": 4},
                headers=_headers(driver_token),
            )
            assert offer.status_code == 201, offer.text

            event = RealtimeEventEnvelopeV2.model_validate(rider_ws.receive_json())
            assert event.kind == "event"
            assert event.type == "offer_created"
            assert event.stream == f"ride:{ride['id']}"
            assert event.data["id"] == offer.json()["id"]
            assert event.stream_version == rider_snapshot.watermarks[0].stream_version + 1


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
def test_status_progression_reaches_both_participants_with_exact_http_payload(
    ws_client: TestClient, service_type: str,
) -> None:
    rider_token = _register(ws_client, "rider-status-ws")
    driver_token = _register(ws_client, "driver-status-ws")
    _promote_driver(ws_client, "driver-status-ws", VehicleType(service_type))

    with _websocket_connect(ws_client, "/api/v1/ws/driver?token=" + driver_token) as driver_ws:
        _receive_driver_handshake(driver_ws)
        ride = ws_client.post(
            RIDES,
            json=_ride_payload(service_type),
            headers=_headers(rider_token),
        ).json()

        with _websocket_connect(
            ws_client,
            f"/api/v1/ws/rides/{ride['id']}?token={rider_token}",
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            assert driver_ws.receive_json()["type"] == "ride_created"
            offer = ws_client.post(
                f"{RIDES}/{ride['id']}/offers",
                json={"accept_at_fare": True, "eta_min": 4},
                headers=_headers(driver_token),
            ).json()
            assert rider_ws.receive_json()["type"] == "offer_created"

            accepted = ws_client.post(
                f"{RIDES}/offers/{offer['id']}/accept",
                headers=_headers(rider_token),
            )
            assert accepted.status_code == 200, accepted.text
            assert rider_ws.receive_json()["data"]["status"] == "accepted"
            assert [driver_ws.receive_json()["type"] for _ in range(3)] == [
                "ride_closed",
                "offer_accepted",
                "offers_withdrawn",
            ]

            for next_status in ("arriving", "in_progress", "completed"):
                response = ws_client.patch(
                    f"{RIDES}/{ride['id']}/status",
                    json={"status": next_status},
                    headers=_headers(driver_token),
                )
                assert response.status_code == 200, response.text
                payload = response.json()

                rider_event = rider_ws.receive_json()
                driver_event = driver_ws.receive_json()
                assert rider_event == {"type": "ride_status", "data": payload}
                assert driver_event == {"type": "ride_status", "data": payload}
                if next_status == "arriving":
                    notice = ws_client.post(
                        f"{RIDES}/{ride['id']}/rider-on-the-way", headers=_headers(rider_token),
                    )
                    assert notice.status_code == 200, notice.text
                    assert notice.json()["rider_on_the_way_at"] is not None
                    expected = {"type": "ride_status", "data": notice.json()}
                    assert rider_ws.receive_json() == expected
                    assert driver_ws.receive_json() == expected
                else:
                    assert payload["rider_on_the_way_at"] is not None

            assert payload["completed_at"] is not None


def test_invalid_token_closes_socket(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    url = f"/api/v1/ws/rides/{ride['id']}?token=basura"
    with pytest.raises(WebSocketDisconnect):
        with _websocket_connect(ws_client, url) as ws:
            ws.receive_json()


def test_foreign_user_cannot_subscribe_to_ride(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    intruder_token = _register(ws_client, "intruder")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    url = f"/api/v1/ws/rides/{ride['id']}?token={intruder_token}"
    with pytest.raises(WebSocketDisconnect):
        with _websocket_connect(ws_client, url) as ws:
            ws.receive_json()


def test_driver_notified_when_passenger_rejects_offer(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    ).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)

        rejected = ws_client.post(
            f"{RIDES}/offers/{offer['id']}/reject", headers=_headers(rider_token)
        )
        assert rejected.status_code == 204, rejected.text

        event = ws.receive_json()
        assert event["type"] == "offer_rejected"
        assert event["data"]["offer_id"] == offer["id"]
        assert event["data"]["ride_id"] == ride["id"]


def test_driver_offer_snapshot_contains_only_live_pending_offers(ws_client: TestClient):
    rider_a_token = _register(ws_client, "rider-a")
    rider_b_token = _register(ws_client, "rider-b")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")
    ride_a = ws_client.post(
        RIDES, json=_ride_payload(), headers=_headers(rider_a_token)
    ).json()
    ride_b = ws_client.post(
        RIDES, json=_ride_payload(), headers=_headers(rider_b_token)
    ).json()
    live = ws_client.post(
        f"{RIDES}/{ride_a['id']}/offers",
        json={"accept_at_fare": False, "price": "28.00", "eta_min": 5},
        headers=_headers(driver_token),
    ).json()
    expired = ws_client.post(
        f"{RIDES}/{ride_b['id']}/offers",
        json={"accept_at_fare": False, "price": "31.00", "eta_min": 9},
        headers=_headers(driver_token),
    ).json()

    async def age_offer() -> None:
        async with ws_client.factory() as session:  # type: ignore[attr-defined]
            row = await session.get(OfferModel, uuid.UUID(expired["id"]))
            assert row is not None
            row.created_at = datetime.now(UTC) - timedelta(seconds=31)
            await session.commit()

    ws_client.portal.call(age_offer)

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _, snapshot = _receive_driver_handshake(ws)
        assert [offer["id"] for offer in snapshot["data"]] == [live["id"]]
        assert snapshot["data"][0]["ride_id"] == ride_a["id"]
        assert snapshot["data"][0]["price"] == "28.00"
        assert snapshot["data"][0]["status"] == "pending"
        assert snapshot["data"][0]["expires_at"] is not None

        expired_event = ws.receive_json()
        assert expired_event["type"] == "offer_expired"
        assert expired_event["data"]["offer_id"] == expired["id"]

    rejected = ws_client.post(
        f"{RIDES}/offers/{live['id']}/reject",
        headers=_headers(rider_a_token),
    )
    assert rejected.status_code == 204, rejected.text
    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _, empty_snapshot = _receive_driver_handshake(ws)
        assert empty_snapshot["data"] == []


def test_driver_receives_offer_accepted_on_passenger_accept(ws_client: TestClient):
    """When the passenger accepts, the driver receives offer_accepted (goes to navigate)."""
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    ).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)

        accepted = ws_client.post(
            f"{RIDES}/offers/{offer['id']}/accept", headers=_headers(rider_token)
        )
        assert accepted.status_code == 200, accepted.text

        # The batch order is part of the contract: close the pool, assign the
        # ride and only then clean up the winner's other offers.
        closed = ws.receive_json()
        offer_accepted = ws.receive_json()
        offers_withdrawn = ws.receive_json()
        assert [
            closed["type"],
            offer_accepted["type"],
            offers_withdrawn["type"],
        ] == ["ride_closed", "offer_accepted", "offers_withdrawn"]
        assert closed["data"] == {
            "ride_id": ride["id"],
            "pool_version": 1,
            "reason": "terminal",
        }
        assert offer_accepted["data"]["id"] == ride["id"]
        assert offer_accepted["data"]["status"] == "accepted"
        assert offers_withdrawn["data"] == {"ride_ids": [], "offers": []}


def test_passenger_sees_improved_offer_replace_old_one(ws_client: TestClient):
    """When the driver improves their offer, the old one is withdrawn and the new one arrives."""
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}") as ws:
        assert ws.receive_json()["type"] == "offers_snapshot"

        first = ws_client.post(
            f"{RIDES}/{ride['id']}/offers",
            json={"accept_at_fare": False, "price": "30.00"},
            headers=_headers(driver_token),
        ).json()
        assert ws.receive_json()["type"] == "offer_created"

        improved = ws_client.post(
            f"{RIDES}/{ride['id']}/offers",
            json={"accept_at_fare": False, "price": "26.00"},
            headers=_headers(driver_token),
        )
        assert improved.status_code == 201, improved.text

        withdrawn = ws.receive_json()
        assert withdrawn["type"] == "offer_withdrawn"
        assert withdrawn["data"]["offer_id"] == first["id"]
        # The improvement is told apart from a real withdrawal: the client shows no toast.
        assert withdrawn["data"]["reason"] == "superseded"

        created = ws.receive_json()
        assert created["type"] == "offer_created"
        assert created["data"]["price"] == "26.00"


def test_live_passenger_ws_keeps_custom_offer_negotiation_active_past_grace(
    ws_client: TestClient, monkeypatch
):
    """A counter-offer cannot close a search while the passenger is connected."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.03)
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    ride_id = ride["id"]

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride_id}?token={rider_token}"
    ) as ws:
        assert ws.receive_json()["type"] == "offers_snapshot"

        offered = ws_client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": False, "price": "30.00", "eta_min": 8},
            headers=_headers(driver_token),
        )
        assert offered.status_code == 201, offered.text
        event = ws.receive_json()
        assert event["type"] == "offer_created"
        assert event["data"]["price"] == "30.00"

        # Waiting longer than the compressed grace period is like keeping the screen
        # open beyond the real 30 s.
        time.sleep(0.08)
        current = ws_client.get(f"{RIDES}/{ride_id}", headers=_headers(rider_token))
        assert current.status_code == 200, current.text
        assert current.json()["status"] == "searching"
        assert current.json()["cancelled_at"] is None

        active = ws_client.get(f"{RIDES}/me/active", headers=_headers(rider_token))
        assert active.status_code == 200, active.text
        assert active.json()["id"] == ride_id


def test_driver_going_offline_withdraws_offer_and_prevents_accept(
    ws_client: TestClient,
):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    ride_id = ride["id"]

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride_id}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
        offer = ws_client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": False, "price": "30.00", "eta_min": 8},
            headers=_headers(driver_token),
        )
        assert offer.status_code == 201, offer.text
        assert rider_ws.receive_json()["type"] == "offer_created"

        with _websocket_connect(
            ws_client, f"/api/v1/ws/driver?token={driver_token}"
        ) as driver_ws:
            _receive_driver_handshake(driver_ws)

            offline = ws_client.post(
                "/api/v1/drivers/me/online",
                json={"is_online": False},
                headers=_headers(driver_token),
            )
            assert offline.status_code == 200, offline.text
            assert offline.json()["is_online"] is False

            withdrawn = rider_ws.receive_json()
            assert withdrawn["type"] == "offer_withdrawn"
            assert withdrawn["data"]["offer_id"] == offer.json()["id"]
            assert withdrawn["data"]["reason"] == "driver_offline"

            driver_event = driver_ws.receive_json()
            assert driver_event["type"] == "offers_withdrawn"
            assert driver_event["data"]["ride_ids"] == [ride_id]
            assert driver_event["data"]["offers"] == [
                {"ride_id": ride_id, "offer_id": offer.json()["id"]}
            ]
            assert driver_event["data"]["reason"] == "driver_offline"

        offers = ws_client.get(f"{RIDES}/{ride_id}/offers", headers=_headers(rider_token))
        assert offers.status_code == 200, offers.text
        assert offers.json() == []

        accepted = ws_client.post(
            f"{RIDES}/offers/{offer.json()['id']}/accept",
            headers=_headers(rider_token),
        )
        assert accepted.status_code == 409, accepted.text
        current = ws_client.get(f"{RIDES}/{ride_id}", headers=_headers(rider_token))
        assert current.status_code == 200, current.text
        assert current.json()["status"] == "searching"
        assert current.json()["driver"] is None


def test_accept_revalidates_driver_offline_in_database(ws_client: TestClient):
    """The atomic defense does not depend on the offline cleanup having finished."""
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": False, "price": "30.00"},
        headers=_headers(driver_token),
    )
    assert offer.status_code == 201, offer.text

    async def mark_offline_without_offer_cleanup() -> None:
        async with ws_client.factory() as session:  # type: ignore[attr-defined]
            users = SqlAlchemyUserRepository(session)
            driver = await SqlAlchemyPhoneAccountRepository(session).find_by_phone(
                phone_for("driver")
            )
            assert driver is not None
            await users.set_online(driver.id, False)

    ws_client.portal.call(mark_offline_without_offer_cleanup)
    accepted = ws_client.post(
        f"{RIDES}/offers/{offer.json()['id']}/accept",
        headers=_headers(rider_token),
    )
    assert accepted.status_code == 409, accepted.text
    current = ws_client.get(f"{RIDES}/{ride['id']}", headers=_headers(rider_token))
    assert current.json()["status"] == "searching"
    assert current.json()["driver"] is None


def test_driver_cannot_go_offline_during_active_ride(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    ).json()
    accepted = ws_client.post(
        f"{RIDES}/offers/{offer['id']}/accept",
        headers=_headers(rider_token),
    )
    assert accepted.status_code == 200, accepted.text

    offline = ws_client.post(
        "/api/v1/drivers/me/online",
        json={"is_online": False},
        headers=_headers(driver_token),
    )
    assert offline.status_code == 409, offline.text
    me = ws_client.get("/api/v1/auth/me", headers=_headers(driver_token))
    assert me.status_code == 200, me.text
    assert me.json()["is_online"] is True


def test_passenger_notified_when_driver_withdraws_offer(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    ).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}") as ws:
        assert ws.receive_json()["type"] == "offers_snapshot"

        withdrawn = ws_client.post(
            f"{RIDES}/offers/{offer['id']}/withdraw", headers=_headers(driver_token)
        )
        assert withdrawn.status_code == 204, withdrawn.text

        event = ws.receive_json()
        assert event["type"] == "offer_withdrawn"
        assert event["data"]["offer_id"] == offer["id"]


def test_driver_receives_open_ride_event_when_passenger_connects(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, _ = _receive_driver_handshake(ws)

        # Creating the request over HTTP does NOT publish it to the pool; it appears when the
        # passenger opens their connection (presence).
        ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
        with _websocket_connect(
            ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            event = ws.receive_json()
            assert event["type"] == "ride_created"
            assert event["data"]["service_type"] == "taxi"
            # The event already carries the passenger's data (not only in the snapshot).
            assert event["data"]["rider"]["full_name"] == "rider"
            assert event["data"]["rider"]["trips_completed"] == 0


def test_fare_update_republishes_canonical_payload_to_both_roles(
    ws_client: TestClient,
):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    with _websocket_connect(
        ws_client,
        f"/api/v1/ws/driver?token={driver_token}",
    ) as driver_ws:
        _receive_driver_handshake(driver_ws)
        ride = ws_client.post(
            RIDES,
            json=_ride_payload(),
            headers=_headers(rider_token),
        ).json()
        with _websocket_connect(
            ws_client,
            f"/api/v1/ws/rides/{ride['id']}?token={rider_token}",
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            assert driver_ws.receive_json()["type"] == "ride_created"

            updated = ws_client.patch(
                f"{RIDES}/{ride['id']}/fare",
                json={"fare": "30.00"},
                headers=_headers(rider_token),
            )
            assert updated.status_code == 200, updated.text

            rider_event = rider_ws.receive_json()
            driver_event = driver_ws.receive_json()
            assert rider_event["type"] == "ride_status"
            assert rider_event["data"]["fare"] == "30.00"
            assert driver_event["type"] == "ride_created"
            assert driver_event["data"]["fare"] == "30.00"
            assert driver_event["data"]["pool_version"] == 2


def test_edit_reopens_ride_in_new_service_pool(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    with _websocket_connect(
        ws_client,
        f"/api/v1/ws/driver?token={driver_token}",
    ) as driver_ws:
        _receive_driver_handshake(driver_ws)
        ride = ws_client.post(
            RIDES,
            json=_ride_payload(),
            headers=_headers(rider_token),
        ).json()
        with _websocket_connect(
            ws_client,
            f"/api/v1/ws/rides/{ride['id']}?token={rider_token}",
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            assert driver_ws.receive_json()["type"] == "ride_created"

            paused = ws_client.post(
                f"{RIDES}/{ride['id']}/pause-edit",
                headers=_headers(rider_token),
            )
            assert paused.status_code == 200, paused.text
            assert driver_ws.receive_json() == {
                "type": "ride_closed",
                "data": {
                    "ride_id": ride["id"],
                    "pool_version": 1,
                    "reason": "paused",
                },
            }

            edited = ws_client.patch(
                f"{RIDES}/{ride['id']}",
                json=_ride_payload("delivery"),
                headers=_headers(rider_token),
            )
            assert edited.status_code == 200, edited.text

            rider_event = rider_ws.receive_json()
            driver_event = driver_ws.receive_json()
            assert rider_event["type"] == "ride_status"
            assert rider_event["data"]["paused"] is False
            assert rider_event["data"]["service_type"] == "delivery"
            assert driver_event["type"] == "ride_created"
            assert driver_event["data"]["service_type"] == "delivery"
            assert driver_event["data"]["pool_version"] == 2


@pytest.mark.parametrize("vehicle", [VehicleType.TAXI, VehicleType.MOTO])
def test_taxi_and_moto_driver_sockets_receive_delivery_pool(
    ws_client: TestClient,
    vehicle: VehicleType,
):
    rider_token = _register(ws_client, f"delivery-rider-{vehicle.value}")
    driver_email = f"delivery-driver-{vehicle.value}"
    driver_token = _register(ws_client, driver_email)
    _promote_driver(ws_client, driver_email, vehicle)

    with _websocket_connect(
        ws_client, f"/api/v1/ws/driver?token={driver_token}"
    ) as driver_ws:
        snapshot, _ = _receive_driver_handshake(driver_ws)
        assert snapshot["data"] == {"items": [], "next_cursor": None}

        ride = ws_client.post(
            RIDES,
            json=_ride_payload("delivery"),
            headers=_headers(rider_token),
        ).json()
        with _websocket_connect(
            ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            event = driver_ws.receive_json()
            assert event["type"] == "ride_created"
            assert event["data"]["id"] == ride["id"]
            assert event["data"]["service_type"] == "delivery"


def test_open_rides_endpoint_includes_rider(ws_client: TestClient):
    """GET /rides/open returns the passenger's data when they are present."""
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

        resp = ws_client.get(RIDES + "/open", headers=_headers(driver_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["next_cursor"] is None
        assert len(data["items"]) == 1
        assert data["items"][0]["id"] == ride["id"]
        assert data["items"][0]["rider"]["full_name"] == "rider"
        assert data["items"][0]["rider"]["trips_completed"] == 0


def test_open_ride_visible_during_grace_after_disconnect(ws_client: TestClient):
    # After disconnecting (minimizing), the request stays present during the
    # grace window: a driver who joins still sees it.
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
    # The passenger already disconnected, but we are still within the grace period (30 s).

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, _ = _receive_driver_handshake(ws)
        assert any(r["id"] == ride["id"] for r in snapshot["data"]["items"])


def test_open_ride_hidden_after_grace_when_passenger_gone(ws_client: TestClient, monkeypatch):
    # If the passenger does not return within the grace period (app closed), it is hidden.
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.0)

    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
    # Grace 0 → on disconnect, it stops being present immediately.
    _wait_for_ride_status(ws_client, ride["id"], rider_token, "cancelled")

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, _ = _receive_driver_handshake(ws)
        assert all(r["id"] != ride["id"] for r in snapshot["data"]["items"])


def test_ride_cancelled_after_grace_when_passenger_gone(ws_client: TestClient, monkeypatch):
    """Closing the app ends the search, it does not just hide it from the pool."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.01)
    rider_token = _register(ws_client, "rider")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

    cancelled = _wait_for_ride_status(ws_client, ride["id"], rider_token, "cancelled")
    assert cancelled["paused"] is False


def test_ride_not_cancelled_if_passenger_reconnects_within_grace(
    ws_client: TestClient, monkeypatch
):
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.05)
    rider_token = _register(ws_client, "rider")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    url = f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"

    with _websocket_connect(ws_client, url) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

    with _websocket_connect(ws_client, url) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
        time.sleep(0.1)
        active = ws_client.get(f"{RIDES}/{ride['id']}", headers=_headers(rider_token))
        assert active.status_code == 200, active.text
        assert active.json()["status"] == "searching"


def test_active_ride_polling_renews_presence_when_websocket_is_reconnecting(
    ws_client: TestClient, monkeypatch
):
    """Active HTTP avoids a false abandonment when only the WebSocket channel dropped."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.08)
    rider_token = _register(ws_client, "rider")
    headers = _headers(rider_token)
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=headers).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

    # It renews before the original window. Then we wait longer than that
    # window since the disconnection, but less than the new one since the heartbeat.
    time.sleep(0.05)
    active = ws_client.get(f"{RIDES}/me/active", headers=headers)
    assert active.status_code == 200, active.text
    assert active.json()["id"] == ride["id"]
    time.sleep(0.05)

    still_searching = ws_client.get(f"{RIDES}/{ride['id']}", headers=headers)
    assert still_searching.status_code == 200, still_searching.text
    assert still_searching.json()["status"] == "searching"

    # With no more WS or polling, the search does end when the new window runs out.
    cancelled = _wait_for_ride_status(
        ws_client,
        ride["id"],
        rider_token,
        "cancelled",
    )
    assert cancelled["cancelled_at"] is not None


def test_disconnect_revalidates_ride_unpaused_after_paused_handshake(
    ws_client: TestClient, monkeypatch
):
    """The paused state read when opening the WS does not decide the later close."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.01)
    rider_token = _register(ws_client, "rider")
    headers = _headers(rider_token)
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=headers).json()
    paused = ws_client.post(f"{RIDES}/{ride['id']}/pause-edit", headers=headers)
    assert paused.status_code == 200, paused.text
    assert paused.json()["paused"] is True

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
        edited = ws_client.patch(
            f"{RIDES}/{ride['id']}",
            json=_ride_payload(),
            headers=headers,
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["paused"] is False

    cancelled = _wait_for_ride_status(ws_client, ride["id"], rider_token, "cancelled")
    assert cancelled["paused"] is False


def test_auto_cancel_rejects_all_pending_offers_in_same_close(
    ws_client: TestClient, monkeypatch
):
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.01)
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")
    ride = ws_client.post(
        RIDES,
        json=_ride_payload(),
        headers=_headers(rider_token),
    ).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    )
    assert offer.status_code == 201, offer.text

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

    _wait_for_ride_status(ws_client, ride["id"], rider_token, "cancelled")

    async def offer_statuses() -> list[OfferStatus]:
        async with ws_client.factory() as session:  # type: ignore[attr-defined]
            offers = SqlAlchemyOfferRepository(session)
            return [
                item.status
                for item in await offers.list_by_ride(uuid.UUID(ride["id"]))
            ]

    statuses = ws_client.portal.call(offer_statuses)
    assert statuses
    assert OfferStatus.PENDING not in statuses
    assert statuses == [OfferStatus.REJECTED]


def test_auto_cancel_does_not_touch_accepted_ride(ws_client: TestClient, monkeypatch):
    """An accept that wins during the grace period keeps the assignment."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.2)
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    ).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

    accepted = ws_client.post(f"{RIDES}/offers/{offer['id']}/accept", headers=_headers(rider_token))
    assert accepted.status_code == 200, accepted.text
    time.sleep(0.25)
    still_accepted = ws_client.get(f"{RIDES}/{ride['id']}", headers=_headers(rider_token))
    assert still_accepted.status_code == 200, still_accepted.text
    assert still_accepted.json()["status"] == "accepted"


def test_auto_cancel_does_not_touch_paused_ride(ws_client: TestClient, monkeypatch):
    """Modifying a request is not treated as the passenger abandoning it."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.01)
    rider_token = _register(ws_client, "rider")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
        paused = ws_client.post(f"{RIDES}/{ride['id']}/pause-edit", headers=_headers(rider_token))
        assert paused.status_code == 200, paused.text
        assert paused.json()["paused"] is True

    time.sleep(0.05)
    still_paused = ws_client.get(f"{RIDES}/{ride['id']}", headers=_headers(rider_token))
    assert still_paused.status_code == 200, still_paused.text
    assert still_paused.json()["status"] == "searching"
    assert still_paused.json()["paused"] is True


def test_open_rides_snapshot_excludes_absent_passenger(ws_client: TestClient):
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    # Request created but the passenger is NOT connected: it must not appear.
    ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token))

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, offers = _receive_driver_handshake(ws)
        assert snapshot["data"] == {"items": [], "next_cursor": None}
        assert offers["data"] == []


def test_driver_notified_when_passenger_cancels(ws_client: TestClient):
    """When the passenger cancels, the driver with a live offer receives offer_rejected
    with reason ``ride_cancelled`` (not ``ride_taken`` nor a silent disappearance).
    """
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)

        # The passenger opens their connection (presence) and the driver offers.
        with _websocket_connect(
            ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            ws_client.post(
                f"{RIDES}/{ride['id']}/offers",
                json={"accept_at_fare": True},
                headers=_headers(driver_token),
            )

        # The passenger cancels → the driver receives ride_closed (pool) and
        # offer_rejected (personal, reason ride_cancelled). (There is also an earlier
        # ride_created queued when the passenger opened their connection.)
        cancelled = ws_client.post(
            f"{RIDES}/{ride['id']}/cancel",
            headers=_headers(rider_token),
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancelled"
        received = [ws.receive_json() for _ in range(3)]
        assert [event["type"] for event in received] == [
            "ride_created",
            "ride_closed",
            "offer_rejected",
        ]
        assert received[1]["data"] == {
            "ride_id": ride["id"],
            "pool_version": 1,
            "reason": "terminal",
        }
        rejected = received[2]
        assert rejected["data"]["ride_id"] == ride["id"]
        assert rejected["data"]["offer_id"] is not None
        assert rejected["data"]["reason"] == "ride_cancelled"


def test_driver_receives_ride_paused_on_pause_edit(ws_client: TestClient):
    """When pausing to edit, the driver with an offer receives ``ride_paused`` with the
    full ride payload (to keep the card visible in the "modifying"
    state during the edit) — instead of the old ``offer_rejected(ride_paused)``
    which, together with the pool's ``ride_closed``, made the card disappear (timing
    bug: the banner showed up after saving, not during).
    """
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)

        # The passenger opens presence and the driver offers.
        with _websocket_connect(
            ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            offer = ws_client.post(
                f"{RIDES}/{ride['id']}/offers",
                json={"accept_at_fare": True},
                headers=_headers(driver_token),
            ).json()
            assert rider_ws.receive_json()["type"] == "offer_created"

            paused_response = ws_client.post(
                f"{RIDES}/{ride['id']}/pause-edit",
                headers=_headers(rider_token),
            )
            assert paused_response.status_code == 200, paused_response.text
            withdrawn = rider_ws.receive_json()
            assert withdrawn["type"] == "offer_withdrawn"
            assert withdrawn["data"]["offer_id"] == offer["id"]

        # There was an earlier ride_created in the pool. Then the functional order
        # requires closing the card and immediately reinserting it as paused.
        driver_events = [ws.receive_json() for _ in range(3)]
        assert [event["type"] for event in driver_events] == [
            "ride_created",
            "ride_closed",
            "ride_paused",
        ]
        assert driver_events[1]["data"] == {
            "ride_id": ride["id"],
            "pool_version": 1,
            "reason": "paused",
        }
        paused = driver_events[2]
        assert paused["data"]["id"] == ride["id"]
        assert paused["data"]["offer_id"] == offer["id"]
        # offer_rejected with reason ride_paused must no longer arrive (replaced event).
        assert not any(
            e.get("type") == "offer_rejected" and e.get("data", {}).get("reason") == "ride_paused"
            for e in driver_events
        )


def test_driver_recovers_active_ride_on_reconnect(ws_client: TestClient):
    """If the driver's WS was down when they were chosen, on reconnect
    they recover the active ride (``driver_active_ride`` snapshot).
    """
    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    ).json()

    # The passenger accepts while the driver is not connected (simulates a WS drop).
    accepted = ws_client.post(f"{RIDES}/offers/{offer['id']}/accept", headers=_headers(rider_token))
    assert accepted.status_code == 200, accepted.text

    # On reconnect, the driver recovers their active ride.
    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)
        active = ws.receive_json()
        assert active["type"] == "driver_active_ride"
        assert active["data"]["id"] == ride["id"]
        assert active["data"]["status"] == "accepted"


def test_passenger_receives_offer_expired(ws_client: TestClient, monkeypatch):
    """When an offer expires (30 s without an answer), the passenger receives ``offer_expired``
    live to remove the card — it does not depend on polling ``/offers`` again.

    Covers the ``publish_offer_expired`` fix, which now also emits to the
    ``ride_topic`` (before, only to the driver's channel).
    """
    import uuid as _uuid
    from datetime import timedelta

    from app.api.deps import build_expire_offer
    from app.api.v1 import events
    from app.domain import ride_policy
    from app.infrastructure.config import get_settings

    # We force the expiry without waiting the real 30 s.
    monkeypatch.setattr(ride_policy, "OFFER_TTL", timedelta(seconds=0))

    rider_token = _register(ws_client, "rider")
    driver_token = _register(ws_client, "driver")
    _promote_driver(ws_client, "driver")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}") as ws:
        assert ws.receive_json()["type"] == "offers_snapshot"

        offer = ws_client.post(
            f"{RIDES}/{ride['id']}/offers",
            json={"accept_at_fare": True},
            headers=_headers(driver_token),
        ).json()
        assert ws.receive_json()["type"] == "offer_created"

        async def expire() -> None:
            async with ws_client.factory() as session:  # type: ignore[attr-defined]
                offer_entity = await build_expire_offer(
                    session,
                    get_settings(),
                ).execute(_uuid.UUID(offer["id"]))
            assert offer_entity is not None
            await events.publish_offer_expired(offer_entity)

        ws_client.portal.call(expire)

        event = ws.receive_json()
        assert event["type"] == "offer_expired"
        assert event["data"]["offer_id"] == offer["id"]
        assert event["data"]["ride_id"] == ride["id"]
        assert event["data"]["reason"] == "expired"
