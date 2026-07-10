"""Test e2e del ciclo Modificar solicitud: pausar, editar y re-publicar."""

from __future__ import annotations

from app.domain.entities import ServiceType, UserRole
from app.infrastructure.db.repositories import SqlAlchemyUserRepository

REGISTER = "/api/v1/auth/register"
RIDES = "/api/v1/rides"


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
        user.is_online = True
        await users.update(user)


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
    _, rider_token = await _register(client, "rider@example.com")
    _, drv_token = await _register(client, "driver@example.com")
    await _promote_to_driver(session_factory, "driver@example.com", ServiceType.TAXI)
    rider_h, drv_h = _headers(rider_token), _headers(drv_token)

    ride_id = (await client.post(RIDES, json=_ride_payload(), headers=rider_h)).json()["id"]

    # Un conductor oferta sobre la solicitud.
    offer = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=drv_h,
    )
    assert offer.status_code == 201

    # Pausar para editar: la solicitud sigue searching pero se oculta del pool.
    paused = await client.post(f"{RIDES}/{ride_id}/pause-edit", headers=rider_h)
    assert paused.status_code == 200
    assert paused.json()["status"] == "searching"

    # Las ofertas vivas se retiraron: el pasajero ya no ve ninguna.
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

    # Tras editar, un conductor puede ofertar de nuevo sobre la solicitud actualizada.
    offer_again = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=drv_h,
    )
    assert offer_again.status_code == 201
    assert offer_again.json()["price"] == "35.00"

    # Y el pasajero puede aceptar (asignación directa).
    offer_id = offer_again.json()["id"]
    accepted = await client.post(f"{RIDES}/offers/{offer_id}/accept", headers=rider_h)
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"


async def test_edit_without_pause_rejected(client, session_factory):
    _, rider_token = await _register(client, "rider2@example.com")
    rider_h = _headers(rider_token)
    ride_id = (await client.post(RIDES, json=_ride_payload(), headers=rider_h)).json()["id"]

    # No se puede editar sin pausar primero.
    edited = await client.patch(
        f"{RIDES}/{ride_id}",
        json=_ride_payload(fare="35.00"),
        headers=rider_h,
    )
    assert edited.status_code == 409
