"""Crash/restart real en las dos ventanas críticas de la outbox realtime."""

from __future__ import annotations

import asyncio
import multiprocessing
import os
import signal
import socket
import time
import uuid
from dataclasses import dataclass
from datetime import datetime

import httpx
import pytest
import websockets
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from websockets.exceptions import ConnectionClosedError

from app.api.v1.schemas.realtime import (
    RealtimeEventEnvelopeV2,
    RideSnapshotMessageV2,
)
from app.domain.entities import VehicleType
from app.infrastructure.config import Settings
from app.infrastructure.db.advisory_lock import (
    LiveLocalProcessLockUnavailableError,
    PostgreSQLLiveLocalProcessLock,
)
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from app.main import create_app
from tests.e2e.helpers import promote_to_driver
from tests.postgresql import test_pg_realtime_network_smoke as network_support
from tests.postgresql.realtime_crash_support import (
    CrashWindow,
    RealtimeDispatchMode,
    run_realtime_server_process,
)

_FRAME_TIMEOUT_SECONDS = 5.0
_OPERATION_TIMEOUT_SECONDS = 20.0
_JWT_SECRET = "crash-smoke-only-secret-not-for-production"


@dataclass(frozen=True, slots=True)
class _Bootstrap:
    rider_token: str
    driver_token: str
    ride_id: str


@dataclass(frozen=True, slots=True)
class _OutboxEventState:
    id: uuid.UUID
    batch_id: uuid.UUID
    sequence: int
    stream_version: int
    published_at: datetime | None
    quarantined_at: datetime | None
    attempts: int
    last_error: str | None


def _listener() -> tuple[socket.socket, str]:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    port = listener.getsockname()[1]
    return listener, f"http://127.0.0.1:{port}"


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
            realtime_outbox_dispatch_mode="off",
            realtime_outbox_recording_enabled=False,
            realtime_outbox_published_retention_days=0,
        ),
        session_factory=sessions,
    )
    suffix = uuid.uuid4().hex
    async with network_support._serve(app) as base_url:
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=_OPERATION_TIMEOUT_SECONDS,
        ) as client:
            rider_token = await network_support._register(client, f"crash-rider-{suffix}")
            driver_label = f"crash-driver-{suffix}"
            driver_token = await network_support._register(client, driver_label)
            await promote_to_driver(sessions, driver_label, VehicleType.TAXI)

            response = await client.post(
                "/api/v1/rides",
                headers=network_support._headers(rider_token),
                json={
                    "origin": {
                        "latitude": -16.5,
                        "longitude": -68.13,
                        "name": "Origen crash smoke",
                        "address": "Dirección crash smoke 1",
                    },
                    "destination": {
                        "latitude": -16.49,
                        "longitude": -68.14,
                        "name": "Destino crash smoke",
                        "address": "Dirección crash smoke 2",
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


async def _wait_ready(
    base_url: str,
    process,
    dispatch_mode: RealtimeDispatchMode,
) -> None:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    async with httpx.AsyncClient(
        base_url=base_url,
        timeout=1,
        trust_env=False,
    ) as client:
        while True:
            if process.exitcode is not None:
                pytest.fail(
                    "El proceso Uvicorn terminó antes de readiness "
                    f"(exitcode={process.exitcode})."
                )
            try:
                response = await client.get("/health/ready")
                if response.status_code == 200:
                    payload = response.json()
                    assert payload["status"] == "ok"
                    assert payload["checks"]["database"] == "ok"
                    assert payload["checks"]["realtime_outbox_dispatcher"] == "ok"
                    assert payload["checks"]["realtime_outbox_process_lock"] == "ok"
                    if dispatch_mode == "live_redis":
                        assert payload["checks"]["realtime_redis_bridge"] == "ok"
                    return
            except httpx.HTTPError:
                pass
            if time.monotonic() >= deadline:
                pytest.fail("El proceso Uvicorn no alcanzó readiness.")
            await asyncio.sleep(0.02)


async def _wait_event(event, label: str) -> None:
    reached = await asyncio.to_thread(
        event.wait,
        _OPERATION_TIMEOUT_SECONDS,
    )
    assert reached, f"No se alcanzó la compuerta {label}."


async def _join(process, *, expected_exitcode: int) -> None:
    await asyncio.to_thread(process.join, _OPERATION_TIMEOUT_SECONDS)
    if process.is_alive():
        process.kill()
        await asyncio.to_thread(process.join, 5)
        pytest.fail("El proceso hijo no terminó dentro del deadline.")
    assert process.exitcode == expected_exitcode


async def _stop_process(process, shutdown=None) -> int | None:
    if process is None:
        return None
    if process.is_alive():
        if shutdown is not None:
            shutdown.set()
        else:
            process.terminate()
        await asyncio.to_thread(process.join, 5)
    if process.is_alive():
        process.kill()
        await asyncio.to_thread(process.join, 5)
    exitcode = process.exitcode
    process.close()
    return exitcode


def _start_process(
    context,
    listener: socket.socket,
    pg_test_db,
    bootstrap: _Bootstrap,
    *,
    mode: str,
    shutdown,
    reached,
    release,
    crash_window: CrashWindow | None = None,
    dispatch_mode: RealtimeDispatchMode = "live_local",
    event: _OutboxEventState | None = None,
    published=None,
    redis_url: str | None = None,
    redis_channel: str | None = None,
):
    process = context.Process(
        target=run_realtime_server_process,
        args=(
            listener,
            pg_test_db.url,
            _JWT_SECRET,
            bootstrap.ride_id,
            shutdown,
            mode,
            reached,
            release,
        ),
        kwargs={
            "crash_window": crash_window,
            "dispatch_mode": dispatch_mode,
            "event_id": str(event.id) if event is not None else None,
            "batch_id": str(event.batch_id) if event is not None else None,
            "published": published,
            "redis_url": redis_url,
            "redis_channel": redis_channel,
        },
        name=f"realtime-{dispatch_mode}-{mode}-smoke",
    )
    process.start()
    return process


async def _load_offer_event(
    sessions: async_sessionmaker[AsyncSession],
    ride_id: str,
    *,
    for_update: bool = False,
) -> _OutboxEventState:
    statement = select(RealtimeOutboxModel).where(
        RealtimeOutboxModel.topic == f"ride:{ride_id}",
        RealtimeOutboxModel.event_type == "offer_created",
    )
    if for_update:
        statement = statement.with_for_update()
    async with sessions() as session:
        event = (await session.scalars(statement)).one()
        state = _OutboxEventState(
            id=event.id,
            batch_id=event.batch_id,
            sequence=event.sequence,
            stream_version=event.stream_version,
            published_at=event.published_at,
            quarantined_at=event.quarantined_at,
            attempts=event.attempts,
            last_error=event.last_error,
        )
        if for_update:
            await session.rollback()
        return state


async def _wait_published(
    sessions: async_sessionmaker[AsyncSession],
    ride_id: str,
) -> _OutboxEventState:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    while True:
        event = await _load_offer_event(sessions, ride_id)
        if event.published_at is not None:
            return event
        if time.monotonic() >= deadline:
            pytest.fail("El replay no confirmó published_at.")
        await asyncio.sleep(0.02)


async def _assert_process_locks_released(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    while True:
        process_lock = PostgreSQLLiveLocalProcessLock(sessions)
        try:
            acquired = await process_lock.acquire()
        except LiveLocalProcessLockUnavailableError:
            if time.monotonic() >= deadline:
                pytest.fail("PostgreSQL no liberó el advisory lock tras SIGKILL.")
            await asyncio.sleep(0.02)
            continue
        assert acquired is True
        await process_lock.release()
        return


async def _connect_snapshot(
    base_url: str,
    bootstrap: _Bootstrap,
) -> tuple[object, RideSnapshotMessageV2]:
    websocket_url = base_url.replace("http://", "ws://") + (
        f"/api/v1/ws/rides/{bootstrap.ride_id}"
    )
    websocket = await websockets.connect(
        websocket_url,
        subprotocols=[AUTH_SUBPROTOCOL, bootstrap.rider_token],
        open_timeout=_FRAME_TIMEOUT_SECONDS,
        close_timeout=_FRAME_TIMEOUT_SECONDS,
        proxy=None,
        compression=None,
    )
    assert websocket.subprotocol == AUTH_SUBPROTOCOL
    snapshot = RideSnapshotMessageV2.model_validate(
        await network_support._receive_json(websocket)
    )
    assert snapshot.data.ride.id == uuid.UUID(bootstrap.ride_id)
    assert snapshot.watermarks[0].stream == f"ride:{bootstrap.ride_id}"
    return websocket, snapshot


async def _cleanup_business(
    client: httpx.AsyncClient,
    bootstrap: _Bootstrap,
) -> None:
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


async def _fallback_cleanup_business(pg_test_db, bootstrap: _Bootstrap) -> None:
    """Limpia estado propio aun si ninguna instancia live sobrevivió al fallo."""
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
            realtime_outbox_dispatch_mode="off",
            realtime_outbox_recording_enabled=False,
            realtime_outbox_published_retention_days=0,
        ),
        session_factory=sessions,
    )
    async with network_support._serve(app) as base_url:
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=_OPERATION_TIMEOUT_SECONDS,
            trust_env=False,
        ) as client:
            await client.post(
                f"/api/v1/rides/{bootstrap.ride_id}/cancel",
                headers=network_support._headers(bootstrap.rider_token),
            )
            await client.post(
                "/api/v1/drivers/me/online",
                headers=network_support._headers(bootstrap.driver_token),
                json={"is_online": False},
            )


async def _exercise_crash_window(
    pg_test_db,
    window: CrashWindow,
    dispatch_mode: RealtimeDispatchMode,
) -> None:
    if os.name != "posix":
        pytest.skip("El smoke de SIGKILL y socket heredado requiere POSIX.")
    redis_url: str | None = None
    redis_channel: str | None = None
    if dispatch_mode == "live_redis":
        redis_url = os.getenv("VIAJAYA_TEST_REDIS_URL")
        if not redis_url:
            pytest.skip("Define VIAJAYA_TEST_REDIS_URL para certificar el crash live_redis.")
        redis_channel = f"viajaya:test:crash:{uuid.uuid4().hex}"
    sessions = async_sessionmaker[AsyncSession](
        pg_test_db.engine,
        expire_on_commit=False,
    )
    bootstrap = await _bootstrap_ride(pg_test_db)
    listener, base_url = _listener()
    context = multiprocessing.get_context("spawn")
    crash_reached = context.Event()
    crash_release = context.Event()
    crash_shutdown = context.Event()
    recovery_reached = context.Event()
    recovery_release = context.Event()
    recovery_published = context.Event()
    recovery_shutdown = context.Event()
    crash_process = None
    recovery_process = None
    first_websocket = None
    recovery_websocket = None
    first_raw: dict[str, object] | None = None
    business_cleaned = False
    try:
        crash_process = _start_process(
            context,
            listener,
            pg_test_db,
            bootstrap,
            mode="crash",
            shutdown=crash_shutdown,
            reached=crash_reached,
            release=crash_release,
            crash_window=window,
            dispatch_mode=dispatch_mode,
            redis_url=redis_url,
            redis_channel=redis_channel,
        )
        await _wait_ready(base_url, crash_process, dispatch_mode)
        first_websocket, initial = await _connect_snapshot(base_url, bootstrap)
        initial_watermark = initial.watermarks[0].stream_version

        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=_OPERATION_TIMEOUT_SECONDS,
            trust_env=False,
        ) as first_client:
            await network_support._wait_until_drained(first_client)
            offer = await first_client.post(
                f"/api/v1/rides/{bootstrap.ride_id}/offers",
                headers=network_support._headers(bootstrap.driver_token),
                json={"accept_at_fare": True, "eta_min": 4},
            )
            assert offer.status_code == 201, offer.text
            await _wait_event(crash_reached, f"crash {window}")
            if window == "after_publish":
                first_raw = await network_support._receive_json(first_websocket)
                first_event = RealtimeEventEnvelopeV2.model_validate(first_raw)
                assert first_event.type == "offer_created"
                assert first_event.data["id"] == offer.json()["id"]

        durable = await _load_offer_event(sessions, bootstrap.ride_id)
        assert durable.published_at is None
        assert durable.quarantined_at is None
        assert durable.attempts == 0
        assert durable.stream_version == initial_watermark + 1

        crash_process.kill()
        await _join(crash_process, expected_exitcode=-signal.SIGKILL)
        with pytest.raises(ConnectionClosedError) as closed:
            async with asyncio.timeout(_FRAME_TIMEOUT_SECONDS):
                await first_websocket.recv()
        assert closed.value.rcvd is None
        assert first_websocket.close_code == 1006
        await _assert_process_locks_released(sessions)
        async with asyncio.timeout(_OPERATION_TIMEOUT_SECONDS):
            unlocked = await _load_offer_event(
                sessions,
                bootstrap.ride_id,
                for_update=True,
            )
        assert unlocked.id == durable.id
        assert unlocked.published_at is None
        assert unlocked.attempts == 0

        recovery_process = _start_process(
            context,
            listener,
            pg_test_db,
            bootstrap,
            mode="recovery",
            shutdown=recovery_shutdown,
            reached=recovery_reached,
            release=recovery_release,
            dispatch_mode=dispatch_mode,
            event=unlocked,
            published=recovery_published,
            redis_url=redis_url,
            redis_channel=redis_channel,
        )
        await _wait_ready(base_url, recovery_process, dispatch_mode)
        await _wait_event(recovery_reached, "recovery before_publish")
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=_OPERATION_TIMEOUT_SECONDS,
            trust_env=False,
        ) as recovery_client:
            if window == "before_publish":
                # La recuperación publica con el hub vacío. El cliente llega
                # después y debe converger únicamente con su snapshot.
                recovery_release.set()
                await _wait_event(recovery_published, "recovery published")
                await network_support._wait_until_drained(recovery_client)
                published = await _wait_published(sessions, bootstrap.ride_id)
                recovery_websocket, recovered_snapshot = await _connect_snapshot(
                    base_url,
                    bootstrap,
                )
            else:
                # En la ventana posterior a publish sí conservamos un socket
                # para comprobar que el retry repite el envelope exacto.
                recovery_websocket, recovered_snapshot = await _connect_snapshot(
                    base_url,
                    bootstrap,
                )
                recovery_release.set()
                replay_raw = await network_support._receive_json(recovery_websocket)
                replay = RealtimeEventEnvelopeV2.model_validate(replay_raw)
                assert replay.event_id == durable.id
                assert replay.batch_id == durable.batch_id
                assert replay.sequence == durable.sequence == 0
                assert replay.stream_version == durable.stream_version
                assert replay.data["id"] == offer.json()["id"]
                assert first_raw is not None
                assert replay_raw == first_raw
                await _wait_event(recovery_published, "recovery published")
                await network_support._wait_until_drained(recovery_client)
                published = await _wait_published(sessions, bootstrap.ride_id)

            assert recovered_snapshot.snapshot_id != initial.snapshot_id
            assert [item.id for item in recovered_snapshot.data.offers] == [
                uuid.UUID(offer.json()["id"])
            ]
            assert (
                recovered_snapshot.watermarks[0].stream_version
                == durable.stream_version
            )
            await network_support._wait_until_drained(recovery_client)
            assert published.id == durable.id
            assert published.batch_id == durable.batch_id
            assert published.published_at is not None
            assert published.quarantined_at is None
            assert published.last_error is None
            assert published.attempts == 1

            await recovery_websocket.close()
            recovery_websocket = None
            final_websocket, final_snapshot = await _connect_snapshot(
                base_url,
                bootstrap,
            )
            try:
                assert final_snapshot.snapshot_id != recovered_snapshot.snapshot_id
                assert [item.id for item in final_snapshot.data.offers] == [
                    uuid.UUID(offer.json()["id"])
                ]
                assert (
                    final_snapshot.watermarks[0].stream_version
                    == durable.stream_version
                )
            finally:
                await final_websocket.close()

            await _cleanup_business(recovery_client, bootstrap)
            business_cleaned = True
            recovery_exitcode = await _stop_process(
                recovery_process,
                recovery_shutdown,
            )
            recovery_process = None
            assert recovery_exitcode == 0
            await _assert_process_locks_released(sessions)
    finally:
        if first_websocket is not None:
            try:
                await first_websocket.close()
            except Exception:  # noqa: BLE001 - el proceso murió sin close frame
                pass
        if recovery_websocket is not None:
            try:
                await recovery_websocket.close()
            except Exception:  # noqa: BLE001 - cleanup best-effort del smoke
                pass
        await _stop_process(crash_process, crash_shutdown)
        await _stop_process(recovery_process, recovery_shutdown)
        listener.close()
        if not business_cleaned:
            try:
                await _fallback_cleanup_business(pg_test_db, bootstrap)
            except Exception:  # noqa: BLE001 - no oculta el fallo primario
                pass


@pytest.mark.parametrize("dispatch_mode", ["live_local", "live_redis"])
async def test_crash_tras_commit_antes_de_publicar_no_pierde_evento(
    pg_test_db,
    dispatch_mode: RealtimeDispatchMode,
) -> None:
    await _exercise_crash_window(pg_test_db, "before_publish", dispatch_mode)


@pytest.mark.parametrize("dispatch_mode", ["live_local", "live_redis"])
async def test_crash_tras_publicar_reentrega_identidad_exacta(
    pg_test_db,
    dispatch_mode: RealtimeDispatchMode,
) -> None:
    await _exercise_crash_window(pg_test_db, "after_publish", dispatch_mode)
