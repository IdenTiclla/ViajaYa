"""Orden de entrega entre snapshots WebSocket y eventos concurrentes."""

from __future__ import annotations

import asyncio

from app.infrastructure.realtime.hub import RealtimeHub


class _RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)


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
