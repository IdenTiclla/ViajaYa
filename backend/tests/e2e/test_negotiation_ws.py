"""Test e2e del canal WebSocket de negociación (snapshot + eventos + auth).

Usa el ``TestClient`` síncrono de Starlette (soporta ``websocket_connect``). La
preparación de la BD y la promoción de conductores corren en el mismo
event loop del cliente mediante ``client.portal``.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.deps import get_session_factory
from app.domain.entities import OfferStatus, ServiceType, UserRole
from app.infrastructure.db.base import Base
from app.infrastructure.db.models import OfferModel
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.session import get_session
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from app.main import create_app

REGISTER = "/api/v1/auth/register"
RIDES = "/api/v1/rides"


def _ride_payload() -> dict:
    return {
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


def _register(client: TestClient, email: str) -> str:
    resp = client.post(
        REGISTER,
        json={"full_name": email.split("@")[0], "email": email, "password": "secret123"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["tokens"]["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _websocket_connect(client: TestClient, url: str):
    """Convierte las URLs historicas del test al handshake seguro por protocolo."""
    parsed = urlsplit(url)
    token = parse_qs(parsed.query).get("token", [None])[0]
    subprotocols = [AUTH_SUBPROTOCOL, token] if token else None
    return client.websocket_connect(parsed.path, subprotocols=subprotocols)


def _receive_driver_handshake(ws) -> tuple[dict, dict]:
    """Consume el handshake autoritativo del conductor en su orden contractual."""
    open_rides = ws.receive_json()
    assert open_rides["type"] == "open_rides_snapshot"
    offers = ws.receive_json()
    assert offers["type"] == "driver_offers_snapshot"
    return open_rides, offers


@pytest.fixture
def ws_client(tmp_path):
    """TestClient con SQLite por archivo para permitir sesiones concurrentes."""
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'negotiation.db'}",
        future=True,
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_session():
        async with factory() as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_session_factory] = lambda: factory

    async def create_tables() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    with TestClient(app) as client:
        client.portal.call(create_tables)
        client.factory = factory  # type: ignore[attr-defined]
        try:
            yield client
        finally:
            client.portal.call(engine.dispose)


@pytest.fixture(autouse=True)
def _reset_presence(ws_client: TestClient):
    """Cancela tareas y limpia la presencia global entre tests."""
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


def _promote_driver(client: TestClient, email: str) -> None:
    async def promote() -> None:
        async with client.factory() as session:  # type: ignore[attr-defined]
            users = SqlAlchemyUserRepository(session)
            user = await users.get_by_email(email)
            assert user is not None
            user.role = UserRole.DRIVER
            user.vehicle_type = ServiceType.TAXI
            user.is_online = True
            await users.update(user)

    client.portal.call(promote)


def _wait_for_ride_status(
    client: TestClient,
    ride_id: str,
    token: str,
    expected: str,
    *,
    timeout: float = 1.0,
) -> dict:
    """Espera la convergencia de una tarea de presencia sin sleeps frágiles."""
    from app.api.v1 import presence

    # SQLite no modela el acceso concurrente de Postgres; dejamos terminar la
    # transacción de presencia antes de consultar con otra sesión del fixture.
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
                f"El viaje {ride_id} no llegó a {expected}; estado actual: {ride['status']}"
            )
        time.sleep(0.01)


def test_passenger_receives_snapshot_and_live_offer(ws_client: TestClient):
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    ride_id = ride["id"]

    url = f"/api/v1/ws/rides/{ride_id}?token={rider_token}"
    with _websocket_connect(ws_client, url) as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "offers_snapshot"
        assert snapshot["data"] == []

        # El conductor oferta por HTTP → el pasajero lo recibe en vivo.
        offer = ws_client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": True, "eta_min": 4},
            headers=_headers(driver_token),
        )
        assert offer.status_code == 201, offer.text
        event = ws.receive_json()
        assert event["type"] == "offer_created"
        assert event["data"]["ride_id"] == ride_id

        # Al aceptar, el pasajero recibe el viaje asignado (decisión final):
        # el evento ride_status llega con status=accepted.
        offer_id = offer.json()["id"]
        accepted = ws_client.post(
            f"{RIDES}/offers/{offer_id}/accept", headers=_headers(rider_token)
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["status"] == "accepted"
        status_event = ws.receive_json()
        assert status_event["type"] == "ride_status"
        assert status_event["data"]["status"] == "accepted"


def test_invalid_token_closes_socket(ws_client: TestClient):
    rider_token = _register(ws_client, "rider@x.com")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    url = f"/api/v1/ws/rides/{ride['id']}?token=basura"
    with pytest.raises(WebSocketDisconnect):
        with _websocket_connect(ws_client, url) as ws:
            ws.receive_json()


def test_foreign_user_cannot_subscribe_to_ride(ws_client: TestClient):
    rider_token = _register(ws_client, "rider@x.com")
    intruder_token = _register(ws_client, "intruder@x.com")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    url = f"/api/v1/ws/rides/{ride['id']}?token={intruder_token}"
    with pytest.raises(WebSocketDisconnect):
        with _websocket_connect(ws_client, url) as ws:
            ws.receive_json()


def test_driver_notified_when_passenger_rejects_offer(ws_client: TestClient):
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

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
    rider_a_token = _register(ws_client, "rider-a@x.com")
    rider_b_token = _register(ws_client, "rider-b@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")
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
    """Al aceptar el pasajero, el conductor recibe offer_accepted (va a navegar)."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

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

        # ride_closed (pool), offer_accepted y offers_withdrawn (canal personal)
        # llegan al conductor; el que importa es offer_accepted.
        types = {ws.receive_json()["type"] for _ in range(3)}
        assert "offer_accepted" in types


def test_passenger_sees_improved_offer_replace_old_one(ws_client: TestClient):
    """Cuando el conductor mejora su oferta, la vieja se retira y llega la nueva."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

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
        # La mejora se distingue de un retiro real: el cliente no muestra toast.
        assert withdrawn["data"]["reason"] == "superseded"

        created = ws.receive_json()
        assert created["type"] == "offer_created"
        assert created["data"]["price"] == "26.00"


def test_live_passenger_ws_keeps_custom_offer_negotiation_active_past_grace(
    ws_client: TestClient, monkeypatch
):
    """Una contraoferta no puede cerrar una busqueda con el pasajero conectado."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.03)
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

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

        # Esperar mas que la gracia comprimida equivale a mantener la pantalla
        # abierta por encima de los 30 s reales.
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
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")
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
    """La defensa atómica no depende de que la limpieza offline haya terminado."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")
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
            driver = await users.get_by_email("driver@x.com")
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
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")
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
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

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
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, _ = _receive_driver_handshake(ws)

        # Crear la solicitud por HTTP NO la publica al pool; aparece cuando el
        # pasajero abre su conexión (presencia).
        ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
        with _websocket_connect(
            ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            event = ws.receive_json()
            assert event["type"] == "ride_created"
            assert event["data"]["service_type"] == "taxi"
            # El evento llega ya con los datos del pasajero (no solo en el snapshot).
            assert event["data"]["rider"]["full_name"] == "rider"
            assert event["data"]["rider"]["trips_completed"] == 0


def test_open_rides_endpoint_includes_rider(ws_client: TestClient):
    """GET /rides/open trae los datos del pasajero cuando este está presente."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

        resp = ws_client.get(RIDES + "/open", headers=_headers(driver_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == ride["id"]
        assert data[0]["rider"]["full_name"] == "rider"
        assert data[0]["rider"]["trips_completed"] == 0


def test_open_ride_visible_during_grace_after_disconnect(ws_client: TestClient):
    # Tras desconectarse (minimizar), la solicitud sigue presente durante la
    # ventana de gracia: un conductor que entra todavía la ve.
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
    # El pasajero ya se desconectó, pero seguimos dentro de la gracia (30 s).

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, _ = _receive_driver_handshake(ws)
        assert any(r["id"] == ride["id"] for r in snapshot["data"])


def test_open_ride_hidden_after_grace_when_passenger_gone(ws_client: TestClient, monkeypatch):
    # Si el pasajero no vuelve dentro de la gracia (app cerrada), deja de verse.
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.0)

    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
    # Gracia 0 → al desconectar, deja de estar presente de inmediato.
    _wait_for_ride_status(ws_client, ride["id"], rider_token, "cancelled")

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, _ = _receive_driver_handshake(ws)
        assert all(r["id"] != ride["id"] for r in snapshot["data"])


def test_ride_cancelled_after_grace_when_passenger_gone(ws_client: TestClient, monkeypatch):
    """Cerrar la app termina la búsqueda, no solo la oculta del pool."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.01)
    rider_token = _register(ws_client, "rider@x.com")
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
    rider_token = _register(ws_client, "rider@x.com")
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
    """HTTP activo evita un falso abandono si solo se cayó el canal WebSocket."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.08)
    rider_token = _register(ws_client, "rider@x.com")
    headers = _headers(rider_token)
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=headers).json()

    with _websocket_connect(
        ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"

    # Renueva antes de la ventana original. Después esperamos más que aquella
    # ventana desde la desconexión, pero menos que la nueva desde el heartbeat.
    time.sleep(0.05)
    active = ws_client.get(f"{RIDES}/me/active", headers=headers)
    assert active.status_code == 200, active.text
    assert active.json()["id"] == ride["id"]
    time.sleep(0.05)

    still_searching = ws_client.get(f"{RIDES}/{ride['id']}", headers=headers)
    assert still_searching.status_code == 200, still_searching.text
    assert still_searching.json()["status"] == "searching"

    # Sin más WS ni polling, la búsqueda sí termina al vencer la nueva ventana.
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
    """El estado pausado leído al abrir el WS no decide el cierre posterior."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.01)
    rider_token = _register(ws_client, "rider@x.com")
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
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")
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
    """Un accept que gana durante la gracia conserva la asignación."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.2)
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")
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
    """Modificar una solicitud no se interpreta como abandono del pasajero."""
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.01)
    rider_token = _register(ws_client, "rider@x.com")
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
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    # Solicitud creada pero el pasajero NO está conectado: no debe aparecer.
    ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token))

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot, offers = _receive_driver_handshake(ws)
        assert snapshot["data"] == []
        assert offers["data"] == []


def test_driver_notified_when_passenger_cancels(ws_client: TestClient):
    """Al cancelar el pasajero, el conductor con oferta viva recibe offer_rejected
    con razón ``ride_cancelled`` (no ``ride_taken`` ni desaparición muda)."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)

        # El pasajero abre su conexión (presencia) y el conductor ofrece.
        with _websocket_connect(
            ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            ws_client.post(
                f"{RIDES}/{ride['id']}/offers",
                json={"accept_at_fare": True},
                headers=_headers(driver_token),
            )

        # El pasajero cancela → al conductor le llegan ride_closed (pool) y
        # offer_rejected (personal, reason ride_cancelled). (También hay un
        # ride_created previo encolado al abrir el pasajero su conexión.)
        ws_client.post(f"{RIDES}/{ride['id']}/cancel", headers=_headers(rider_token))
        events = [ws.receive_json() for _ in range(3)]
        rejected = next(e for e in events if e["type"] == "offer_rejected")
        assert rejected["data"]["ride_id"] == ride["id"]
        assert rejected["data"]["reason"] == "ride_cancelled"


def test_driver_receives_ride_paused_on_pause_edit(ws_client: TestClient):
    """Al pausar para editar, el conductor con oferta recibe ``ride_paused`` con el
    payload completo del ride (para mantener la tarjeta visible en estado
    "modificando" durante la edición) — en vez del viejo ``offer_rejected(ride_paused)``
    que, sumado al ``ride_closed`` del pool, hacía desaparecer la tarjeta (bug de
    timing: el banner aparecía tras guardar, no durante)."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)

        # El pasajero abre presencia y el conductor oferta.
        with _websocket_connect(
            ws_client, f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
        ) as rider_ws:
            assert rider_ws.receive_json()["type"] == "offers_snapshot"
            offer = ws_client.post(
                f"{RIDES}/{ride['id']}/offers",
                json={"accept_at_fare": True},
                headers=_headers(driver_token),
            ).json()

        # El pasajero pausa para editar → al conductor le llegan ride_closed (pool)
        # y ride_paused (personal, con el ride + offer_id). (También hay un
        # ride_created previo encolado al abrir el pasajero su conexión.)
        ws_client.post(f"{RIDES}/{ride['id']}/pause-edit", headers=_headers(rider_token))
        events = [ws.receive_json() for _ in range(3)]
        paused = next(e for e in events if e["type"] == "ride_paused")
        assert paused["data"]["id"] == ride["id"]
        assert paused["data"]["offer_id"] == offer["id"]
        # Ya no debe llegar offer_rejected con razón ride_paused (evento reemplazado).
        assert not any(
            e.get("type") == "offer_rejected" and e.get("data", {}).get("reason") == "ride_paused"
            for e in events
        )


def test_driver_recovers_active_ride_on_reconnect(ws_client: TestClient):
    """Si el WS del conductor estaba caído cuando lo eligieron, al reconectar
    recupera el viaje activo (snapshot ``driver_active_ride``)."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    offer = ws_client.post(
        f"{RIDES}/{ride['id']}/offers",
        json={"accept_at_fare": True},
        headers=_headers(driver_token),
    ).json()

    # El pasajero acepta sin que el conductor esté conectado (simula caída del WS).
    accepted = ws_client.post(f"{RIDES}/offers/{offer['id']}/accept", headers=_headers(rider_token))
    assert accepted.status_code == 200, accepted.text

    # Al reconectar, el conductor recupera su viaje activo.
    with _websocket_connect(ws_client, f"/api/v1/ws/driver?token={driver_token}") as ws:
        _receive_driver_handshake(ws)
        active = ws.receive_json()
        assert active["type"] == "driver_active_ride"
        assert active["data"]["id"] == ride["id"]
        assert active["data"]["status"] == "accepted"


def test_passenger_receives_offer_expired(ws_client: TestClient, monkeypatch):
    """Al vencer una oferta (30 s sin respuesta), el pasajero recibe ``offer_expired``
    en vivo para retirar la tarjeta — no depende de volver a pollear ``/offers``.

    Cubre la corrección de ``publish_offer_expired``, que ahora emite también al
    ``ride_topic`` (antes solo al canal del conductor).
    """
    import uuid as _uuid
    from datetime import timedelta

    from app.api.v1 import events
    from app.application.use_cases.expire_offer import ExpireOffer
    from app.domain import ride_policy
    from app.infrastructure.db.repositories import SqlAlchemyOfferRepository

    # Forzamos la expiración sin esperar los 30 s reales.
    monkeypatch.setattr(ride_policy, "OFFER_TTL", timedelta(seconds=0))

    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

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
                offers_repo = SqlAlchemyOfferRepository(session)
                offer_entity = await ExpireOffer(offers_repo).execute(_uuid.UUID(offer["id"]))
            assert offer_entity is not None
            await events.publish_offer_expired(offer_entity)

        ws_client.portal.call(expire)

        event = ws.receive_json()
        assert event["type"] == "offer_expired"
        assert event["data"]["offer_id"] == offer["id"]
        assert event["data"]["ride_id"] == ride["id"]
        assert event["data"]["reason"] == "expired"
