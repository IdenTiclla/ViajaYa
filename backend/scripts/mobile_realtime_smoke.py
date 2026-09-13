"""Runner interactivo para certificar realtime en un dev build móvil.

Arranca una API ``live_local`` sobre una base PostgreSQL desechable y conserva
los controles de fallo dentro del proceso. No agrega endpoints ni configuración
de corrupción al artefacto productivo.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import uvicorn
import websockets
from sqlalchemy import delete
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    LocalHubRealtimeOutboxBatchPublisher,
)
from app.domain.entities import UserRole, VehicleType
from app.infrastructure.config import Settings
from app.infrastructure.db.account_access import SqlAlchemyPhoneAccountRepository
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.db.repositories import SqlAlchemyUserRepository
from app.infrastructure.realtime.hub import hub
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from app.main import create_app
from scripts.phone_access import sign_in
from scripts.realtime_faults import (
    FaultInjectingRealtimeOutboxBatchPublisher,
    FaultInjectingRealtimeOutboxBatchValidator,
    RealtimeFaultAction,
    RealtimeFaultController,
    RealtimeFaultPlan,
)

_JWT_SECRET = "mobile-realtime-smoke-only-secret-not-for-production"
_OPERATION_TIMEOUT_SECONDS = 20.0


@dataclass(slots=True)
class OpenRide:
    ride_id: str
    rider_token: str
    websocket: Any


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inyecta fallos realtime one-shot para un dev build.",
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("VIAJAYA_TEST_DATABASE_URL"),
        help="URL postgresql+asyncpg de una base cuyo nombre sea test_* o *_test.",
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8002)
    return parser.parse_args()


def _validate_database_url(database_url: str | None) -> str:
    if not database_url:
        raise RuntimeError("Define VIAJAYA_TEST_DATABASE_URL o pasa --database-url.")
    parsed = make_url(database_url)
    database = parsed.database or ""
    if parsed.drivername != "postgresql+asyncpg":
        raise RuntimeError("El runner requiere postgresql+asyncpg.")
    if not (database.startswith("test_") or database.endswith("_test")):
        raise RuntimeError("La base desechable debe empezar por test_ o terminar en _test.")
    return database_url


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _smoke_phone() -> str:
    """Fresh Bolivian mobile number per run; the mock OTP accepts any number."""
    return f"+5917{uuid.uuid4().int % 10_000_000:07d}"


async def _wait_server(server: uvicorn.Server) -> None:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    while not server.started:
        if server.should_exit:
            raise RuntimeError("Uvicorn terminó antes de quedar listo.")
        if time.monotonic() >= deadline:
            raise TimeoutError("Uvicorn no quedó listo dentro del plazo.")
        await asyncio.sleep(0.05)


async def _wait_fault(controller: RealtimeFaultController) -> None:
    deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
    while True:
        plan = controller.plan
        if plan is not None and plan.hit:
            await asyncio.sleep(0.25)
            return
        if time.monotonic() >= deadline:
            raise TimeoutError("El fallo armado no encontró su evento objetivo.")
        await asyncio.sleep(0.02)


class MobileRealtimeSmoke:
    """Orquesta datos reales y fallos sin exponer controles por red."""

    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        controller: RealtimeFaultController,
        driver_token: str,
    ) -> None:
        self._client = client
        self._sessions = sessions
        self._controller = controller
        self._driver_token = driver_token
        self._rides: list[OpenRide] = []
        self._ride_ids: list[str] = []

    @property
    def plan(self) -> RealtimeFaultPlan | None:
        return self._controller.plan

    async def _create_announced_ride(
        self,
        *,
        arm: RealtimeFaultAction | None,
    ) -> OpenRide:
        rider_token = await sign_in(
            self._client, _smoke_phone(), full_name="Pasajero smoke realtime",
        )
        response = await self._client.post(
            "/api/v1/rides",
            headers=_headers(rider_token),
            json={
                "origin": {
                    "latitude": -16.5,
                    "longitude": -68.13,
                    "name": "Origen smoke móvil",
                    "address": "Dirección smoke móvil 1",
                },
                "destination": {
                    "latitude": -16.49,
                    "longitude": -68.14,
                    "name": "Destino smoke móvil",
                    "address": "Dirección smoke móvil 2",
                },
                "service_type": "taxi",
                "fare": "25.00",
                "payment_method": "cash",
            },
        )
        response.raise_for_status()
        ride_id = response.json()["id"]
        self._ride_ids.append(ride_id)

        if arm is not None:
            self._controller.arm(
                RealtimeFaultPlan(
                    action=arm,
                    event_type="ride_created",
                    topic="pool:taxi",
                )
            )

        websocket = await websockets.connect(
            f"ws://127.0.0.1:{self._client.base_url.port}/api/v1/ws/rides/{ride_id}",
            subprotocols=[AUTH_SUBPROTOCOL, rider_token],
            open_timeout=_OPERATION_TIMEOUT_SECONDS,
            close_timeout=5,
            proxy=None,
            compression=None,
        )
        await asyncio.wait_for(websocket.recv(), timeout=5)
        ride = OpenRide(
            ride_id=ride_id,
            rider_token=rider_token,
            websocket=websocket,
        )
        self._rides.append(ride)
        if arm is not None:
            await _wait_fault(self._controller)
        return ride

    async def inject(self, action: RealtimeFaultAction) -> None:
        if action == "gap":
            await self._create_announced_ride(arm="gap")
            await self._create_announced_ride(arm=None)
        else:
            await self._create_announced_ride(arm=action)

    async def close(self) -> None:
        for ride in self._rides:
            with contextlib.suppress(httpx.HTTPError):
                await self._client.post(
                    f"/api/v1/rides/{ride.ride_id}/cancel",
                    headers=_headers(ride.rider_token),
                )
            with contextlib.suppress(Exception):
                await ride.websocket.close()

        with contextlib.suppress(httpx.HTTPError):
            await self._client.post(
                "/api/v1/drivers/me/online",
                headers=_headers(self._driver_token),
                json={"is_online": False},
            )

        if self._ride_ids:
            async with self._sessions() as session:
                await session.execute(
                    delete(RealtimeOutboxModel).where(
                        RealtimeOutboxModel.topic == "pool:taxi",
                        RealtimeOutboxModel.event_type == "ride_created",
                        RealtimeOutboxModel.aggregate_id.in_(
                            [uuid.UUID(ride_id) for ride_id in self._ride_ids]
                        ),
                        RealtimeOutboxModel.quarantined_at.is_not(None),
                    )
                )
                await session.commit()


async def _interactive(smoke: MobileRealtimeSmoke) -> None:
    allowed: set[RealtimeFaultAction] = {
        "duplicate",
        "gap",
        "invalid_frame",
        "quarantine",
    }
    print(
        "\nComandos: duplicate | gap | invalid_frame | quarantine | status | quit",
        flush=True,
    )
    while True:
        raw = await asyncio.to_thread(input, "smoke> ")
        command = raw.strip().lower()
        if command in {"quit", "exit"}:
            return
        if command == "status":
            print(f"plan={smoke.plan!r}", flush=True)
            continue
        if command not in allowed:
            print("Comando desconocido.", flush=True)
            continue
        action = command
        print(f"Armando {action}...", flush=True)
        await smoke.inject(action)
        print(f"OK {action}: fallo consumido por el dispatcher.", flush=True)


async def _run(args: argparse.Namespace) -> None:
    database_url = _validate_database_url(args.database_url)
    engine = create_async_engine(database_url, poolclass=NullPool)
    sessions = async_sessionmaker[AsyncSession](engine, expire_on_commit=False)
    controller = RealtimeFaultController()
    settings = Settings(
        _env_file=None,
        database_url=database_url,
        jwt_secret=_JWT_SECRET,
        phone_otp_enabled=True,
        realtime_outbox_dispatch_mode="live_local",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=0.01,
        realtime_outbox_shutdown_timeout_seconds=2,
        realtime_outbox_published_retention_days=0,
    )
    app = create_app(
        settings=settings,
        session_factory=sessions,
        realtime_outbox_batch_validator=FaultInjectingRealtimeOutboxBatchValidator(
            CanonicalRealtimeOutboxBatchValidator(),
            controller,
        ),
        realtime_outbox_batch_publisher=FaultInjectingRealtimeOutboxBatchPublisher(
            LocalHubRealtimeOutboxBatchPublisher(),
            controller,
            hub.broadcast_versioned,
        ),
    )
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=args.host,
            port=args.port,
            log_level="warning",
            access_log=False,
            lifespan="on",
        )
    )
    server_task = asyncio.create_task(server.serve(), name="mobile-realtime-smoke")
    try:
        await _wait_server(server)
        async with httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{args.port}",
            timeout=_OPERATION_TIMEOUT_SECONDS,
            trust_env=False,
        ) as client:
            ready = await client.get("/health/ready")
            ready.raise_for_status()
            driver_phone = _smoke_phone()
            driver_token = await sign_in(
                client, driver_phone, full_name="Conductor smoke realtime",
            )
            async with sessions() as session:
                users = SqlAlchemyUserRepository(session)
                driver = await SqlAlchemyPhoneAccountRepository(session).find_by_phone(driver_phone)
                assert driver is not None
                driver.role = UserRole.DRIVER
                driver.vehicle_type = VehicleType.TAXI
                driver.is_online = True
                await users.update(driver)

            smoke = MobileRealtimeSmoke(
                client=client,
                sessions=sessions,
                controller=controller,
                driver_token=driver_token,
            )
            print(
                f"\nAPI del emulador: http://10.0.2.2:{args.port}/api/v1",
                flush=True,
            )
            print(f"Teléfono del conductor: {driver_phone} (OTP simulado)", flush=True)
            print(
                "Inicia sesión en el dev build y espera snapshot_applied antes de inyectar.",
                flush=True,
            )
            try:
                await _interactive(smoke)
            finally:
                await smoke.close()
    finally:
        server.should_exit = True
        await asyncio.gather(server_task, return_exceptions=True)
        await engine.dispose()


def main() -> None:
    args = _arguments()
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
