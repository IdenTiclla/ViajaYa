"""Smoke realtime por red contra PostgreSQL y Uvicorn reales."""

from __future__ import annotations

import asyncio
import json
import socket
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
import uvicorn
import websockets
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1 import presence
from app.api.v1.routers import rides as rides_router
from app.api.v1.schemas.realtime import (
    RealtimeEventEnvelopeV2,
    RideSnapshotMessageV2,
)
from app.domain.entities import VehicleType
from app.infrastructure.config import Settings
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from app.main import create_app
from tests.e2e.helpers import promote_to_driver, sign_in

_FRAME_TIMEOUT_SECONDS = 5.0
_OPERATION_TIMEOUT_SECONDS = 20.0


@asynccontextmanager
async def _serve(app) -> AsyncIterator[str]:
    """Start Uvicorn on loopback and an ephemeral port during the test."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            log_level="warning",
            lifespan="on",
            timeout_graceful_shutdown=2,
        )
    )
    task = asyncio.create_task(
        server.serve(sockets=[listener]),
        name="realtime-network-smoke-uvicorn",
    )
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    try:
        while not server.started:
            if task.done():
                await task
                pytest.fail("Uvicorn exited before accepting connections.")
            if time.monotonic() >= deadline:
                pytest.fail("Uvicorn did not become ready within the expected time.")
            await asyncio.sleep(0.01)
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        try:
            await asyncio.wait_for(task, timeout=_OPERATION_TIMEOUT_SECONDS)
        except TimeoutError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            pytest.fail("Uvicorn did not shut down in a coordinated way.")
        finally:
            listener.close()


async def _register(client: httpx.AsyncClient, label: str) -> str:
    return (await sign_in(client, label)).token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _receive_json(websocket) -> dict[str, object]:
    async with asyncio.timeout(_FRAME_TIMEOUT_SECONDS):
        frame = await websocket.recv()
    assert isinstance(frame, str)
    value = json.loads(frame)
    assert isinstance(value, dict)
    return value


async def _wait_until_drained(client: httpx.AsyncClient) -> None:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    while True:
        response = await client.get("/health/realtime")
        assert response.status_code == 200, response.text
        snapshot = response.json()
        if (
            snapshot["pending_event_count"] == 0
            and snapshot["pending_batch_count"] == 0
            and snapshot["retrying_batch_count"] == 0
        ):
            return
        if time.monotonic() >= deadline:
            pytest.fail(f"The outbox did not drain: {snapshot}")
        await asyncio.sleep(0.02)


async def test_live_local_converges_after_a_real_new_tcp_connection(pg_test_db) -> None:
    """Certifica snapshot, delta durable y otro handshake fuera de TestClient."""
    sessions = async_sessionmaker[AsyncSession](
        pg_test_db.engine,
        expire_on_commit=False,
    )
    settings = Settings(
        _env_file=None,
        database_url=pg_test_db.url,
        jwt_secret="smoke-only-secret-not-for-production",
        phone_otp_enabled=True,
        realtime_outbox_dispatch_mode="live_local",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=0.01,
        realtime_outbox_shutdown_timeout_seconds=2,
    )
    app = create_app(settings=settings, session_factory=sessions)
    suffix = uuid.uuid4().hex

    async with _serve(app) as base_url:
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=_OPERATION_TIMEOUT_SECONDS,
        ) as client:
            ready = await client.get("/health/ready")
            assert ready.status_code == 200, ready.text

            rider_token: str | None = None
            driver_token: str | None = None
            ride_id: str | None = None
            primary_error: BaseException | None = None
            try:
                rider_token = await _register(client, f"smoke-rider-{suffix}")
                driver_label = f"smoke-driver-{suffix}"
                driver_token = await _register(client, driver_label)
                await promote_to_driver(sessions, driver_label, VehicleType.TAXI)

                ride_response = await client.post(
                    "/api/v1/rides",
                    headers=_headers(rider_token),
                    json={
                        "origin": {
                            "latitude": -16.5,
                            "longitude": -68.13,
                            "name": "Origen smoke",
                            "address": "Dirección smoke 1",
                        },
                        "destination": {
                            "latitude": -16.49,
                            "longitude": -68.14,
                            "name": "Destino smoke",
                            "address": "Dirección smoke 2",
                        },
                        "service_type": "taxi",
                        "fare": "25.00",
                        "payment_method": "cash",
                    },
                )
                assert ride_response.status_code == 201, ride_response.text
                ride_id = ride_response.json()["id"]
                rider_ws_url = base_url.replace("http://", "ws://") + (
                    f"/api/v1/ws/rides/{ride_id}"
                )

                async with websockets.connect(
                    rider_ws_url,
                    subprotocols=[AUTH_SUBPROTOCOL, rider_token],
                    open_timeout=_FRAME_TIMEOUT_SECONDS,
                    close_timeout=_FRAME_TIMEOUT_SECONDS,
                ) as rider_ws:
                    assert rider_ws.subprotocol == AUTH_SUBPROTOCOL
                    initial_snapshot = RideSnapshotMessageV2.model_validate(
                        await _receive_json(rider_ws)
                    )
                    assert initial_snapshot.data.ride.id == uuid.UUID(ride_id)
                    assert initial_snapshot.watermarks[0].stream == f"ride:{ride_id}"
                    initial_watermark = initial_snapshot.watermarks[0].stream_version

                    offer = await client.post(
                        f"/api/v1/rides/{ride_id}/offers",
                        headers=_headers(driver_token),
                        json={"accept_at_fare": True, "eta_min": 4},
                    )
                    assert offer.status_code == 201, offer.text
                    event = RealtimeEventEnvelopeV2.model_validate(
                        await _receive_json(rider_ws)
                    )
                    assert event.type == "offer_created"
                    assert event.stream == f"ride:{ride_id}"
                    assert event.data["id"] == offer.json()["id"]
                    assert event.stream_version == initial_watermark + 1

                async with websockets.connect(
                    rider_ws_url,
                    subprotocols=[AUTH_SUBPROTOCOL, rider_token],
                    open_timeout=_FRAME_TIMEOUT_SECONDS,
                    close_timeout=_FRAME_TIMEOUT_SECONDS,
                ) as reconnected_ws:
                    assert reconnected_ws.subprotocol == AUTH_SUBPROTOCOL
                    reconnected = RideSnapshotMessageV2.model_validate(
                        await _receive_json(reconnected_ws)
                    )
                    assert reconnected.snapshot_id != initial_snapshot.snapshot_id
                    assert [item.id for item in reconnected.data.offers] == [
                        uuid.UUID(offer.json()["id"])
                    ]
                    assert reconnected.watermarks[0].stream == f"ride:{ride_id}"
                    assert reconnected.watermarks[0].stream_version == event.stream_version
            except BaseException as error:
                primary_error = error
                raise
            finally:
                cleanup_errors: list[str] = []
                if ride_id is not None and rider_token is not None:
                    cancelled = await client.post(
                        f"/api/v1/rides/{ride_id}/cancel",
                        headers=_headers(rider_token),
                    )
                    if cancelled.status_code != 200:
                        cleanup_errors.append(
                            f"cancel returned {cancelled.status_code}"
                        )
                if driver_token is not None:
                    offline = await client.post(
                        "/api/v1/drivers/me/online",
                        headers=_headers(driver_token),
                        json={"is_online": False},
                    )
                    if offline.status_code != 200:
                        cleanup_errors.append(
                            f"offline returned {offline.status_code}"
                        )
                await _wait_until_drained(client)
                if cleanup_errors and primary_error is None:
                    pytest.fail("; ".join(cleanup_errors))

    assert not rides_router._EXPIRY_TASKS
    assert not presence._pending_cancels
    assert not presence._critical_cancels
    assert not presence._CANCEL_TASKS
    assert not presence._last_seen
