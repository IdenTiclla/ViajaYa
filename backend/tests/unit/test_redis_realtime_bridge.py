"""Redis fan-out between processes and safe subscriber recovery."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime

import pytest

from app.api.v1 import redis_realtime
from app.api.v1.redis_realtime import (
    RedisRealtimeBridge,
    RedisRealtimeUnavailableError,
)
from app.application.dto import RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.infrastructure.realtime.hub import RealtimeHub


class _RecordingSocket:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []
        self.closed_with: list[int] = []

    async def send_json(self, message: dict[str, object]) -> None:
        self.messages.append(message)

    async def close(self, code: int) -> None:
        self.closed_with.append(code)


class _FakeRedisBroker:
    def __init__(self) -> None:
        self.subscribers: dict[asyncio.Queue[object], set[str]] = {}
        self.published: list[tuple[str, str]] = []

    async def publish(
        self,
        message: str,
        *,
        channel: str = "viajaya:test:v2",
    ) -> int:
        self.published.append((channel, message))
        subscribers = [
            queue
            for queue, channels in self.subscribers.items()
            if channel in channels
        ]
        for queue in subscribers:
            await queue.put({"type": "message", "data": message})
        return len(subscribers)

    async def disconnect_all(self) -> None:
        for queue in list(self.subscribers):
            await queue.put(ConnectionError("detalle privado"))


class _FakePubSub:
    def __init__(self, broker: _FakeRedisBroker) -> None:
        self._broker = broker
        self._queue: asyncio.Queue[object] = asyncio.Queue()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args: object) -> None:
        self._broker.subscribers.pop(self._queue, None)

    async def subscribe(self, *channels: str) -> None:
        assert channels == (
            "viajaya:test:v2",
            "viajaya:test:v2:correlation-v1",
        )
        self._broker.subscribers[self._queue] = set(channels)

    async def get_message(
        self,
        *,
        ignore_subscribe_messages: bool,
        timeout: float,
    ) -> dict[str, object] | None:
        assert ignore_subscribe_messages is True
        try:
            value = await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except TimeoutError:
            return None
        if isinstance(value, BaseException):
            raise value
        assert isinstance(value, dict)
        return value


class _FakeRedisClient:
    def __init__(self, broker: _FakeRedisBroker) -> None:
        self._broker = broker
        self.closed = False

    async def ping(self) -> bool:
        return True

    async def publish(self, channel: str, message: str) -> int:
        assert channel in {
            "viajaya:test:v2",
            "viajaya:test:v2:correlation-v1",
        }
        return await self._broker.publish(message, channel=channel)

    def pubsub(self, **kwargs: object) -> _FakePubSub:
        assert kwargs == {"ignore_subscribe_messages": True}
        return _FakePubSub(self._broker)

    async def aclose(self) -> None:
        self.closed = True


def _bridge(
    broker: _FakeRedisBroker,
    local_hub: RealtimeHub,
) -> RedisRealtimeBridge:
    return RedisRealtimeBridge(
        _FakeRedisClient(broker),
        channel="viajaya:test:v2",
        connect_timeout_seconds=1,
        reconnect_base_seconds=0.01,
        reconnect_max_seconds=0.02,
        local_hub=local_hub,
    )


def _event(
    *,
    batch_id: uuid.UUID | None = None,
    sequence: int = 0,
    batch_size: int = 1,
    stream_version: int = 1,
) -> RealtimeOutboxEvent:
    ride_id = uuid.uuid4()
    now = datetime.now(UTC)
    return RealtimeOutboxEvent(
        id=uuid.uuid4(),
        batch_id=batch_id or uuid.uuid4(),
        correlation_id=uuid.uuid4(),
        sequence=sequence,
        batch_size=batch_size,
        event_type="ride_closed",
        topic="pool:taxi",
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=1,
        stream_version=stream_version,
        payload={
            "type": "ride_closed",
            "data": {
                "ride_id": str(ride_id),
                "pool_version": 1,
                "reason": "terminal",
            },
        },
        created_at=now,
        next_attempt_at=now,
        published_at=None,
        attempts=1,
        last_error=None,
    )


async def _stop(
    bridges_and_tasks: list[tuple[RedisRealtimeBridge, asyncio.Task[None]]],
) -> None:
    for bridge, _task in bridges_and_tasks:
        bridge.stop()
    await asyncio.gather(
        *(task for _bridge_instance, task in bridges_and_tasks),
    )


async def test_un_batch_llega_a_los_sockets_locales_de_dos_procesos() -> None:
    broker = _FakeRedisBroker()
    first_hub = RealtimeHub()
    second_hub = RealtimeHub()
    first_socket = _RecordingSocket()
    second_socket = _RecordingSocket()
    first_hub.subscribe("pool:taxi", first_socket)  # type: ignore[arg-type]
    second_hub.subscribe("pool:taxi", second_socket)  # type: ignore[arg-type]
    first = _bridge(broker, first_hub)
    second = _bridge(broker, second_hub)
    running = [
        (first, asyncio.create_task(first.run())),
        (second, asyncio.create_task(second.run())),
    ]
    try:
        await asyncio.gather(
            first.wait_until_ready(1),
            second.wait_until_ready(1),
        )
        await first.publish([_event()])
        for _ in range(20):
            if first_socket.messages and second_socket.messages:
                break
            await asyncio.sleep(0)

        assert [message["kind"] for message in first_socket.messages] == ["event"]
        assert second_socket.messages == first_socket.messages
        assert first.last_publish_subscriber_count == 2
        assert first.received_batch_count == 1
        assert second.received_batch_count == 1
    finally:
        await _stop(running)


async def test_publicacion_dual_es_compatible_y_no_duplica_en_consumidor_nuevo() -> None:
    broker = _FakeRedisBroker()
    local_hub = RealtimeHub()
    socket = _RecordingSocket()
    local_hub.subscribe("pool:taxi", socket)  # type: ignore[arg-type]
    bridge = _bridge(broker, local_hub)
    task = asyncio.create_task(bridge.run())
    event = _event()
    try:
        await bridge.wait_until_ready(1)
        await bridge.publish([event])
        for _ in range(20):
            if socket.messages:
                break
            await asyncio.sleep(0)

        by_channel = {
            channel: json.loads(payload)
            for channel, payload in broker.published
        }
        legacy = by_channel["viajaya:test:v2"]
        correlated = by_channel["viajaya:test:v2:correlation-v1"]
        assert legacy["wire_version"] == 1
        assert "correlation_id" not in legacy["events"][0]
        assert correlated["wire_version"] == 2
        assert correlated["events"][0]["correlation_id"] == str(
            event.correlation_id
        )
        assert len(socket.messages) == 1
        assert socket.messages[0]["correlation_id"] == str(event.correlation_id)
    finally:
        await _stop([(bridge, task)])


async def test_consumidor_nuevo_acepta_batch_del_productor_anterior() -> None:
    broker = _FakeRedisBroker()
    local_hub = RealtimeHub()
    socket = _RecordingSocket()
    local_hub.subscribe("pool:taxi", socket)  # type: ignore[arg-type]
    bridge = _bridge(broker, local_hub)
    task = asyncio.create_task(bridge.run())
    event = _event()
    envelopes = redis_realtime.serialize_realtime_outbox_batch_v2([event])
    legacy_envelopes = [
        {
            key: value
            for key, value in envelope.items()
            if key != "correlation_id"
        }
        for envelope in envelopes
    ]
    legacy_message = json.dumps(
        {
            "wire_version": 1,
            "kind": "batch",
            "batch_id": str(event.batch_id),
            "batch_size": 1,
            "events": legacy_envelopes,
        }
    )
    correlated_message = json.dumps(
        {
            "wire_version": 2,
            "kind": "batch",
            "batch_id": str(event.batch_id),
            "batch_size": 1,
            "events": envelopes,
        }
    )
    try:
        await bridge.wait_until_ready(1)
        await broker.publish(legacy_message)
        for _ in range(20):
            if socket.messages:
                break
            await asyncio.sleep(0)

        assert len(socket.messages) == 1
        assert socket.messages[0]["event_id"] == str(event.id)
        assert socket.messages[0]["correlation_id"] == str(event.batch_id)
        # Simulates the correlated channel arriving later: both copies are
        # valid and the mobile gate treats them as the same event_id.
        await broker.publish(
            correlated_message,
            channel="viajaya:test:v2:correlation-v1",
        )
        for _ in range(20):
            if len(socket.messages) == 2:
                break
            await asyncio.sleep(0)
        assert len(socket.messages) == 2
        assert socket.messages[1]["event_id"] == str(event.id)
        assert socket.messages[1]["correlation_id"] == str(event.correlation_id)
        assert bridge.invalid_message_count == 0
    finally:
        await _stop([(bridge, task)])


async def test_publicar_sin_suscriptores_no_confirma_el_fanout() -> None:
    broker = _FakeRedisBroker()
    bridge = _bridge(broker, RealtimeHub())
    task = asyncio.create_task(bridge.run())
    try:
        await bridge.wait_until_ready(1)
        broker.subscribers.clear()
        with pytest.raises(RedisRealtimeUnavailableError, match="suscriptor"):
            await bridge.publish([_event()])
    finally:
        await _stop([(bridge, task)])


async def test_mensaje_invalido_cierra_sockets_sin_exponer_payload() -> None:
    broker = _FakeRedisBroker()
    local_hub = RealtimeHub()
    socket = _RecordingSocket()
    local_hub.subscribe("pool:taxi", socket)  # type: ignore[arg-type]
    bridge = _bridge(broker, local_hub)
    task = asyncio.create_task(bridge.run())
    try:
        await bridge.wait_until_ready(1)
        await broker.publish('{"kind":"batch","secreto":"no-log"}')
        for _ in range(20):
            if socket.closed_with:
                break
            await asyncio.sleep(0)

        assert bridge.invalid_message_count == 1
        assert bridge.last_error == "InvalidRedisRealtimeMessage"
        assert local_hub.shared_transport_healthy is False
        assert socket.closed_with == [1012]
        assert local_hub.subscribed_socket_count == 0
    finally:
        await _stop([(bridge, task)])


async def test_perder_pubsub_cierra_sockets_y_reconecta() -> None:
    broker = _FakeRedisBroker()
    local_hub = RealtimeHub()
    socket = _RecordingSocket()
    local_hub.subscribe("pool:taxi", socket)  # type: ignore[arg-type]
    bridge = _bridge(broker, local_hub)
    task = asyncio.create_task(bridge.run())
    try:
        await bridge.wait_until_ready(1)
        await broker.disconnect_all()
        for _ in range(100):
            if bridge.reconnect_count and bridge.connected:
                break
            await asyncio.sleep(0.005)

        assert bridge.reconnect_count >= 1
        assert bridge.connected is True
        assert bridge.last_error is None
        assert socket.closed_with == [1012]
    finally:
        await _stop([(bridge, task)])


async def test_publica_batch_valido_con_mas_de_mil_eventos() -> None:
    broker = _FakeRedisBroker()
    bridge = _bridge(broker, RealtimeHub())
    task = asyncio.create_task(bridge.run())
    batch_id = uuid.uuid4()
    events = [
        _event(
            batch_id=batch_id,
            sequence=sequence,
            batch_size=1001,
            stream_version=sequence + 1,
        )
        for sequence in range(1001)
    ]
    try:
        await bridge.wait_until_ready(1)
        await bridge.publish(events)
        assert bridge.published_batch_count == 1
    finally:
        await _stop([(bridge, task)])


async def test_batch_que_excede_bytes_es_error_determinista(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    broker = _FakeRedisBroker()
    bridge = _bridge(broker, RealtimeHub())
    task = asyncio.create_task(bridge.run())
    monkeypatch.setattr(redis_realtime, "_MAX_WIRE_MESSAGE_BYTES", 1)
    try:
        await bridge.wait_until_ready(1)
        with pytest.raises(InvalidRealtimeOutboxBatchError) as captured:
            await bridge.publish([_event()])
        assert captured.value.code == "transport_limit"
    finally:
        await _stop([(bridge, task)])


async def test_resync_grande_se_fragmenta_en_mensajes_de_control() -> None:
    broker = _FakeRedisBroker()
    bridge = _bridge(broker, RealtimeHub())
    task = asyncio.create_task(bridge.run())
    streams = [f"ride:{uuid.uuid4()}" for _ in range(1001)]
    try:
        await bridge.wait_until_ready(1)
        await bridge.force_resync(streams)
        for _ in range(100):
            if bridge.resync_message_count == 2:
                break
            await asyncio.sleep(0)
        assert bridge.resync_message_count == 2
    finally:
        await _stop([(bridge, task)])
