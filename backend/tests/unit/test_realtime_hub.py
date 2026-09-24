"""Delivery order between WebSocket snapshots and concurrent events."""

from __future__ import annotations

import asyncio

from app.infrastructure.realtime.hub import RealtimeHub


class _RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []
        self.closed_with: list[int] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)

    async def close(self, code: int) -> None:
        self.closed_with.append(code)


class _FailingSocket(_RecordingSocket):
    async def send_json(self, message: dict) -> None:
        raise RuntimeError("dead socket")


async def test_delivery_barrier_sends_snapshot_before_concurrent_event():
    hub = RealtimeHub()
    socket = _RecordingSocket()
    topic = "driver:test"

    async with hub.delivery_barrier(socket):  # type: ignore[arg-type]
        hub.subscribe(topic, socket)  # type: ignore[arg-type]
        live_event = asyncio.create_task(
            hub.broadcast(topic, {"type": "offer_rejected"})
        )
        await asyncio.sleep(0)
        assert socket.messages == []
        await socket.send_json({"type": "driver_offers_snapshot"})

    await live_event
    assert [message["type"] for message in socket.messages] == [
        "driver_offers_snapshot",
        "offer_rejected",
    ]


async def test_live_policy_suppresses_legacy_but_keeps_versioned_delivery():
    hub = RealtimeHub()
    socket = _RecordingSocket()
    topic = "driver:test"
    hub.subscribe(topic, socket)  # type: ignore[arg-type]
    hub.set_legacy_delivery_enabled(False)

    await hub.broadcast(topic, {"type": "legacy"})
    await hub.broadcast_versioned(topic, {"type": "versioned"})

    assert socket.messages == [{"type": "versioned"}]


async def test_force_resync_closes_each_affected_socket_once():
    hub = RealtimeHub()
    socket = _RecordingSocket()
    hub.subscribe("ride:one", socket)  # type: ignore[arg-type]
    hub.subscribe("driver:one", socket)  # type: ignore[arg-type]

    await hub.force_resync(["ride:one", "driver:one"])

    assert socket.closed_with == [1012]
    assert hub.has_subscribers("ride:one") is False
    assert hub.has_subscribers("driver:one") is False


async def test_send_failure_closes_and_unsubscribes_all_socket_topics():
    hub = RealtimeHub()
    socket = _FailingSocket()
    hub.subscribe("ride:one", socket)  # type: ignore[arg-type]
    hub.subscribe("driver:one", socket)  # type: ignore[arg-type]

    await hub.broadcast_versioned("ride:one", {"type": "offer_created"})

    assert socket.closed_with == [1012]
    assert hub.has_subscribers("ride:one") is False
    assert hub.has_subscribers("driver:one") is False
