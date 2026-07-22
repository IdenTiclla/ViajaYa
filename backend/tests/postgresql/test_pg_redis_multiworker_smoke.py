"""Gate de seguridad: live_redis sigue limitado a un proceso API."""

from __future__ import annotations

import asyncio
import multiprocessing
import os
import socket
import time
import uuid

import httpx
import pytest

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
