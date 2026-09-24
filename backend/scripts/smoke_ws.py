"""Smoke test of the negotiation flow against the live server.

Simulates a passenger and a driver (seed numbers, simulated OTP) with HTTP + WebSocket:
creates a request, connects both sockets, sends a custom counter-offer
and checks that the passenger keeps negotiating. At the end it cancels the ride so it does not
leave garbage behind. Run it with the backend up::

    python -m scripts.smoke_ws
"""

from __future__ import annotations

import asyncio
import json

import httpx
import websockets

from scripts.phone_access import sign_in

BASE = "http://localhost:8000/api/v1"
WS_BASE = "ws://localhost:8000/api/v1"
WS_AUTH_PROTOCOL = "viajaya.auth"


async def main() -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        rider_token = await sign_in(client, "+59170000001", base=BASE)
        driver_token = await sign_in(client, "+59170000011", base=BASE)
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
            # 1) The passenger connects their WS (makes them "present" in the pool).
            async with websockets.connect(
                rider_url,
                subprotocols=[WS_AUTH_PROTOCOL, rider_token],
            ) as rider_ws:
                snapshot = json.loads(await asyncio.wait_for(rider_ws.recv(), 5))
                assert snapshot["type"] == "offers_snapshot", snapshot
                print(f"[ok] passenger WS connected, offers snapshot: {len(snapshot['data'])}")

                # 2) The driver connects their WS and must see the ride in the snapshot.
                async with websockets.connect(
                    driver_url,
                    subprotocols=[WS_AUTH_PROTOCOL, driver_token],
                ) as driver_ws:
                    pool = json.loads(await asyncio.wait_for(driver_ws.recv(), 5))
                    assert pool["type"] == "open_rides_snapshot", pool
                    ids = [r["id"] for r in pool["data"]]
                    print(f"[ok] WS conductor conectado, solicitudes visibles: {len(ids)}")
                    assert ride_id in ids, f"el viaje {ride_id} did NOT reach the driver"
                    print("[ok] the request reaches the driver")

                    # 3) The fallback REST endpoint also returns it.
                    resp = await client.get(f"{BASE}/rides/open", headers=driver_h)
                    resp.raise_for_status()
                    open_ids = [r["id"] for r in resp.json()]
                    assert ride_id in open_ids, "does not appear in GET /rides/open"
                    print("[ok] GET /rides/open also returns it")

                    # 4) Reproduction of the reported flow: a custom counter-offer
                    # arrives live without closing or assigning the ride.
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
                    print("[ok] custom counter-offer received; negotiation still active")
        finally:
            await client.post(f"{BASE}/rides/{ride_id}/cancel", headers=rider_h)
            print("[ok] viaje cancelado (limpieza)")


if __name__ == "__main__":
    asyncio.run(main())
