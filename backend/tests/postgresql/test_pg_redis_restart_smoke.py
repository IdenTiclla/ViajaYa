"""Restart real de Redis entre commit y publish con replay durable."""

from __future__ import annotations

import asyncio
import multiprocessing
import os
import re
import socket
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
import pytest
import websockets
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from websockets.exceptions import ConnectionClosedError

from app.api.v1.schemas.realtime import (
    RealtimeEventEnvelopeV2,
    RideSnapshotMessageV2,
)
from app.domain.entities import VehicleType
from app.infrastructure.config import Settings
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from app.main import create_app
from tests.e2e.helpers import promote_to_driver
from tests.postgresql import test_pg_realtime_network_smoke as network_support
from tests.postgresql.redis_realtime_support import (
    run_redis_restart_server_process,
)

_JWT_SECRET = "redis-restart-smoke-only-not-production"
_OPERATION_TIMEOUT_SECONDS = 30.0
_FRAME_TIMEOUT_SECONDS = 8.0
_SAFE_CONTAINER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


@dataclass(frozen=True, slots=True)
class _Bootstrap:
    rider_token: str
    driver_token: str
    ride_id: str


@dataclass(frozen=True, slots=True)
class _EventState:
    event_id: uuid.UUID
    batch_id: uuid.UUID
    sequence: int
    stream_version: int
    attempts: int
    published: bool
    last_error: str | None


def _listener() -> tuple[socket.socket, str]:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    return listener, f"http://127.0.0.1:{listener.getsockname()[1]}"


def _validate_restart_target(
    redis_url: str,
    container: str,
    *,
    allow_development_container: bool,
) -> None:
    parsed = urlsplit(redis_url)
    if parsed.scheme != "redis" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("El restart smoke exige Redis loopback sin TLS.")
    if parsed.port is None or parsed.path != "/15":
        raise RuntimeError("El restart smoke exige un Redis explícito en DB 15.")
    if not _SAFE_CONTAINER_NAME.fullmatch(container):
        raise RuntimeError("El nombre del contenedor Redis no es seguro.")
    if parsed.port == 6379:
        if not allow_development_container or container != "viajaya_redis":
            raise RuntimeError(
                "Reiniciar Redis de desarrollo requiere opt-in y nombre exacto."
            )
        return
    lowered = container.lower()
    if "test" not in lowered and "ci" not in lowered:
        raise RuntimeError("El contenedor Redis debe estar marcado como test o CI.")


async def _docker(*arguments: str) -> str:
    process = await asyncio.create_subprocess_exec(
        "docker",
        *arguments,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=_OPERATION_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        process.kill()
        await process.wait()
        pytest.fail("Docker excedió el deadline del restart smoke.")
    if process.returncode != 0:
        detail = stderr.decode(errors="replace").strip()
        pytest.fail(f"Docker falló durante el restart smoke: {detail}")
    return stdout.decode(errors="replace").strip()


async def _wait_redis(redis_url: str) -> None:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    while True:
        client = Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        )
        try:
            if await client.ping():
                return
        except (OSError, TimeoutError, RedisError):
            pass
        finally:
            await client.aclose()
        if time.monotonic() >= deadline:
            pytest.fail("El Redis reiniciado no volvió a responder PONG.")
        await asyncio.sleep(0.05)


async def _bootstrap_ride(pg_test_db) -> _Bootstrap:
    sessions = async_sessionmaker[AsyncSession](
        pg_test_db.engine,
        expire_on_commit=False,
    )
    app = create_app(
        settings=Settings(
            _env_file=None,
            database_url=pg_test_db.url,
            jwt_secret=_JWT_SECRET,
            phone_otp_enabled=True,
        ),
        session_factory=sessions,
    )
    suffix = uuid.uuid4().hex
    async with network_support._serve(app) as base_url:
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=_OPERATION_TIMEOUT_SECONDS,
            trust_env=False,
        ) as client:
            rider_token = await network_support._register(client, f"redis-restart-rider-{suffix}")
            driver_label = f"redis-restart-driver-{suffix}"
            driver_token = await network_support._register(client, driver_label)
            await promote_to_driver(sessions, driver_label, VehicleType.TAXI)

            response = await client.post(
                "/api/v1/rides",
                headers=network_support._headers(rider_token),
                json={
                    "origin": {
                        "latitude": -16.5,
                        "longitude": -68.13,
                        "name": "Origen restart Redis",
                        "address": "Dirección restart Redis 1",
                    },
                    "destination": {
                        "latitude": -16.49,
                        "longitude": -68.14,
                        "name": "Destino restart Redis",
                        "address": "Dirección restart Redis 2",
                    },
                    "service_type": "taxi",
                    "fare": "25.00",
                    "payment_method": "cash",
                },
            )
            assert response.status_code == 201, response.text
            return _Bootstrap(
                rider_token=rider_token,
                driver_token=driver_token,
                ride_id=response.json()["id"],
            )


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
                    "La API terminó antes de readiness "
                    f"(exitcode={process.exitcode})."
                )
            try:
                response = await client.get("/health/ready")
                if response.status_code == 200:
                    checks = response.json()["checks"]
                    assert checks["database"] == "ok"
                    assert checks["realtime_outbox_dispatcher"] == "ok"
                    assert checks["realtime_redis_bridge"] == "ok"
                    return
            except httpx.HTTPError:
                pass
            if time.monotonic() >= deadline:
                pytest.fail("La API live_redis no alcanzó readiness.")
            await asyncio.sleep(0.05)


async def _wait_event(event, label: str) -> None:
    reached = await asyncio.to_thread(event.wait, _OPERATION_TIMEOUT_SECONDS)
    assert reached, f"No se alcanzó la compuerta {label}."


async def _load_offer_event(
    sessions: async_sessionmaker[AsyncSession],
    ride_id: str,
) -> _EventState:
    async with sessions() as session:
        row = (
            await session.scalars(
                select(RealtimeOutboxModel).where(
                    RealtimeOutboxModel.topic == f"ride:{ride_id}",
                    RealtimeOutboxModel.event_type == "offer_created",
                )
            )
        ).one()
        return _EventState(
            event_id=row.id,
            batch_id=row.batch_id,
            sequence=row.sequence,
            stream_version=row.stream_version,
            attempts=row.attempts,
            published=row.published_at is not None,
            last_error=row.last_error,
        )


async def _wait_event_state(
    sessions: async_sessionmaker[AsyncSession],
    ride_id: str,
    *,
    attempts: int,
    published: bool,
) -> _EventState:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    while True:
        state = await _load_offer_event(sessions, ride_id)
        if state.attempts >= attempts and state.published is published:
            return state
        if time.monotonic() >= deadline:
            pytest.fail("La outbox no alcanzó el estado durable esperado.")
        await asyncio.sleep(0.05)


async def _stop_process(process, shutdown) -> None:
    if process.is_alive():
        shutdown.set()
        await asyncio.to_thread(process.join, 8)
    if process.is_alive():
        process.kill()
        await asyncio.to_thread(process.join, 5)
    assert process.exitcode == 0
    process.close()


async def test_restart_redis_reintenta_la_misma_identidad_durable(pg_test_db) -> None:
    if os.name != "posix":
        pytest.skip("El smoke de restart usa sockets heredados y requiere POSIX.")
    redis_url = os.getenv("VIAJAYA_TEST_REDIS_RESTART_URL")
    container = os.getenv("VIAJAYA_TEST_REDIS_RESTART_CONTAINER")
    if not redis_url or not container:
        pytest.skip(
            "Define VIAJAYA_TEST_REDIS_RESTART_URL y "
            "VIAJAYA_TEST_REDIS_RESTART_CONTAINER para el smoke destructivo."
        )
    _validate_restart_target(
        redis_url,
        container,
        allow_development_container=(
            os.getenv("VIAJAYA_TEST_REDIS_RESTART_ALLOW_DEVELOPMENT") == "true"
        ),
    )
    running = await _docker("inspect", "--format={{.State.Running}}", container)
    assert running == "true", "El Redis dedicado debe comenzar sano."
    await _wait_redis(redis_url)

    bootstrap = await _bootstrap_ride(pg_test_db)
    sessions = async_sessionmaker[AsyncSession](
        pg_test_db.engine,
        expire_on_commit=False,
    )
    listener, base_url = _listener()
    context = multiprocessing.get_context("spawn")
    shutdown = context.Event()
    first_reached = context.Event()
    first_release = context.Event()
    first_failed = context.Event()
    replay_reached = context.Event()
    replay_release = context.Event()
    replay_published = context.Event()
    process = context.Process(
        target=run_redis_restart_server_process,
        args=(
            listener,
            pg_test_db.url,
            redis_url,
            f"viajaya:test:restart:{uuid.uuid4()}",
            _JWT_SECRET,
            bootstrap.ride_id,
            shutdown,
            first_reached,
            first_release,
            first_failed,
            replay_reached,
            replay_release,
            replay_published,
        ),
        name="viajaya-redis-restart-smoke",
    )
    process.start()
    redis_stopped = False
    business_cleaned = False
    try:
        await _wait_ready(base_url, process)
        rider_ws_url = base_url.replace("http://", "ws://") + (
            f"/api/v1/ws/rides/{bootstrap.ride_id}"
        )
        async with (
            httpx.AsyncClient(
                base_url=base_url,
                timeout=_OPERATION_TIMEOUT_SECONDS,
                trust_env=False,
            ) as client,
            websockets.connect(
                rider_ws_url,
                subprotocols=[AUTH_SUBPROTOCOL, bootstrap.rider_token],
                open_timeout=_FRAME_TIMEOUT_SECONDS,
                close_timeout=_FRAME_TIMEOUT_SECONDS,
                proxy=None,
                compression=None,
            ) as websocket,
        ):
            initial = RideSnapshotMessageV2.model_validate(
                await network_support._receive_json(websocket)
            )
            assert initial.data.ride.id == uuid.UUID(bootstrap.ride_id)

            offer = await client.post(
                f"/api/v1/rides/{bootstrap.ride_id}/offers",
                headers=network_support._headers(bootstrap.driver_token),
                json={"accept_at_fare": True, "eta_min": 4},
            )
            assert offer.status_code == 201, offer.text
            await _wait_event(first_reached, "antes del primer publish")

            await _docker("stop", "--time=0", container)
            redis_stopped = True
            first_release.set()
            await _wait_event(first_failed, "publish fallido")
            failed = await _wait_event_state(
                sessions,
                bootstrap.ride_id,
                attempts=1,
                published=False,
            )
            assert failed.last_error not in {None, "RuntimeError"}

            with pytest.raises(ConnectionClosedError) as captured:
                async with asyncio.timeout(_FRAME_TIMEOUT_SECONDS):
                    await websocket.recv()
            assert captured.value.rcvd is not None
            assert captured.value.rcvd.code == 1012

            await _docker("start", container)
            redis_stopped = False
            await _wait_redis(redis_url)
            await _wait_event(replay_reached, "replay después del restart")
            await _wait_ready(base_url, process)

            async with websockets.connect(
                rider_ws_url,
                subprotocols=[AUTH_SUBPROTOCOL, bootstrap.rider_token],
                open_timeout=_FRAME_TIMEOUT_SECONDS,
                close_timeout=_FRAME_TIMEOUT_SECONDS,
                proxy=None,
                compression=None,
            ) as reconnected:
                snapshot = RideSnapshotMessageV2.model_validate(
                    await network_support._receive_json(reconnected)
                )
                assert [item.id for item in snapshot.data.offers] == [
                    uuid.UUID(offer.json()["id"])
                ]
                replay_release.set()
                replay = RealtimeEventEnvelopeV2.model_validate(
                    await network_support._receive_json(reconnected)
                )
                assert replay.event_id == failed.event_id
                assert replay.batch_id == failed.batch_id
                assert replay.sequence == failed.sequence
                assert replay.stream_version == failed.stream_version
                assert replay.data["id"] == offer.json()["id"]

            await _wait_event(replay_published, "publish recuperado")
            recovered = await _wait_event_state(
                sessions,
                bootstrap.ride_id,
                attempts=2,
                published=True,
            )
            assert recovered.event_id == failed.event_id
            assert recovered.batch_id == failed.batch_id
            assert recovered.last_error is None

            cancelled = await client.post(
                f"/api/v1/rides/{bootstrap.ride_id}/cancel",
                headers=network_support._headers(bootstrap.rider_token),
            )
            assert cancelled.status_code == 200, cancelled.text
            offline = await client.post(
                "/api/v1/drivers/me/online",
                headers=network_support._headers(bootstrap.driver_token),
                json={"is_online": False},
            )
            assert offline.status_code == 200, offline.text
            await network_support._wait_until_drained(client)
            business_cleaned = True
    finally:
        first_release.set()
        replay_release.set()
        if redis_stopped:
            await _docker("start", container)
            await _wait_redis(redis_url)
        await _stop_process(process, shutdown)
        listener.close()
        if not business_cleaned:
            # El teardown Alembic elimina el estado propio. La prioridad aquí es
            # dejar Redis y el proceso hijo recuperados aun si falla el escenario.
            pass
