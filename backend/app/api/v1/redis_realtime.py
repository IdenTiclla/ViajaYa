"""Redis bridge between the durable outbox and each process's WebSocket hubs."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import OrderedDict
from collections.abc import Sequence
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from redis.asyncio import Redis

from app.api.v1.realtime_outbox import serialize_realtime_outbox_batch_v2
from app.api.v1.schemas.realtime import (
    LegacyRealtimeEventEnvelopeV2,
    RealtimeEventEnvelopeV2,
)
from app.application.dto import RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import RealtimeDeliveryBridge
from app.infrastructure.realtime.hub import RealtimeHub, hub

logger = logging.getLogger(__name__)

_LEGACY_WIRE_VERSION = 1
_CORRELATED_WIRE_VERSION = 2
_CORRELATED_CHANNEL_SUFFIX = ":correlation-v1"
_MAX_WIRE_MESSAGE_BYTES = 1_000_000
_MAX_RESYNC_STREAMS = 1000
_MAX_RECENT_CORRELATED_BATCHES = 2048
_SUBSCRIBER_POLL_SECONDS = 0.5


class _RedisPubSub(Protocol):
    async def __aenter__(self) -> _RedisPubSub: ...

    async def __aexit__(self, *args: object) -> None: ...

    async def subscribe(self, *channels: str) -> object: ...

    async def get_message(
        self,
        *,
        ignore_subscribe_messages: bool,
        timeout: float,
    ) -> dict[str, object] | None: ...


class _RedisClient(Protocol):
    async def ping(self) -> bool: ...

    async def publish(self, channel: str, message: str) -> int: ...

    def pubsub(self, **kwargs: object) -> _RedisPubSub: ...

    async def aclose(self) -> None: ...


class RedisRealtimeUnavailableError(RuntimeError):
    """Redis cannot confirm fan-out to any active subscriber."""


class _WireMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _WireMessageV1(_WireMessage):
    wire_version: Literal[1] = _LEGACY_WIRE_VERSION


class _WireMessageV2(_WireMessage):
    wire_version: Literal[2] = _CORRELATED_WIRE_VERSION


class _BatchWireMessageV1(_WireMessageV1):
    kind: Literal["batch"] = "batch"
    batch_id: uuid.UUID
    batch_size: int = Field(strict=True, ge=1)
    events: list[LegacyRealtimeEventEnvelopeV2] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_batch(self) -> _BatchWireMessageV1:
        _validate_wire_batch(self)
        return self


class _BatchWireMessageV2(_WireMessageV2):
    kind: Literal["batch"] = "batch"
    batch_id: uuid.UUID
    batch_size: int = Field(strict=True, ge=1)
    events: list[RealtimeEventEnvelopeV2] = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def require_explicit_correlation(cls, value: object) -> object:
        if isinstance(value, dict):
            events = value.get("events")
            if isinstance(events, list) and any(
                (
                    event.get("correlation_id")
                    if isinstance(event, dict)
                    else getattr(event, "correlation_id", None)
                )
                is None
                for event in events
            ):
                raise ValueError(
                    "El wire correlacionado requiere correlation_id explícito."
                )
        return value

    @model_validator(mode="after")
    def validate_batch(self) -> _BatchWireMessageV2:
        _validate_wire_batch(self)
        return self


def _validate_wire_batch(
    message: _BatchWireMessageV1 | _BatchWireMessageV2,
) -> None:
    if message.batch_size != len(message.events):
        raise ValueError("La cardinalidad Redis no coincide con el batch.")
    if any(event.batch_id != message.batch_id for event in message.events):
        raise ValueError("Todos los eventos deben pertenecer al batch declarado.")
    if [event.sequence for event in message.events] != list(
        range(len(message.events))
    ):
        raise ValueError("La secuencia Redis del batch no es contigua.")
    if len({event.event_id for event in message.events}) != len(message.events):
        raise ValueError("El batch Redis repite event_id.")


class _ResyncWireMessage(_WireMessageV1):
    kind: Literal["resync"] = "resync"
    streams: list[str] = Field(min_length=1, max_length=_MAX_RESYNC_STREAMS)

    @model_validator(mode="after")
    def validate_streams(self) -> _ResyncWireMessage:
        if len(set(self.streams)) != len(self.streams):
            raise ValueError("La orden de resnapshot repite streams.")
        # The envelope applies the same canonical validation to streams. For a
        # control command it is enough to restrict the three production namespaces.
        for stream in self.streams:
            prefix, separator, suffix = stream.partition(":")
            if (
                separator != ":"
                or prefix not in {"ride", "driver", "pool"}
                or not suffix
            ):
                raise ValueError("La orden de resnapshot contiene un stream inválido.")
            if prefix == "pool" and suffix not in {"taxi", "moto", "delivery"}:
                raise ValueError("La orden de resnapshot contiene un pool inválido.")
            if prefix in {"ride", "driver"}:
                try:
                    stream_id = uuid.UUID(suffix)
                except ValueError:
                    raise ValueError(
                        "La orden de resnapshot contiene un UUID inválido."
                    ) from None
                if suffix.lower() != str(stream_id):
                    raise ValueError("El UUID del stream no es canónico.")
        return self


def _parse_wire_message(
    raw_message: str,
) -> _BatchWireMessageV1 | _BatchWireMessageV2 | _ResyncWireMessage:
    if len(raw_message.encode("utf-8")) > _MAX_WIRE_MESSAGE_BYTES:
        raise ValueError("El mensaje Redis excede el límite permitido.")
    decoded = json.loads(raw_message)
    if not isinstance(decoded, dict):
        raise ValueError("El mensaje Redis debe ser un objeto.")
    kind = decoded.get("kind")
    if kind == "batch":
        wire_version = decoded.get("wire_version")
        if wire_version == _LEGACY_WIRE_VERSION:
            return _BatchWireMessageV1.model_validate(decoded)
        if wire_version == _CORRELATED_WIRE_VERSION:
            return _BatchWireMessageV2.model_validate(decoded)
        raise ValueError("El batch Redis tiene una versión desconocida.")
    if kind == "resync":
        return _ResyncWireMessage.model_validate(decoded)
    raise ValueError("El mensaje Redis tiene un tipo desconocido.")


class RedisRealtimeBridge(RealtimeDeliveryBridge):
    """Publish batches and keep one fan-out subscription per process.

    Redis Pub/Sub does not keep messages. If this subscription is interrupted, the
    bridge closes all local sockets with 1012; their reconnection builds a
    new snapshot from PostgreSQL and does not continue over an incomplete stream.
    """

    def __init__(
        self,
        client: _RedisClient,
        *,
        channel: str,
        connect_timeout_seconds: float,
        reconnect_base_seconds: float,
        reconnect_max_seconds: float,
        local_hub: RealtimeHub = hub,
    ) -> None:
        if not channel:
            raise ValueError("El canal Redis no puede estar vacío.")
        if connect_timeout_seconds <= 0:
            raise ValueError("El timeout de Redis debe ser positivo.")
        if reconnect_base_seconds <= 0:
            raise ValueError("El backoff base de Redis debe ser positivo.")
        if reconnect_max_seconds < reconnect_base_seconds:
            raise ValueError("El backoff máximo de Redis no puede ser menor al base.")
        self._client = client
        self._channel = channel
        self._correlated_channel = f"{channel}{_CORRELATED_CHANNEL_SUFFIX}"
        self._connect_timeout_seconds = connect_timeout_seconds
        self._reconnect_base_seconds = reconnect_base_seconds
        self._reconnect_max_seconds = reconnect_max_seconds
        self._hub = local_hub
        self._stop_event = asyncio.Event()
        self._ready_event = asyncio.Event()
        self._running = False
        self._connected = False
        self._closed = False
        self._close_lock = asyncio.Lock()
        self._last_error: str | None = None
        self._published_batch_count = 0
        self._received_batch_count = 0
        self._received_event_count = 0
        self._resync_message_count = 0
        self._reconnect_count = 0
        self._invalid_message_count = 0
        self._last_publish_subscriber_count = 0
        self._recent_correlated_batches: OrderedDict[uuid.UUID, None] = OrderedDict()

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        channel: str,
        connect_timeout_seconds: float,
        reconnect_base_seconds: float,
        reconnect_max_seconds: float,
        local_hub: RealtimeHub = hub,
    ) -> RedisRealtimeBridge:
        client = Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=connect_timeout_seconds,
            socket_timeout=connect_timeout_seconds,
            health_check_interval=30,
        )
        return cls(
            client,
            channel=channel,
            connect_timeout_seconds=connect_timeout_seconds,
            reconnect_base_seconds=reconnect_base_seconds,
            reconnect_max_seconds=reconnect_max_seconds,
            local_hub=local_hub,
        )

    @property
    def running(self) -> bool:
        return self._running

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def published_batch_count(self) -> int:
        return self._published_batch_count

    @property
    def received_batch_count(self) -> int:
        return self._received_batch_count

    @property
    def received_event_count(self) -> int:
        return self._received_event_count

    @property
    def resync_message_count(self) -> int:
        return self._resync_message_count

    @property
    def reconnect_count(self) -> int:
        return self._reconnect_count

    @property
    def invalid_message_count(self) -> int:
        return self._invalid_message_count

    @property
    def last_publish_subscriber_count(self) -> int:
        return self._last_publish_subscriber_count

    async def preflight(self) -> None:
        async with asyncio.timeout(self._connect_timeout_seconds):
            if not await self._client.ping():
                raise RedisRealtimeUnavailableError("Redis no respondió PONG.")

    async def wait_until_ready(self, timeout_seconds: float) -> None:
        if timeout_seconds <= 0:
            raise ValueError("El timeout de readiness debe ser positivo.")
        await asyncio.wait_for(self._ready_event.wait(), timeout=timeout_seconds)

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        if not self._connected:
            raise RedisRealtimeUnavailableError(
                "El proceso no mantiene una suscripción Redis confirmada."
            )
        envelopes = serialize_realtime_outbox_batch_v2(events)
        correlated_message = _BatchWireMessageV2(
            batch_id=events[0].batch_id,
            batch_size=len(events),
            events=[RealtimeEventEnvelopeV2.model_validate(item) for item in envelopes],
        )
        legacy_message = _BatchWireMessageV1(
            batch_id=events[0].batch_id,
            batch_size=len(events),
            events=[
                LegacyRealtimeEventEnvelopeV2.model_validate(
                    {
                        key: value
                        for key, value in envelope.items()
                        if key != "correlation_id"
                    }
                )
                for envelope in envelopes
            ],
        )
        # Old replicas are only subscribed to the original channel. The
        # new consumer skips the legacy copy if it already saw the correlated one;
        # if Redis reverses the order, the mobile gate tolerates the second delivery
        # because the diagnostic correlation is not part of its identity.
        correlated_subscribers = await self._publish_wire(
            correlated_message,
            channel=self._correlated_channel,
        )
        legacy_subscribers = await self._publish_wire(
            legacy_message,
            channel=self._channel,
        )
        self._last_publish_subscriber_count = min(
            correlated_subscribers,
            legacy_subscribers,
        )
        self._published_batch_count += 1

    async def force_resync(self, streams: Sequence[str]) -> None:
        unique_streams = list(dict.fromkeys(streams))
        for offset in range(0, len(unique_streams), _MAX_RESYNC_STREAMS):
            message = _ResyncWireMessage(
                streams=unique_streams[offset : offset + _MAX_RESYNC_STREAMS]
            )
            await self._publish_wire(message, channel=self._channel)

    async def run(self) -> None:
        if self._running:
            raise RuntimeError("El bridge Redis ya está en ejecución.")
        if self._closed:
            raise RuntimeError("El bridge Redis ya fue cerrado.")
        self._running = True
        self._hub.set_shared_transport_healthy(False)
        failures = 0
        logger.info("Bridge Redis realtime iniciado.")
        try:
            while not self._stop_event.is_set():
                try:
                    async with self._client.pubsub(
                        ignore_subscribe_messages=True
                    ) as pubsub:
                        async with asyncio.timeout(self._connect_timeout_seconds):
                            await pubsub.subscribe(
                                self._channel,
                                self._correlated_channel,
                            )
                        self._connected = True
                        self._ready_event.set()
                        self._last_error = None
                        self._hub.set_shared_transport_healthy(True)
                        failures = 0
                        while not self._stop_event.is_set():
                            message = await pubsub.get_message(
                                ignore_subscribe_messages=True,
                                timeout=_SUBSCRIBER_POLL_SECONDS,
                            )
                            if message is not None:
                                await self._consume(message)
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # noqa: BLE001 - resilient reconnection
                    had_active_subscription = self._connected
                    self._connected = False
                    self._ready_event.clear()
                    self._last_error = type(error).__name__
                    self._hub.set_shared_transport_healthy(False)
                    self._reconnect_count += 1
                    if had_active_subscription:
                        await self._hub.force_resync_all()
                    logger.error(
                        "El bridge Redis perdió su suscripción (%s).",
                        self._last_error,
                    )
                    failures += 1
                    await self._wait_before_reconnect(failures)
        finally:
            self._connected = False
            self._ready_event.clear()
            self._running = False
            self._hub.set_shared_transport_healthy(False)
            await self.aclose()
            logger.info("Bridge Redis realtime detenido.")

    def stop(self) -> None:
        self._stop_event.set()

    async def aclose(self) -> None:
        async with self._close_lock:
            if self._closed:
                return
            self._closed = True
            await self._client.aclose()

    async def _publish_wire(
        self,
        message: _BatchWireMessageV1 | _BatchWireMessageV2 | _ResyncWireMessage,
        *,
        channel: str,
    ) -> int:
        payload = message.model_dump_json()
        if len(payload.encode("utf-8")) > _MAX_WIRE_MESSAGE_BYTES:
            if isinstance(message, (_BatchWireMessageV1, _BatchWireMessageV2)):
                raise InvalidRealtimeOutboxBatchError(
                    "transport_limit",
                    "El batch realtime excede el límite seguro del transporte.",
                )
            raise ValueError("La orden Redis excede el límite permitido.")
        async with asyncio.timeout(self._connect_timeout_seconds):
            subscriber_count = int(
                await self._client.publish(channel, payload)
            )
        if subscriber_count < 1:
            raise RedisRealtimeUnavailableError(
                "Redis no confirmó ningún suscriptor realtime."
            )
        return subscriber_count

    async def _consume(self, message: dict[str, object]) -> None:
        if message.get("type") != "message":
            return
        raw_payload = message.get("data")
        if isinstance(raw_payload, bytes):
            raw_payload = raw_payload.decode("utf-8")
        if not isinstance(raw_payload, str):
            await self._reject_invalid_message()
            return
        try:
            wire_message = _parse_wire_message(raw_payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError):
            await self._reject_invalid_message()
            return

        self._last_error = None
        self._hub.set_shared_transport_healthy(True)
        if isinstance(wire_message, _BatchWireMessageV2):
            for event in wire_message.events:
                await self._hub.broadcast_versioned(
                    event.stream,
                    event.model_dump(mode="json"),
                )
            self._remember_correlated_batch(wire_message.batch_id)
            self._received_batch_count += 1
            self._received_event_count += len(wire_message.events)
            return

        if isinstance(wire_message, _BatchWireMessageV1):
            if wire_message.batch_id in self._recent_correlated_batches:
                return
            for legacy_event in wire_message.events:
                event = RealtimeEventEnvelopeV2.model_validate(
                    legacy_event.model_dump(mode="json")
                )
                await self._hub.broadcast_versioned(
                    event.stream,
                    event.model_dump(mode="json"),
                )
            self._received_batch_count += 1
            self._received_event_count += len(wire_message.events)
            return

        await self._hub.force_resync(wire_message.streams)
        self._resync_message_count += 1

    def _remember_correlated_batch(self, batch_id: uuid.UUID) -> None:
        self._recent_correlated_batches[batch_id] = None
        self._recent_correlated_batches.move_to_end(batch_id)
        while len(self._recent_correlated_batches) > _MAX_RECENT_CORRELATED_BATCHES:
            self._recent_correlated_batches.popitem(last=False)

    async def _reject_invalid_message(self) -> None:
        self._invalid_message_count += 1
        self._last_error = "InvalidRedisRealtimeMessage"
        self._hub.set_shared_transport_healthy(False)
        logger.error("Redis entregó un mensaje realtime inválido; se fuerza resnapshot.")
        await self._hub.force_resync_all()

    async def _wait_before_reconnect(self, failures: int) -> None:
        delay = min(
            self._reconnect_max_seconds,
            self._reconnect_base_seconds * (2 ** min(failures - 1, 20)),
        )
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
        except TimeoutError:
            pass
