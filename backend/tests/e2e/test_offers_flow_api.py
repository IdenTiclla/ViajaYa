"""Test e2e del flujo completo de ofertas y viaje (pasajero ↔ conductores)."""

from __future__ import annotations

import uuid

from app.domain.entities import ServiceType, UserRole
from app.infrastructure.db.repositories import SqlAlchemyUserRepository
from app.infrastructure.realtime.hub import hub, ride_topic

REGISTER = "/api/v1/auth/register"
RIDES = "/api/v1/rides"


class _FakeWS:
    """Doble de WebSocket para simular la presencia del pasajero en el pool."""

    async def send_json(self, message: dict) -> None:  # pragma: no cover - no-op
        pass


def _mark_present(ride_id: str) -> _FakeWS:
    """Marca una solicitud como "presente" (pasajero conectado) para el pool."""
    ws = _FakeWS()
    hub.subscribe(ride_topic(uuid.UUID(ride_id)), ws)
    return ws


async def _register(client, email: str) -> tuple[str, str]:
    resp = await client.post(
        REGISTER,
        json={"full_name": email.split("@")[0], "email": email, "password": "secret123"},
    )
    body = resp.json()
    return body["user"]["id"], body["tokens"]["access_token"]


async def _promote_to_driver(session_factory, email: str, vehicle: ServiceType) -> None:
    async with session_factory() as session:
        users = SqlAlchemyUserRepository(session)
        user = await users.get_by_email(email)
        assert user is not None
        user.role = UserRole.DRIVER
        user.vehicle_type = vehicle
        await users.update(user)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


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


async def test_full_ride_flow(client, session_factory):
    # --- usuarios ---
    _, rider_token = await _register(client, "rider@example.com")
    _, d1_token = await _register(client, "driver1@example.com")
    _, d2_token = await _register(client, "driver2@example.com")
    await _promote_to_driver(session_factory, "driver1@example.com", ServiceType.TAXI)
    await _promote_to_driver(session_factory, "driver2@example.com", ServiceType.TAXI)

    rider_h = _headers(rider_token)
    d1_h = _headers(d1_token)
    d2_h = _headers(d2_token)

    # --- pasajero crea el viaje ---
    resp = await client.post(RIDES, json=_ride_payload(), headers=rider_h)
    assert resp.status_code == 201
    ride_id = resp.json()["id"]
    # El pasajero "abre" su pantalla (presencia): la solicitud entra al pool.
    presence = _mark_present(ride_id)

    # --- los conductores ven la solicitud abierta ---
    open_resp = await client.get(f"{RIDES}/open", headers=d1_h)
    assert open_resp.status_code == 200
    assert any(r["id"] == ride_id for r in open_resp.json())

    # --- driver1 acepta al precio; driver2 contraoferta ---
    o1 = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True, "eta_min": 5},
        headers=d1_h,
    )
    assert o1.status_code == 201
    assert o1.json()["price"] == "25.00"
    offer1_id = o1.json()["id"]

    o2 = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": False, "price": "30.00", "eta_min": 8},
        headers=d2_h,
    )
    assert o2.status_code == 201
    assert o2.json()["price"] == "30.00"

    # --- el pasajero ve 2 ofertas pendientes ---
    offers_resp = await client.get(f"{RIDES}/{ride_id}/offers", headers=rider_h)
    assert offers_resp.status_code == 200
    assert len(offers_resp.json()) == 2

    # --- el pasajero acepta la oferta 1: le asigna el viaje (decisión final) ---
    accept1 = await client.post(f"{RIDES}/offers/{offer1_id}/accept", headers=rider_h)
    assert accept1.status_code == 200
    body = accept1.json()
    assert body["status"] == "accepted"
    assert body["driver"]["full_name"] == "driver1"
    assert body["accepted_price"] == "25.00"

    # aceptar otra oferta ya no es posible: el viaje dejó de buscar (409)
    offer2_id = o2.json()["id"]
    accept2 = await client.post(f"{RIDES}/offers/{offer2_id}/accept", headers=rider_h)
    assert accept2.status_code == 409

    # tras la asignación, ya no quedan ofertas vivas
    offers_after = await client.get(f"{RIDES}/{ride_id}/offers", headers=rider_h)
    assert offers_after.json() == []

    # --- el conductor avanza el viaje hasta completarlo ---
    for new_status in ("arriving", "in_progress", "completed"):
        patch = await client.patch(
            f"{RIDES}/{ride_id}/status", json={"status": new_status}, headers=d1_h
        )
        assert patch.status_code == 200
        assert patch.json()["status"] == new_status

    # --- el pasajero ve el viaje completado por polling ---
    final = await client.get(f"{RIDES}/{ride_id}", headers=rider_h)
    assert final.status_code == 200
    assert final.json()["status"] == "completed"

    hub.unsubscribe(ride_topic(uuid.UUID(ride_id)), presence)


async def test_driver_cannot_offer_on_other_service(client, session_factory):
    _, rider_token = await _register(client, "rider2@example.com")
    _, moto_token = await _register(client, "moto@example.com")
    await _promote_to_driver(session_factory, "moto@example.com", ServiceType.MOTO)

    resp = await client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token))
    ride_id = resp.json()["id"]

    # el conductor de moto no ve la solicitud de taxi
    open_resp = await client.get(f"{RIDES}/open", headers=_headers(moto_token))
    assert all(r["id"] != ride_id for r in open_resp.json())

    # y si intenta ofertar, recibe 403
    offer = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=_headers(moto_token),
    )
    assert offer.status_code == 403


async def test_close_flow_rating_history_earnings(client, session_factory):
    _, rider_token = await _register(client, "rider3@example.com")
    _, drv_token = await _register(client, "driver3@example.com")
    await _promote_to_driver(session_factory, "driver3@example.com", ServiceType.TAXI)
    rider_h, drv_h = _headers(rider_token), _headers(drv_token)

    # viaje completo: crear → ofertar → aceptar → confirmar → avanzar a completado
    ride_id = (await client.post(RIDES, json=_ride_payload(), headers=rider_h)).json()["id"]
    offer = await client.post(
        f"{RIDES}/{ride_id}/offers", json={"accept_at_fare": True}, headers=drv_h
    )
    offer_id = offer.json()["id"]
    await client.post(f"{RIDES}/offers/{offer_id}/accept", headers=rider_h)
    for new_status in ("arriving", "in_progress", "completed"):
        await client.patch(
            f"{RIDES}/{ride_id}/status", json={"status": new_status}, headers=drv_h
        )

    # el pasajero califica al conductor
    rate = await client.post(
        f"{RIDES}/{ride_id}/rating", json={"score": 5, "comment": "Excelente"}, headers=rider_h
    )
    assert rate.status_code == 201
    # no se puede calificar dos veces el mismo viaje
    again = await client.post(f"{RIDES}/{ride_id}/rating", json={"score": 4}, headers=rider_h)
    assert again.status_code == 409

    # el historial del pasajero lista el viaje con su calificación
    hist = await client.get(f"{RIDES}/history", params={"status": "completed"}, headers=rider_h)
    assert hist.status_code == 200
    assert any(h["id"] == ride_id and h["my_rating"] == 5 for h in hist.json())

    # las ganancias del conductor reflejan el viaje (25.00)
    earn = await client.get("/api/v1/drivers/me/earnings", headers=drv_h)
    assert earn.status_code == 200
    assert earn.json()["trips_all_time"] == 1
    assert float(earn.json()["total_all_time"]) == 25.0

    # no se puede calificar un viaje que no está completado
    other = (await client.post(RIDES, json=_ride_payload(), headers=rider_h)).json()["id"]
    bad = await client.post(f"{RIDES}/{other}/rating", json={"score": 5}, headers=rider_h)
    assert bad.status_code == 409
