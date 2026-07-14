"""Prueba de humo del flujo de negociación contra el servidor en vivo.

Simula a un pasajero y un conductor (usuarios del seed) con HTTP + WebSocket:
crea una solicitud, conecta ambos sockets, envía una contraoferta personalizada
y verifica que el pasajero siga negociando. Al final cancela el viaje para no
dejar basura. Ejecutar con el backend levantado::

    python -m scripts.smoke_ws
"""

from __future__ import annotations

import asyncio
import json

import httpx
import websockets

BASE = "http://localhost:8000/api/v1"
WS_BASE = "ws://localhost:8000/api/v1"
PASSWORD = "ViajaYa1234#"
WS_AUTH_PROTOCOL = "viajaya.auth"


async def login(client: httpx.AsyncClient, email: str) -> str:
    resp = await client.post(f"{BASE}/auth/login", json={"email": email, "password": PASSWORD})
    resp.raise_for_status()
    return resp.json()["tokens"]["access_token"]


async def main() -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        rider_token = await login(client, "passenger1@viajaya.com")
        driver_token = await login(client, "driver.auto1@viajaya.com")
        rider_h = {"Authorization": f"Bearer {rider_token}"}
        driver_h = {"Authorization": f"Bearer {driver_token}"}

        await client.post(
            f"{BASE}/drivers/me/online", json={"is_online": True}, headers=driver_h
        )

        resp = await client.post(
            f"{BASE}/rides",
            json={
                "origin": {
                    "latitude": -16.5,
                    "longitude": -68.15,
                    "name": "Casa",
                    "address": "Calle 1",
                },
                "destination": {
                    "latitude": -16.51,
                    "longitude": -68.13,
                    "name": "Trabajo",
                    "address": "Av. 2",
                },
                "service_type": "taxi",
                "fare": "25.00",
                "payment_method": "cash",
            },
            headers=rider_h,
        )
        resp.raise_for_status()
        ride_id = resp.json()["id"]
        print(f"[ok] viaje creado: {ride_id}")

        rider_url = f"{WS_BASE}/ws/rides/{ride_id}"
        driver_url = f"{WS_BASE}/ws/driver"
        try:
            # 1) Pasajero conecta su WS (lo vuelve "presente" en el pool).
            async with websockets.connect(
                rider_url,
                subprotocols=[WS_AUTH_PROTOCOL, rider_token],
            ) as rider_ws:
                snapshot = json.loads(await asyncio.wait_for(rider_ws.recv(), 5))
                assert snapshot["type"] == "offers_snapshot", snapshot
                print(f"[ok] WS pasajero conectado, snapshot de ofertas: {len(snapshot['data'])}")

                # 2) Conductor conecta su WS y debe ver el viaje en el snapshot.
                async with websockets.connect(
                    driver_url,
                    subprotocols=[WS_AUTH_PROTOCOL, driver_token],
                ) as driver_ws:
                    pool = json.loads(await asyncio.wait_for(driver_ws.recv(), 5))
                    assert pool["type"] == "open_rides_snapshot", pool
                    ids = [r["id"] for r in pool["data"]]
                    print(f"[ok] WS conductor conectado, solicitudes visibles: {len(ids)}")
                    assert ride_id in ids, f"el viaje {ride_id} NO llegó al conductor"
                    print("[ok] la solicitud le llega al conductor")

                    # 3) REST de respaldo también la devuelve.
                    resp = await client.get(f"{BASE}/rides/open", headers=driver_h)
                    resp.raise_for_status()
                    open_ids = [r["id"] for r in resp.json()]
                    assert ride_id in open_ids, "no aparece en GET /rides/open"
                    print("[ok] GET /rides/open también la devuelve")

                    # 4) Reproducción del flujo reportado: una contraoferta
                    # personalizada llega en vivo sin cerrar ni asignar el ride.
                    offer = await client.post(
                        f"{BASE}/rides/{ride_id}/offers",
                        json={
                            "accept_at_fare": False,
                            "price": "30.00",
                            "eta_min": 8,
                        },
                        headers=driver_h,
                    )
                    offer.raise_for_status()
                    offer_event = json.loads(
                        await asyncio.wait_for(rider_ws.recv(), 5)
                    )
                    assert offer_event["type"] == "offer_created", offer_event
                    assert offer_event["data"]["price"] == "30.00", offer_event

                    active = await client.get(
                        f"{BASE}/rides/me/active",
                        headers=rider_h,
                    )
                    active.raise_for_status()
                    assert active.json()["id"] == ride_id, active.text
                    assert active.json()["status"] == "searching", active.text
                    print("[ok] contraoferta personalizada recibida; negociación sigue activa")
        finally:
            await client.post(f"{BASE}/rides/{ride_id}/cancel", headers=rider_h)
            print("[ok] viaje cancelado (limpieza)")


if __name__ == "__main__":
    asyncio.run(main())
