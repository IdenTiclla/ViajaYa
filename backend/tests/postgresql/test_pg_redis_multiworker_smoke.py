"""Gate legacy y negociación real entre dos procesos live_redis."""

from __future__ import annotations

import asyncio
import json
import multiprocessing
import os
import socket
import time
import uuid

import httpx
import pytest
import websockets
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.v1.schemas.realtime import (
    DriverSnapshotMessageV2,
    RealtimeEventEnvelopeV2,
    RideSnapshotMessageV2,
)
from app.domain.entities import VehicleType
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from tests.e2e.helpers import promote_to_driver, sign_in
from tests.postgresql.redis_realtime_support import (
    run_redis_realtime_server_process,
)

_JWT_SECRET = "redis-single-worker-gate-only-not-production"
_OPERATION_TIMEOUT_SECONDS = 30.0


def _listener() -> tuple[socket.socket, str]:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    return listener, f"http://127.0.0.1:{listener.getsockname()[1]}"


async def _wait_ready(base_url: str, process) -> None:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    async with httpx.AsyncClient(
        base_url=base_url,
        timeout=1,
        trust_env=False,
    ) as client:
        while True:
            if process.exitcode is not None:
                pytest.fail(
                    "La primera réplica terminó antes de readiness "
                    f"(exitcode={process.exitcode})."
                )
            try:
                response = await client.get("/health/ready")
                if response.status_code == 200:
                    checks = response.json()["checks"]
                    assert checks["realtime_redis_bridge"] == "ok"
                    assert checks["realtime_outbox_process_lock"] == "ok"
                    return
            except httpx.HTTPError:
                pass
            if time.monotonic() >= deadline:
                pytest.fail("La primera réplica live_redis no alcanzó readiness.")
            await asyncio.sleep(0.02)


async def _wait_exit(process, expected_exitcode: int) -> None:
    await asyncio.to_thread(process.join, _OPERATION_TIMEOUT_SECONDS)
    if process.is_alive():
        process.kill()
        await asyncio.to_thread(process.join, 5)
        pytest.fail("La segunda réplica no terminó dentro del deadline.")
    assert process.exitcode == expected_exitcode


async def _stop_process(process, shutdown) -> None:
    if process.is_alive():
        shutdown.set()
        await asyncio.to_thread(process.join, 8)
    if process.is_alive():
        process.kill()
        await asyncio.to_thread(process.join, 5)
    assert process.exitcode == 0
    process.close()


async def _register(client: httpx.AsyncClient, label: str) -> str:
    return (await sign_in(client, label)).token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _receive_json(websocket) -> dict[str, object]:
    async with asyncio.timeout(5):
        frame = await websocket.recv()
    assert isinstance(frame, str)
    value = json.loads(frame)
    assert isinstance(value, dict)
    return value


async def _receive_event_for_aggregate(
    websocket,
    *,
    event_type: str,
    aggregate_id: uuid.UUID,
) -> RealtimeEventEnvelopeV2:
    """Ignora backlog legítimo de otros agregados sobre un topic compartido."""
    async with asyncio.timeout(10):
        while True:
            event = RealtimeEventEnvelopeV2.model_validate(
                await _receive_json(websocket)
            )
            if event.type == event_type and event.aggregate_id == aggregate_id:
                return event


async def test_segundo_worker_live_redis_falla_hasta_compartir_presencia(
    pg_test_db,
) -> None:
    if os.name != "posix":
        pytest.skip("El gate multiworker usa sockets heredados y requiere POSIX.")
    redis_url = os.getenv("VIAJAYA_TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("Define VIAJAYA_TEST_REDIS_URL para el gate multiworker.")

    first_listener, first_url = _listener()
    second_listener, _second_url = _listener()
    context = multiprocessing.get_context("spawn")
    first_shutdown = context.Event()
    second_shutdown = context.Event()
    channel = f"viajaya:test:single-worker:{uuid.uuid4()}"
    first_process = context.Process(
        target=run_redis_realtime_server_process,
        args=(
            first_listener,
            pg_test_db.url,
            redis_url,
            channel,
            _JWT_SECRET,
            first_shutdown,
        ),
        name="viajaya-redis-first-api",
    )
    second_process = context.Process(
        target=run_redis_realtime_server_process,
        args=(
            second_listener,
            pg_test_db.url,
            redis_url,
            channel,
            _JWT_SECRET,
            second_shutdown,
        ),
        name="viajaya-redis-rejected-api",
    )
    first_process.start()
    try:
        await _wait_ready(first_url, first_process)
        second_process.start()
        await _wait_exit(second_process, expected_exitcode=3)
    finally:
        if second_process.pid is not None:
            if second_process.is_alive():
                second_process.kill()
                await asyncio.to_thread(second_process.join, 5)
            second_process.close()
        await _stop_process(first_process, first_shutdown)
        first_listener.close()
        second_listener.close()


async def test_dos_workers_negocian_con_presencia_compartida(
    pg_test_db,
) -> None:
    if os.name != "posix":
        pytest.skip("El smoke multiworker usa sockets heredados y requiere POSIX.")
    redis_url = os.getenv("VIAJAYA_TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("Define VIAJAYA_TEST_REDIS_URL para el smoke multiworker.")

    first_listener, first_url = _listener()
    second_listener, second_url = _listener()
    context = multiprocessing.get_context("spawn")
    first_shutdown = context.Event()
    second_shutdown = context.Event()
    channel = f"viajaya:test:multiworker:{uuid.uuid4()}"

    def process(listener, shutdown, name):
        return context.Process(
            target=run_redis_realtime_server_process,
            args=(
                listener,
                pg_test_db.url,
                redis_url,
                channel,
                _JWT_SECRET,
                shutdown,
                True,
            ),
            name=name,
        )

    first_process = process(first_listener, first_shutdown, "viajaya-redis-api-a")
    second_process = process(second_listener, second_shutdown, "viajaya-redis-api-b")
    first_process.start()
    second_process.start()
    try:
        await asyncio.gather(
            _wait_ready(first_url, first_process),
            _wait_ready(second_url, second_process),
        )
        async with (
            httpx.AsyncClient(
                base_url=first_url,
                timeout=_OPERATION_TIMEOUT_SECONDS,
                trust_env=False,
            ) as first_client,
            httpx.AsyncClient(
                base_url=second_url,
                timeout=_OPERATION_TIMEOUT_SECONDS,
                trust_env=False,
            ) as second_client,
        ):
            suffix = uuid.uuid4().hex
            rider_token = await _register(first_client, f"redis-rider-{suffix}")
            driver_label = f"redis-driver-{suffix}"
            driver_token = await _register(first_client, driver_label)
            sessions = async_sessionmaker(
                pg_test_db.engine,
                class_=AsyncSession,
                expire_on_commit=False,
            )
            await promote_to_driver(sessions, driver_label, VehicleType.TAXI)

            created = await first_client.post(
                "/api/v1/rides",
                headers=_headers(rider_token),
                json={
                    "origin": {
                        "latitude": -16.5,
                        "longitude": -68.13,
                        "name": "Origen multiworker",
                        "address": "Dirección 1",
                    },
                    "destination": {
                        "latitude": -16.49,
                        "longitude": -68.14,
                        "name": "Destino multiworker",
                        "address": "Dirección 2",
                    },
                    "service_type": "taxi",
                    "fare": "25.00",
                    "payment_method": "cash",
                },
            )
            assert created.status_code == 201, created.text
            ride_id = created.json()["id"]
            rider_url = first_url.replace("http://", "ws://") + (
                f"/api/v1/ws/rides/{ride_id}"
            )
            driver_url = second_url.replace("http://", "ws://") + "/api/v1/ws/driver"

            async with (
                websockets.connect(
                    driver_url,
                    subprotocols=[AUTH_SUBPROTOCOL, driver_token],
                ) as driver_ws,
                websockets.connect(
                    rider_url,
                    subprotocols=[AUTH_SUBPROTOCOL, rider_token],
                ) as rider_ws,
            ):
                DriverSnapshotMessageV2.model_validate(
                    await _receive_json(driver_ws)
                )
                RideSnapshotMessageV2.model_validate(await _receive_json(rider_ws))
                announced = await _receive_event_for_aggregate(
                    driver_ws,
                    event_type="ride_created",
                    aggregate_id=uuid.UUID(ride_id),
                )
                assert announced.data["id"] == ride_id

                offered = await second_client.post(
                    f"/api/v1/rides/{ride_id}/offers",
                    headers=_headers(driver_token),
                    json={"accept_at_fare": True, "eta_min": 4},
                )
                assert offered.status_code == 201, offered.text
                offer_event = RealtimeEventEnvelopeV2.model_validate(
                    await _receive_json(rider_ws)
                )
                assert offer_event.type == "offer_created"
                assert offer_event.data["id"] == offered.json()["id"]

                accepted = await first_client.post(
                    f"/api/v1/rides/offers/{offered.json()['id']}/accept",
                    headers=_headers(rider_token),
                )
                assert accepted.status_code == 200, accepted.text
                accepted_event = await _receive_event_for_aggregate(
                    driver_ws,
                    event_type="offer_accepted",
                    aggregate_id=uuid.UUID(ride_id),
                )
                assert accepted_event.data["id"] == ride_id
    finally:
        await asyncio.gather(
            _stop_process(first_process, first_shutdown),
            _stop_process(second_process, second_shutdown),
        )
        first_listener.close()
        second_listener.close()
