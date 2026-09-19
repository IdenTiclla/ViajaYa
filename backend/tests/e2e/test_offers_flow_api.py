"""Test e2e del flujo completo de ofertas y viaje (pasajero ↔ conductores)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from app.domain.entities import Location, RideRequest, ServiceType, VehicleType
from app.infrastructure.db.repositories import SqlAlchemyRideRequestRepository
from app.infrastructure.realtime.hub import hub, ride_topic
from tests.e2e.helpers import promote_to_driver, sign_in

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


async def _register(client, label: str) -> tuple[str, str]:
    account = await sign_in(client, label)
    return account.user_id, account.token


async def _promote_to_driver(session_factory, label: str, vehicle: VehicleType) -> None:
    await promote_to_driver(session_factory, label, vehicle)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


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


async def test_dismissed_request_persists_for_driver_until_passenger_updates_it(
    client, session_factory
):
    _, rider_token = await _register(client, "dismiss-rider")
    _, first_driver_token = await _register(client, "dismiss-first")
    _, second_driver_token = await _register(client, "dismiss-second")
    await _promote_to_driver(session_factory, "dismiss-first", VehicleType.TAXI)
    await _promote_to_driver(session_factory, "dismiss-second", VehicleType.TAXI)

    rider_h = _headers(rider_token)
    first_driver_h = _headers(first_driver_token)
    second_driver_h = _headers(second_driver_token)
    created = await client.post(RIDES, json=_ride_payload(), headers=rider_h)
    assert created.status_code == 201, created.text
    ride_id = created.json()["id"]
    presence = _mark_present(ride_id)

    assert any(
        ride["id"] == ride_id
        for ride in (await client.get(f"{RIDES}/open", headers=first_driver_h)).json()[
            "items"
        ]
    )
    dismissed = await client.post(f"{RIDES}/{ride_id}/dismiss", headers=first_driver_h)
    assert dismissed.status_code == 204, dismissed.text

    first_pool = await client.get(f"{RIDES}/open", headers=first_driver_h)
    second_pool = await client.get(f"{RIDES}/open", headers=second_driver_h)
    assert all(ride["id"] != ride_id for ride in first_pool.json()["items"])
    assert any(ride["id"] == ride_id for ride in second_pool.json()["items"])

    updated = await client.patch(
        f"{RIDES}/{ride_id}/fare", json={"fare": "30.00"}, headers=rider_h
    )
    assert updated.status_code == 200, updated.text
    renewed_pool = await client.get(f"{RIDES}/open", headers=first_driver_h)
    renewed = next(
        ride for ride in renewed_pool.json()["items"] if ride["id"] == ride_id
    )
    assert renewed["fare"] == "30.00"
    assert renewed["pool_version"] == 2

    hub.unsubscribe(ride_topic(uuid.UUID(ride_id)), presence)


async def test_open_rides_uses_opaque_keyset_cursor(client, session_factory):
    _, first_rider_token = await _register(client, "pool-page-rider-1")
    _, second_rider_token = await _register(client, "pool-page-rider-2")
    _, driver_token = await _register(client, "pool-page-driver")
    await _promote_to_driver(
        session_factory,
        "pool-page-driver",
        VehicleType.TAXI,
    )
    first = await client.post(
        RIDES,
        json=_ride_payload(),
        headers=_headers(first_rider_token),
    )
    second = await client.post(
        RIDES,
        json=_ride_payload(),
        headers=_headers(second_rider_token),
    )
    presences = [_mark_present(first.json()["id"]), _mark_present(second.json()["id"])]
    driver_h = _headers(driver_token)
    try:
        complete = (await client.get(f"{RIDES}/open", headers=driver_h)).json()
        first_page = (
            await client.get(f"{RIDES}/open", params={"limit": 1}, headers=driver_h)
        ).json()
        second_page = (
            await client.get(
                f"{RIDES}/open",
                params={"limit": 1, "cursor": first_page["next_cursor"]},
                headers=driver_h,
            )
        ).json()

        assert complete["next_cursor"] is None
        assert first_page["next_cursor"] is not None
        assert second_page["next_cursor"] is None
        assert [item["id"] for item in first_page["items"] + second_page["items"]] == [
            item["id"] for item in complete["items"]
        ]
    finally:
        hub.unsubscribe(ride_topic(uuid.UUID(first.json()["id"])), presences[0])
        hub.unsubscribe(ride_topic(uuid.UUID(second.json()["id"])), presences[1])


async def test_pagination_rejects_invalid_cursor_and_limits(client, session_factory):
    _, driver_token = await _register(client, "pagination-driver")
    await _promote_to_driver(
        session_factory,
        "pagination-driver",
        VehicleType.TAXI,
    )
    headers = _headers(driver_token)

    assert (
        await client.get(f"{RIDES}/open", params={"cursor": "inválido"}, headers=headers)
    ).status_code == 422
    assert (
        await client.get(f"{RIDES}/history", params={"cursor": "inválido"}, headers=headers)
    ).status_code == 422
    for limit in (0, 101):
        assert (
            await client.get(f"{RIDES}/open", params={"limit": limit}, headers=headers)
        ).status_code == 422
        assert (
            await client.get(f"{RIDES}/history", params={"limit": limit}, headers=headers)
        ).status_code == 422


async def _complete_ride(
    client, rider_h: dict[str, str], driver_h: dict[str, str], service_type: str = "taxi"
) -> str:
    created = await client.post(RIDES, json=_ride_payload(service_type), headers=rider_h)
    assert created.status_code == 201, created.text
    ride_id = created.json()["id"]
    offer = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=driver_h,
    )
    assert offer.status_code == 201, offer.text
    accepted = await client.post(
        f"{RIDES}/offers/{offer.json()['id']}/accept",
        headers=rider_h,
    )
    assert accepted.status_code == 200, accepted.text
    for status in ("arriving", "in_progress", "completed"):
        advanced = await client.patch(
            f"{RIDES}/{ride_id}/status",
            json={"status": status},
            headers=driver_h,
        )
        assert advanced.status_code == 200, advanced.text
    return ride_id


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
async def test_full_ride_flow(client, session_factory, service_type):
    # --- usuarios ---
    _, rider_token = await _register(client, "rider")
    _, d1_token = await _register(client, "driver1")
    _, d2_token = await _register(client, "driver2")
    await _promote_to_driver(session_factory, "driver1", VehicleType(service_type))
    await _promote_to_driver(session_factory, "driver2", VehicleType(service_type))

    rider_h = _headers(rider_token)
    d1_h = _headers(d1_token)
    d2_h = _headers(d2_token)

    # --- pasajero crea el viaje ---
    resp = await client.post(RIDES, json=_ride_payload(service_type), headers=rider_h)
    assert resp.status_code == 201
    ride_id = resp.json()["id"]
    # El pasajero "abre" su pantalla (presencia): la solicitud entra al pool.
    presence = _mark_present(ride_id)

    # --- los conductores ven la solicitud abierta ---
    open_resp = await client.get(f"{RIDES}/open", headers=d1_h)
    assert open_resp.status_code == 200
    assert any(r["id"] == ride_id for r in open_resp.json()["items"])

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
    assert body["service_type"] == service_type
    assert body["driver"]["vehicle_type"] == service_type

    premature_start = await client.patch(
        f"{RIDES}/{ride_id}/status", json={"status": "in_progress"}, headers=d1_h
    )
    assert premature_start.status_code == 409, premature_start.text
    passenger_start = await client.patch(
        f"{RIDES}/{ride_id}/status", json={"status": "arriving"}, headers=rider_h
    )
    assert passenger_start.status_code == 403, passenger_start.text

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

        repeated = await client.patch(
            f"{RIDES}/{ride_id}/status", json={"status": new_status}, headers=d1_h
        )
        assert repeated.status_code == 409, repeated.text
        if new_status != "completed":
            for endpoint, headers in (
                (f"{RIDES}/me/active", rider_h),
                ("/api/v1/drivers/me/active-ride", d1_h),
            ):
                recovered = await client.get(endpoint, headers=headers)
                assert recovered.json()["id"] == ride_id
                assert recovered.json()["status"] == new_status
        if new_status == "in_progress":
            for headers in (rider_h, d1_h):
                cancellation = await client.post(f"{RIDES}/{ride_id}/cancel", headers=headers)
                assert cancellation.status_code == 409, cancellation.text

    # --- el pasajero ve el viaje completado por polling ---
    final = await client.get(f"{RIDES}/{ride_id}", headers=rider_h)
    assert final.status_code == 200
    assert final.json()["status"] == "completed"
    assert final.json()["completed_at"] is not None
    assert final.json()["cancelled_at"] is None

    hub.unsubscribe(ride_topic(uuid.UUID(ride_id)), presence)


async def test_driver_cannot_offer_on_other_service(client, session_factory):
    _, rider_token = await _register(client, "rider2")
    _, moto_token = await _register(client, "moto")
    await _promote_to_driver(session_factory, "moto", VehicleType.MOTO)

    resp = await client.post(RIDES, json=_ride_payload(), headers=_headers(rider_token))
    ride_id = resp.json()["id"]

    # el conductor de moto no ve la solicitud de taxi
    open_resp = await client.get(f"{RIDES}/open", headers=_headers(moto_token))
    assert all(r["id"] != ride_id for r in open_resp.json()["items"])

    # y si intenta ofertar, recibe 403
    offer = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=_headers(moto_token),
    )
    assert offer.status_code == 403


async def test_taxi_and_moto_drivers_can_serve_delivery(client, session_factory):
    _, rider_token = await _register(client, "delivery-rider")
    _, taxi_token = await _register(client, "delivery-taxi")
    _, moto_token = await _register(client, "delivery-moto")
    await _promote_to_driver(
        session_factory, "delivery-taxi", VehicleType.TAXI
    )
    await _promote_to_driver(
        session_factory, "delivery-moto", VehicleType.MOTO
    )
    rider_h = _headers(rider_token)
    taxi_h = _headers(taxi_token)
    moto_h = _headers(moto_token)

    created = await client.post(
        RIDES, json=_ride_payload("delivery"), headers=rider_h
    )
    assert created.status_code == 201, created.text
    assert created.json()["service_type"] == "delivery"
    ride_id = created.json()["id"]
    presence = _mark_present(ride_id)
    try:
        for driver_h in (taxi_h, moto_h):
            visible = await client.get(f"{RIDES}/open", headers=driver_h)
            assert visible.status_code == 200, visible.text
            assert [ride_id] == [
                ride["id"]
                for ride in visible.json()["items"]
                if ride["service_type"] == "delivery"
            ]

        taxi_offer = await client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": True},
            headers=taxi_h,
        )
        moto_offer = await client.post(
            f"{RIDES}/{ride_id}/offers",
            json={"accept_at_fare": False, "price": "28.00"},
            headers=moto_h,
        )
        assert taxi_offer.status_code == 201, taxi_offer.text
        assert moto_offer.status_code == 201, moto_offer.text

        accepted = await client.post(
            f"{RIDES}/offers/{taxi_offer.json()['id']}/accept", headers=rider_h
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["service_type"] == "delivery"
        assert accepted.json()["driver"]["vehicle_type"] == "taxi"
    finally:
        hub.unsubscribe(ride_topic(uuid.UUID(ride_id)), presence)


async def test_passenger_active_ride_and_duplicate_request(client, session_factory):
    """El pasajero recupera su flujo y no puede abrir dos viajes simultáneos."""
    _, rider_token = await _register(client, "active-rider")
    _, driver_token = await _register(client, "active-driver")
    await _promote_to_driver(session_factory, "active-driver", VehicleType.TAXI)
    rider_h, driver_h = _headers(rider_token), _headers(driver_token)

    empty = await client.get(f"{RIDES}/me/active", headers=rider_h)
    assert empty.status_code == 200
    assert empty.json() is None

    created = await client.post(RIDES, json=_ride_payload(), headers=rider_h)
    assert created.status_code == 201, created.text
    ride_id = created.json()["id"]

    searching = await client.get(f"{RIDES}/me/active", headers=rider_h)
    assert searching.status_code == 200, searching.text
    assert searching.json()["id"] == ride_id
    assert searching.json()["status"] == "searching"

    duplicate = await client.post(RIDES, json=_ride_payload(), headers=rider_h)
    assert duplicate.status_code == 409, duplicate.text

    offer = await client.post(
        f"{RIDES}/{ride_id}/offers",
        json={"accept_at_fare": True},
        headers=driver_h,
    )
    assert offer.status_code == 201, offer.text
    accepted = await client.post(
        f"{RIDES}/offers/{offer.json()['id']}/accept", headers=rider_h
    )
    assert accepted.status_code == 200, accepted.text

    driver_active = await client.get(
        "/api/v1/drivers/me/active-ride",
        headers=driver_h,
    )
    assert driver_active.status_code == 200, driver_active.text
    assert driver_active.json()["id"] == ride_id
    assert driver_active.json()["status"] == "accepted"

    active = await client.get(f"{RIDES}/me/active", headers=rider_h)
    assert active.status_code == 200, active.text
    assert active.json()["id"] == ride_id
    assert active.json()["status"] == "accepted"

    for status in ("arriving", "in_progress", "completed"):
        advanced = await client.patch(
            f"{RIDES}/{ride_id}/status", json={"status": status}, headers=driver_h
        )
        assert advanced.status_code == 200, advanced.text

    terminal = await client.get(f"{RIDES}/me/active", headers=rider_h)
    assert terminal.status_code == 200
    assert terminal.json() is None


async def test_cancelled_search_is_not_recovered_as_active(client):
    """Cancelar una búsqueda debe dejar libre el flujo incluso tras recuperarlo."""
    _, rider_token = await _register(client, "cancel-active-rider")
    rider_h = _headers(rider_token)

    created = await client.post(RIDES, json=_ride_payload(), headers=rider_h)
    assert created.status_code == 201, created.text
    ride_id = created.json()["id"]

    active = await client.get(f"{RIDES}/me/active", headers=rider_h)
    assert active.status_code == 200, active.text
    assert active.json()["id"] == ride_id

    cancelled = await client.post(f"{RIDES}/{ride_id}/cancel", headers=rider_h)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancelled_at"] is not None
    assert cancelled.json()["completed_at"] is None

    recovered = await client.get(f"{RIDES}/me/active", headers=rider_h)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json() is None

    next_ride = await client.post(RIDES, json=_ride_payload(), headers=rider_h)
    assert next_ride.status_code == 201, next_ride.text
    assert next_ride.json()["id"] != ride_id


async def test_database_constraint_rejects_raced_second_active_ride(
    client, session_factory
):
    """El índice conserva el invariante aunque una lectura concurrente no vea el activo."""
    rider_id, rider_token = await _register(client, "active-race-rider")
    created = await client.post(
        RIDES,
        json=_ride_payload(),
        headers=_headers(rider_token),
    )
    assert created.status_code == 201, created.text

    raced_ride = RideRequest(
        rider_id=uuid.UUID(rider_id),
        origin=Location(-16.5, -68.13, "Casa", "Calle 1"),
        destination=Location(-16.49, -68.14, "Trabajo", "Av. 2"),
        service_type=ServiceType.TAXI,
        fare=Decimal("30.00"),
    )
    async with session_factory() as session:
        rides = SqlAlchemyRideRequestRepository(session)
        # Simula la ventana de carrera: la lectura previa no observó el INSERT ganador.
        rides.get_active_by_rider = AsyncMock(return_value=None)  # type: ignore[method-assign]
        assert await rides.add_if_no_active(raced_ride) is None

    active = await client.get(f"{RIDES}/me/active", headers=_headers(rider_token))
    assert active.status_code == 200, active.text
    assert active.json()["id"] == created.json()["id"]


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
async def test_close_flow_rating_history_earnings(client, session_factory, service_type):
    _, rider_token = await _register(client, "rider3")
    _, drv_token = await _register(client, "driver3")
    await _promote_to_driver(session_factory, "driver3", VehicleType(service_type))
    rider_h, drv_h = _headers(rider_token), _headers(drv_token)

    # viaje completo: crear → ofertar → aceptar → confirmar → avanzar a completado
    created = await client.post(RIDES, json=_ride_payload(service_type), headers=rider_h)
    ride_id = created.json()["id"]
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

    # Actualizar reputación no pisa disponibilidad y cambiar disponibilidad no
    # reescribe el promedio desde el snapshot anterior del usuario.
    driver_me = await client.get("/api/v1/auth/me", headers=drv_h)
    assert driver_me.json()["rating"] == 5.0
    assert driver_me.json()["is_online"] is True
    offline = await client.post(
        "/api/v1/drivers/me/online",
        json={"is_online": False},
        headers=drv_h,
    )
    assert offline.status_code == 200, offline.text
    assert offline.json()["is_online"] is False
    assert offline.json()["rating"] == 5.0

    # El conductor también califica: esa reputación se persiste en el pasajero.
    driver_rate = await client.post(
        f"{RIDES}/{ride_id}/rating", json={"score": 4}, headers=drv_h
    )
    assert driver_rate.status_code == 201, driver_rate.text
    rider_me = await client.get("/api/v1/auth/me", headers=rider_h)
    assert rider_me.status_code == 200, rider_me.text
    assert rider_me.json()["rating"] == 4.0

    # no se puede calificar dos veces el mismo viaje
    again = await client.post(f"{RIDES}/{ride_id}/rating", json={"score": 4}, headers=rider_h)
    assert again.status_code == 409

    # el historial del pasajero lista el viaje con su calificación
    hist = await client.get(f"{RIDES}/history", params={"status": "completed"}, headers=rider_h)
    assert hist.status_code == 200
    assert any(
        h["id"] == ride_id and h["my_rating"] == 5
        for h in hist.json()["items"]
    )

    # las ganancias del conductor reflejan el viaje (25.00)
    earn = await client.get("/api/v1/drivers/me/earnings", headers=drv_h)
    assert earn.status_code == 200
    assert earn.json()["trips_all_time"] == 1
    assert float(earn.json()["total_all_time"]) == 25.0

    # no se puede calificar un viaje que no está completado
    other_response = await client.post(RIDES, json=_ride_payload(service_type), headers=rider_h)
    other = other_response.json()["id"]
    bad = await client.post(f"{RIDES}/{other}/rating", json={"score": 5}, headers=rider_h)
    assert bad.status_code == 409


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
async def test_pending_rating_recovers_latest_completed_for_both_roles(
    client, session_factory, service_type
):
    _, rider_token = await _register(client, "pending-rider")
    _, driver_token = await _register(client, "pending-driver")
    await _promote_to_driver(
        session_factory, "pending-driver", VehicleType(service_type)
    )
    rider_h, driver_h = _headers(rider_token), _headers(driver_token)
    endpoint = f"{RIDES}/me/pending-rating"

    assert (await client.get(endpoint, headers=rider_h)).json() is None
    assert (await client.get(endpoint, headers=driver_h)).json() is None

    first_id = await _complete_ride(client, rider_h, driver_h, service_type)
    second_id = await _complete_ride(client, rider_h, driver_h, service_type)

    complete_history = (
        await client.get(f"{RIDES}/history", params={"limit": 100}, headers=rider_h)
    ).json()
    first_history_page = (
        await client.get(f"{RIDES}/history", params={"limit": 1}, headers=rider_h)
    ).json()
    second_history_page = (
        await client.get(
            f"{RIDES}/history",
            params={"limit": 1, "cursor": first_history_page["next_cursor"]},
            headers=rider_h,
        )
    ).json()
    assert first_history_page["next_cursor"] is not None
    assert [
        item["id"]
        for item in first_history_page["items"] + second_history_page["items"]
    ] == [item["id"] for item in complete_history["items"]]

    rider_pending = await client.get(endpoint, headers=rider_h)
    driver_pending = await client.get(endpoint, headers=driver_h)
    assert rider_pending.status_code == 200, rider_pending.text
    assert driver_pending.status_code == 200, driver_pending.text
    assert rider_pending.json()["id"] == second_id
    assert driver_pending.json()["id"] == second_id
    assert rider_pending.json()["status"] == "completed"
    assert driver_pending.json()["status"] == "completed"

    # Los endpoints de viaje activo conservan su semántica no terminal.
    assert (await client.get(f"{RIDES}/me/active", headers=rider_h)).json() is None
    assert (
        await client.get("/api/v1/drivers/me/active-ride", headers=driver_h)
    ).json() is None

    rider_rates_second = await client.post(
        f"{RIDES}/{second_id}/rating",
        json={"score": 5},
        headers=rider_h,
    )
    assert rider_rates_second.status_code == 201, rider_rates_second.text
    # El pendiente es independiente por usuario: el pasajero cae al anterior,
    # mientras el conductor todavía debe calificar el viaje más reciente.
    assert (await client.get(endpoint, headers=rider_h)).json()["id"] == first_id
    assert (await client.get(endpoint, headers=driver_h)).json()["id"] == second_id

    driver_rates_second = await client.post(
        f"{RIDES}/{second_id}/rating",
        json={"score": 4},
        headers=driver_h,
    )
    assert driver_rates_second.status_code == 201, driver_rates_second.text
    assert (await client.get(endpoint, headers=driver_h)).json()["id"] == first_id

    for headers in (rider_h, driver_h):
        rated = await client.post(
            f"{RIDES}/{first_id}/rating",
            json={"score": 5},
            headers=headers,
        )
        assert rated.status_code == 201, rated.text
        pending = await client.get(endpoint, headers=headers)
        assert pending.status_code == 200, pending.text
        assert pending.json() is None


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
async def test_skip_rating_is_persistent_for_both_roles(client, session_factory, service_type):
    _, rider_token = await _register(client, "skip-rider")
    _, driver_token = await _register(client, "skip-driver")
    _, stranger_token = await _register(client, "skip-stranger")
    await _promote_to_driver(session_factory, "skip-driver", VehicleType(service_type))
    rider_h = _headers(rider_token)
    driver_h = _headers(driver_token)
    stranger_h = _headers(stranger_token)
    pending_endpoint = f"{RIDES}/me/pending-rating"

    first_id = await _complete_ride(client, rider_h, driver_h, service_type)
    second_id = await _complete_ride(client, rider_h, driver_h, service_type)
    assert (await client.get(pending_endpoint, headers=rider_h)).json()["id"] == second_id
    assert (await client.get(pending_endpoint, headers=driver_h)).json()["id"] == second_id

    foreign = await client.post(
        f"{RIDES}/{second_id}/rating/skip",
        headers=stranger_h,
    )
    assert foreign.status_code == 403, foreign.text

    for headers in (rider_h, driver_h):
        skipped = await client.post(
            f"{RIDES}/{second_id}/rating/skip",
            headers=headers,
        )
        assert skipped.status_code == 204, skipped.text
        repeated = await client.post(
            f"{RIDES}/{second_id}/rating/skip",
            headers=headers,
        )
        assert repeated.status_code == 204, repeated.text
        assert (await client.get(pending_endpoint, headers=headers)).json()["id"] == first_id

    # Omitir no crea ratings ni altera promedios de reputación.
    rider_me = await client.get("/api/v1/auth/me", headers=rider_h)
    driver_me = await client.get("/api/v1/auth/me", headers=driver_h)
    assert rider_me.json()["rating"] is None
    assert driver_me.json()["rating"] is None

    for headers in (rider_h, driver_h):
        skipped = await client.post(
            f"{RIDES}/{first_id}/rating/skip",
            headers=headers,
        )
        assert skipped.status_code == 204, skipped.text
        assert (await client.get(pending_endpoint, headers=headers)).json() is None

    searching = await client.post(RIDES, json=_ride_payload(service_type), headers=rider_h)
    assert searching.status_code == 201, searching.text
    uncompleted = await client.post(
        f"{RIDES}/{searching.json()['id']}/rating/skip",
        headers=rider_h,
    )
    assert uncompleted.status_code == 409, uncompleted.text


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
@pytest.mark.parametrize("stage", ["accepted", "arriving"])
@pytest.mark.parametrize("actor", ["passenger", "driver"])
async def test_assigned_trip_cancellation_releases_both_participants(
    client, session_factory, service_type, stage, actor
):
    _, rider_token = await _register(client, "cancel-trip-rider")
    _, driver_token = await _register(client, "cancel-trip-driver")
    await _promote_to_driver(session_factory, "cancel-trip-driver", VehicleType(service_type))
    rider_h, driver_h = _headers(rider_token), _headers(driver_token)
    created = await client.post(RIDES, json=_ride_payload(service_type), headers=rider_h)
    assert created.status_code == 201, created.text
    ride_id = created.json()["id"]
    offer = await client.post(
        f"{RIDES}/{ride_id}/offers", json={"accept_at_fare": True}, headers=driver_h
    )
    assert offer.status_code == 201, offer.text
    accepted = await client.post(f"{RIDES}/offers/{offer.json()['id']}/accept", headers=rider_h)
    assert accepted.status_code == 200, accepted.text
    if stage == "arriving":
        arrived = await client.patch(
            f"{RIDES}/{ride_id}/status", json={"status": stage}, headers=driver_h
        )
        assert arrived.status_code == 200, arrived.text

    cancelled = await client.post(
        f"{RIDES}/{ride_id}/cancel", headers=rider_h if actor == "passenger" else driver_h
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancelled_at"] is not None
    for endpoint, headers in (
        (f"{RIDES}/me/active", rider_h),
        ("/api/v1/drivers/me/active-ride", driver_h),
    ):
        assert (await client.get(endpoint, headers=headers)).json() is None
        assert (await client.get(f"{RIDES}/me/pending-rating", headers=headers)).json() is None
        history = await client.get(
            f"{RIDES}/history", params={"status": "cancelled"}, headers=headers
        )
        assert history.status_code == 200, history.text
        assert any(item["id"] == ride_id for item in history.json()["items"])
    next_ride = await client.post(RIDES, json=_ride_payload(service_type), headers=rider_h)
    assert next_ride.status_code == 201, next_ride.text


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
async def test_offer_rejects_request_edited_during_pickup_calculation(
    client, session_factory, service_type,
):
    _, passenger = await _register(client, "edited-pickup-passenger")
    _, driver = await _register(client, "edited-pickup-driver")
    await _promote_to_driver(session_factory, "edited-pickup-driver", VehicleType(service_type))
    passenger_headers, driver_headers = _headers(passenger), _headers(driver)
    payload = _ride_payload(service_type)
    ride = (await client.post(RIDES, json=payload, headers=passenger_headers)).json()
    present = _mark_present(ride["id"])
    try:
        pool = (await client.get(f"{RIDES}/open", headers=driver_headers)).json()["items"]
        original_version = next(item for item in pool if item["id"] == ride["id"])["pool_version"]
        paused = await client.post(f"{RIDES}/{ride['id']}/pause-edit", headers=passenger_headers)
        assert paused.status_code == 200, paused.text
        updated_payload = {**payload, "origin": {**payload["origin"], "latitude": -16.55}}
        edited = await client.patch(
            f"{RIDES}/{ride['id']}", json=updated_payload, headers=passenger_headers,
        )
        assert edited.status_code == 200, edited.text
        stale = await client.post(
            f"{RIDES}/{ride['id']}/offers", headers=driver_headers,
            json={"accept_at_fare": True, "eta_min": 3, "expected_pool_version": original_version},
        )
        assert stale.status_code == 409, stale.text
        assert (await client.get(
            f"{RIDES}/{ride['id']}/offers", headers=passenger_headers,
        )).json() == []
        refreshed = (await client.get(f"{RIDES}/open", headers=driver_headers)).json()["items"]
        version = next(item for item in refreshed if item["id"] == ride["id"])["pool_version"]
        current = await client.post(
            f"{RIDES}/{ride['id']}/offers", headers=driver_headers,
            json={"accept_at_fare": True, "eta_min": 12, "expected_pool_version": version},
        )
        assert current.status_code == 201, current.text
    finally:
        hub.unsubscribe(ride_topic(uuid.UUID(ride["id"])), present)
