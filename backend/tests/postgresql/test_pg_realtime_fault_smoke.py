"""Fallos one-shot realtime sobre PostgreSQL, Uvicorn y WebSocket TCP reales."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import httpx
import pytest
import websockets
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from websockets.exceptions import ConnectionClosedError

from app.api.v1 import presence
from app.api.v1.realtime_outbox import (
    CanonicalRealtimeOutboxBatchValidator,
    LocalHubRealtimeOutboxBatchPublisher,
)
from app.api.v1.routers import rides as rides_router
from app.api.v1.schemas.realtime import (
    RealtimeEventEnvelopeV2,
    RideSnapshotMessageV2,
)
from app.domain.entities import VehicleType
from app.infrastructure.config import Settings
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.realtime.hub import hub
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL
from app.main import create_app
from scripts.realtime_faults import (
    FaultInjectingRealtimeOutboxBatchPublisher,
    FaultInjectingRealtimeOutboxBatchValidator,
    RealtimeFaultAction,
    RealtimeFaultController,
    RealtimeFaultPlan,
)
from tests.e2e.helpers import promote_to_driver
from tests.postgresql import test_pg_realtime_network_smoke as network_support

_FRAME_TIMEOUT_SECONDS = 5.0
_OPERATION_TIMEOUT_SECONDS = 20.0


@dataclass(slots=True)
class _FaultScenario:
    client: httpx.AsyncClient
    sessions: async_sessionmaker[AsyncSession]
    rider_token: str
    driver_token: str
    ride_id: str | None = None
    created_ride_ids: list[str] = field(default_factory=list)

    async def create_ride(self) -> tuple[str, str]:
        assert self.ride_id is None
        response = await self.client.post(
            "/api/v1/rides",
            headers=network_support._headers(self.rider_token),
            json={
                "origin": {
                    "latitude": -16.5,
                    "longitude": -68.13,
                    "name": "Origen fault smoke",
                    "address": "Dirección fault smoke 1",
                },
                "destination": {
                    "latitude": -16.49,
                    "longitude": -68.14,
                    "name": "Destino fault smoke",
                    "address": "Dirección fault smoke 2",
                },
                "service_type": "taxi",
                "fare": "25.00",
                "payment_method": "cash",
            },
        )
        assert response.status_code == 201, response.text
        self.ride_id = response.json()["id"]
        self.created_ride_ids.append(self.ride_id)
        websocket_url = str(self.client.base_url).replace("http://", "ws://") + (
            f"api/v1/ws/rides/{self.ride_id}"
        )
        return self.ride_id, websocket_url

    async def create_offer(self) -> httpx.Response:
        assert self.ride_id is not None
        response = await self.client.post(
            f"/api/v1/rides/{self.ride_id}/offers",
            headers=network_support._headers(self.driver_token),
            json={"accept_at_fare": True, "eta_min": 4},
        )
        assert response.status_code == 201, response.text
        return response

    async def cancel_ride(self) -> None:
        assert self.ride_id is not None
        response = await self.client.post(
            f"/api/v1/rides/{self.ride_id}/cancel",
            headers=network_support._headers(self.rider_token),
        )
        assert response.status_code == 200, response.text
        self.ride_id = None
        await network_support._wait_until_drained(self.client)


def _fault_app(pg_test_db):
    sessions = async_sessionmaker[AsyncSession](
        pg_test_db.engine,
        expire_on_commit=False,
    )
    settings = Settings(
        _env_file=None,
        database_url=pg_test_db.url,
        jwt_secret="fault-smoke-only-secret-not-for-production",
        phone_otp_enabled=True,
        realtime_outbox_dispatch_mode="live_local",
        realtime_outbox_recording_enabled=True,
        realtime_outbox_poll_interval_seconds=0.01,
        realtime_outbox_shutdown_timeout_seconds=2,
    )
    controller = RealtimeFaultController()
    validator = FaultInjectingRealtimeOutboxBatchValidator(
        CanonicalRealtimeOutboxBatchValidator(),
        controller,
    )
    publisher = FaultInjectingRealtimeOutboxBatchPublisher(
        LocalHubRealtimeOutboxBatchPublisher(),
        controller,
        hub.broadcast_versioned,
    )
    app = create_app(
        settings=settings,
        session_factory=sessions,
        realtime_outbox_batch_validator=validator,
        realtime_outbox_batch_publisher=publisher,
    )
    return app, sessions, controller


@asynccontextmanager
async def _scenario(app, sessions) -> AsyncIterator[_FaultScenario]:
    suffix = uuid.uuid4().hex
    async with network_support._serve(app) as base_url:
        async with httpx.AsyncClient(
            base_url=f"{base_url}/",
            timeout=_OPERATION_TIMEOUT_SECONDS,
        ) as client:
            ready = await client.get("/health/ready")
            assert ready.status_code == 200, ready.text
            rider_token = await network_support._register(client, f"fault-rider-{suffix}")
            driver_label = f"fault-driver-{suffix}"
            driver_token = await network_support._register(client, driver_label)
            await promote_to_driver(sessions, driver_label, VehicleType.TAXI)

            scenario = _FaultScenario(
                client=client,
                sessions=sessions,
                rider_token=rider_token,
                driver_token=driver_token,
            )
            primary_error: BaseException | None = None
            try:
                yield scenario
            except BaseException as error:
                primary_error = error
                raise
            finally:
                cleanup_errors: list[str] = []
                if scenario.ride_id is not None:
                    cancelled = await client.post(
                        f"/api/v1/rides/{scenario.ride_id}/cancel",
                        headers=network_support._headers(rider_token),
                    )
                    if cancelled.status_code != 200:
                        cleanup_errors.append(
                            f"cancel devolvió {cancelled.status_code}"
                        )
                offline = await client.post(
                    "/api/v1/drivers/me/online",
                    headers=network_support._headers(driver_token),
                    json={"is_online": False},
                )
                if offline.status_code != 200:
                    cleanup_errors.append(f"offline devolvió {offline.status_code}")
                try:
                    await network_support._wait_until_drained(client)
                except BaseException as error:
                    cleanup_errors.append(f"drenado falló: {type(error).__name__}")
                for ride_id in scenario.created_ride_ids:
                    try:
                        await _delete_test_quarantines(sessions, ride_id)
                    except BaseException as error:
                        cleanup_errors.append(
                            "limpieza de cuarentena falló: "
                            f"{type(error).__name__}"
                        )
                if cleanup_errors and primary_error is None:
                    pytest.fail("; ".join(cleanup_errors))


def _connect(websocket_url: str, token: str):
    return websockets.connect(
        websocket_url,
        subprotocols=[AUTH_SUBPROTOCOL, token],
        open_timeout=_FRAME_TIMEOUT_SECONDS,
        close_timeout=_FRAME_TIMEOUT_SECONDS,
        proxy=None,
        compression=None,
    )


def _arm(
    controller: RealtimeFaultController,
    action: RealtimeFaultAction,
    ride_id: str,
) -> None:
    controller.arm(
        RealtimeFaultPlan(
            action=action,
            event_type="offer_created",
            topic=f"ride:{ride_id}",
        )
    )


async def _outbox_events(
    sessions: async_sessionmaker[AsyncSession],
    ride_id: str,
) -> list[RealtimeOutboxModel]:
    async with sessions() as session:
        result = await session.scalars(
            select(RealtimeOutboxModel)
            .where(RealtimeOutboxModel.topic == f"ride:{ride_id}")
            .order_by(RealtimeOutboxModel.stream_version)
        )
        return list(result)


async def _delete_test_quarantines(
    sessions: async_sessionmaker[AsyncSession],
    ride_id: str,
) -> None:
    """Remove our ride's quarantines to allow the test downgrade."""
    async with sessions() as session:
        await session.execute(
            delete(RealtimeOutboxModel).where(
                RealtimeOutboxModel.topic == f"ride:{ride_id}",
                RealtimeOutboxModel.quarantined_at.is_not(None),
            )
        )
        await session.commit()


async def _initial_snapshot(websocket, ride_id: str) -> RideSnapshotMessageV2:
    assert websocket.subprotocol == AUTH_SUBPROTOCOL
    snapshot = RideSnapshotMessageV2.model_validate(
        await network_support._receive_json(websocket)
    )
    assert snapshot.data.ride.id == uuid.UUID(ride_id)
    assert snapshot.watermarks[0].stream == f"ride:{ride_id}"
    return snapshot


def _assert_fault_hit(controller: RealtimeFaultController) -> None:
    assert controller.plan is not None
    assert controller.plan.hit is True


def _assert_background_state_clean() -> None:
    assert not rides_router._EXPIRY_TASKS
    assert not presence._pending_cancels
    assert not presence._critical_cancels
    assert not presence._CANCEL_TASKS
    assert not presence._last_seen


async def test_duplicate_repite_identidad_y_snapshot_no_duplica_estado(
    pg_test_db,
) -> None:
    app, sessions, controller = _fault_app(pg_test_db)

    async with _scenario(app, sessions) as scenario:
        ride_id, websocket_url = await scenario.create_ride()
        async with _connect(websocket_url, scenario.rider_token) as websocket:
            initial = await _initial_snapshot(websocket, ride_id)
            watermark = initial.watermarks[0].stream_version
            _arm(controller, "duplicate", ride_id)
            offer = await scenario.create_offer()

            first_raw = await network_support._receive_json(websocket)
            second_raw = await network_support._receive_json(websocket)
            first = RealtimeEventEnvelopeV2.model_validate(first_raw)
            second = RealtimeEventEnvelopeV2.model_validate(second_raw)

            assert first_raw == second_raw
            assert first.event_id == second.event_id
            assert first.batch_id == second.batch_id
            assert first.sequence == second.sequence == 0
            assert first.stream_version == second.stream_version == watermark + 1
            assert first.type == second.type == "offer_created"
            assert first.data["id"] == second.data["id"] == offer.json()["id"]
            _assert_fault_hit(controller)

        async with _connect(websocket_url, scenario.rider_token) as reconnected:
            snapshot = await _initial_snapshot(reconnected, ride_id)
            assert snapshot.snapshot_id != initial.snapshot_id
            assert [item.id for item in snapshot.data.offers] == [
                uuid.UUID(offer.json()["id"])
            ]
            assert snapshot.watermarks[0].stream_version == watermark + 1

        events = await _outbox_events(sessions, ride_id)
        offer_events = [event for event in events if event.event_type == "offer_created"]
        assert len(offer_events) == 1
        assert offer_events[0].published_at is not None
        assert offer_events[0].quarantined_at is None
        assert offer_events[0].attempts == 1
        await scenario.cancel_ride()

    _assert_background_state_clean()


async def test_gap_omite_n_mas_uno_y_snapshot_recupera_n_mas_tres(
    pg_test_db,
) -> None:
    app, sessions, controller = _fault_app(pg_test_db)

    async with _scenario(app, sessions) as scenario:
        ride_id, websocket_url = await scenario.create_ride()
        async with _connect(websocket_url, scenario.rider_token) as websocket:
            initial = await _initial_snapshot(websocket, ride_id)
            watermark = initial.watermarks[0].stream_version
            _arm(controller, "gap", ride_id)
            first_offer = await scenario.create_offer()
            second_offer = await scenario.create_offer()

            first_visible = RealtimeEventEnvelopeV2.model_validate(
                await network_support._receive_json(websocket)
            )
            successor = RealtimeEventEnvelopeV2.model_validate(
                await network_support._receive_json(websocket)
            )
            assert first_visible.type == "offer_withdrawn"
            assert first_visible.stream_version == watermark + 2
            assert first_visible.data["offer_id"] == first_offer.json()["id"]
            assert first_visible.data["reason"] == "superseded"
            assert successor.type == "offer_created"
            assert successor.stream_version == watermark + 3
            assert successor.data["id"] == second_offer.json()["id"]
            _assert_fault_hit(controller)

        async with _connect(websocket_url, scenario.rider_token) as reconnected:
            snapshot = await _initial_snapshot(reconnected, ride_id)
            assert snapshot.snapshot_id != initial.snapshot_id
            assert [item.id for item in snapshot.data.offers] == [
                uuid.UUID(second_offer.json()["id"])
            ]
            assert snapshot.watermarks[0].stream_version == watermark + 3

        events = await _outbox_events(sessions, ride_id)
        assert [event.stream_version for event in events] == [
            watermark + 1,
            watermark + 2,
            watermark + 3,
        ]
        assert all(event.published_at is not None for event in events)
        assert all(event.quarantined_at is None for event in events)
        await scenario.cancel_ride()

    _assert_background_state_clean()


async def test_quarantine_cierra_1012_y_snapshot_salta_evento_terminal(
    pg_test_db,
) -> None:
    app, sessions, controller = _fault_app(pg_test_db)

    async with _scenario(app, sessions) as scenario:
        ride_id, websocket_url = await scenario.create_ride()
        before_health = (await scenario.client.get("/health/realtime")).json()
        before_invalid = next(
            (
                item["batch_count"]
                for item in before_health["quarantined_batches"]
                if item["code"] == "invalid_payload"
            ),
            0,
        )

        async with _connect(websocket_url, scenario.rider_token) as websocket:
            initial = await _initial_snapshot(websocket, ride_id)
            watermark = initial.watermarks[0].stream_version
            _arm(controller, "quarantine", ride_id)
            offer = await scenario.create_offer()

            with pytest.raises(ConnectionClosedError) as captured:
                async with asyncio.timeout(_FRAME_TIMEOUT_SECONDS):
                    await websocket.recv()
            assert captured.value.rcvd is not None
            assert captured.value.rcvd.code == 1012
            assert websocket.close_code == 1012
            _assert_fault_hit(controller)

        after_health = (await scenario.client.get("/health/realtime")).json()
        after_invalid = next(
            item["batch_count"]
            for item in after_health["quarantined_batches"]
            if item["code"] == "invalid_payload"
        )
        assert after_invalid == before_invalid + 1

        events = await _outbox_events(sessions, ride_id)
        offer_events = [event for event in events if event.event_type == "offer_created"]
        assert len(offer_events) == 1
        assert offer_events[0].published_at is None
        assert offer_events[0].quarantined_at is not None
        assert offer_events[0].quarantine_code == "invalid_payload"
        assert offer_events[0].attempts == 1

        async with _connect(websocket_url, scenario.rider_token) as reconnected:
            snapshot = await _initial_snapshot(reconnected, ride_id)
            assert snapshot.snapshot_id != initial.snapshot_id
            assert [item.id for item in snapshot.data.offers] == [
                uuid.UUID(offer.json()["id"])
            ]
            assert snapshot.watermarks[0].stream_version == watermark + 1

        await scenario.cancel_ride()

    _assert_background_state_clean()
