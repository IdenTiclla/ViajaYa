"""Test e2e del canal WebSocket de negociación (snapshot + eventos + auth).

Usa el ``TestClient`` síncrono de Starlette (soporta ``websocket_connect``). La
preparación de la BD en memoria y la promoción de conductores corren en el mismo
event loop del cliente mediante ``client.portal``.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.deps import get_session_factory
from app.domain.entities import ServiceType, UserRole
from app.infrastructure.db.base import Base
from app.infrastructure.db.repositories import SqlAlchemyUserRepository
from app.infrastructure.db.session import get_session
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


@pytest.fixture
def ws_client():
    """TestClient con BD SQLite en memoria compartida por HTTP y WebSocket."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        future=True,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
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
def _reset_presence():
    """Limpia el estado de presencia (proceso-global) entre tests."""
    from app.api.v1 import presence

    presence._last_seen.clear()
    yield
    presence._last_seen.clear()


def _promote_driver(client: TestClient, email: str) -> None:
    async def promote() -> None:
        async with client.factory() as session:  # type: ignore[attr-defined]
            users = SqlAlchemyUserRepository(session)
            user = await users.get_by_email(email)
            assert user is not None
            user.role = UserRole.DRIVER
            user.vehicle_type = ServiceType.TAXI
            await users.update(user)

    client.portal.call(promote)


def test_passenger_receives_snapshot_and_live_offer(ws_client: TestClient):
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
    ride_id = ride["id"]

    url = f"/api/v1/ws/rides/{ride_id}?token={rider_token}"
    with ws_client.websocket_connect(url) as ws:
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
        with ws_client.websocket_connect(url) as ws:
            ws.receive_json()


def test_foreign_user_cannot_subscribe_to_ride(ws_client: TestClient):
    rider_token = _register(ws_client, "rider@x.com")
    intruder_token = _register(ws_client, "intruder@x.com")
    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    url = f"/api/v1/ws/rides/{ride['id']}?token={intruder_token}"
    with pytest.raises(WebSocketDisconnect):
        with ws_client.websocket_connect(url) as ws:
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

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        assert ws.receive_json()["type"] == "open_rides_snapshot"

        rejected = ws_client.post(
            f"{RIDES}/offers/{offer['id']}/reject", headers=_headers(rider_token)
        )
        assert rejected.status_code == 204, rejected.text

        event = ws.receive_json()
        assert event["type"] == "offer_rejected"
        assert event["data"]["offer_id"] == offer["id"]
        assert event["data"]["ride_id"] == ride["id"]


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

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        assert ws.receive_json()["type"] == "open_rides_snapshot"

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

    with ws_client.websocket_connect(
        f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as ws:
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

    with ws_client.websocket_connect(
        f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as ws:
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

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "open_rides_snapshot"

        # Crear la solicitud por HTTP NO la publica al pool; aparece cuando el
        # pasajero abre su conexión (presencia).
        ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()
        with ws_client.websocket_connect(
            f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
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

    with ws_client.websocket_connect(
        f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
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

    with ws_client.websocket_connect(
        f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
    # El pasajero ya se desconectó, pero seguimos dentro de la gracia (120 s).

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "open_rides_snapshot"
        assert any(r["id"] == ride["id"] for r in snapshot["data"])


def test_open_ride_hidden_after_grace_when_passenger_gone(ws_client: TestClient, monkeypatch):
    # Si el pasajero no vuelve dentro de la gracia (app cerrada), deja de verse.
    from app.api.v1 import presence

    monkeypatch.setattr(presence, "PRESENCE_GRACE_SECONDS", 0.0)

    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with ws_client.websocket_connect(
        f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as rider_ws:
        assert rider_ws.receive_json()["type"] == "offers_snapshot"
    # Gracia 0 → al desconectar, deja de estar presente de inmediato.

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "open_rides_snapshot"
        assert all(r["id"] != ride["id"] for r in snapshot["data"])


def test_open_rides_snapshot_excludes_absent_passenger(ws_client: TestClient):
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    # Solicitud creada pero el pasajero NO está conectado: no debe aparecer.
    ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token))

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "open_rides_snapshot"
        assert snapshot["data"] == []


def test_driver_notified_when_passenger_cancels(ws_client: TestClient):
    """Al cancelar el pasajero, el conductor con oferta viva recibe offer_rejected
    con razón ``ride_cancelled`` (no ``ride_taken`` ni desaparición muda)."""
    rider_token = _register(ws_client, "rider@x.com")
    driver_token = _register(ws_client, "driver@x.com")
    _promote_driver(ws_client, "driver@x.com")

    ride = ws_client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token)).json()

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        assert ws.receive_json()["type"] == "open_rides_snapshot"

        # El pasajero abre su conexión (presencia) y el conductor ofrece.
        with ws_client.websocket_connect(
            f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
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

    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        assert ws.receive_json()["type"] == "open_rides_snapshot"

        # El pasajero abre presencia y el conductor oferta.
        with ws_client.websocket_connect(
            f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
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
            e.get("type") == "offer_rejected"
            and e.get("data", {}).get("reason") == "ride_paused"
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
    accepted = ws_client.post(
        f"{RIDES}/offers/{offer['id']}/accept", headers=_headers(rider_token)
    )
    assert accepted.status_code == 200, accepted.text

    # Al reconectar, el conductor recupera su viaje activo.
    with ws_client.websocket_connect(f"/api/v1/ws/driver?token={driver_token}") as ws:
        assert ws.receive_json()["type"] == "open_rides_snapshot"
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

    with ws_client.websocket_connect(
        f"/api/v1/ws/rides/{ride['id']}?token={rider_token}"
    ) as ws:
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
                offer_entity = await ExpireOffer(offers_repo).execute(
                    _uuid.UUID(offer["id"])
                )
            assert offer_entity is not None
            await events.publish_offer_expired(offer_entity)

        ws_client.portal.call(expire)

        event = ws.receive_json()
        assert event["type"] == "offer_expired"
        assert event["data"]["offer_id"] == offer["id"]
        assert event["data"]["ride_id"] == ride["id"]
        assert event["data"]["reason"] == "expired"
