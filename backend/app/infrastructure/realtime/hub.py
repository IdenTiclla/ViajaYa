"""In-memory hub of WebSocket connections, grouped by *topic*.

Pure transport: it knows nothing about the domain. It lives as a **process singleton**
(``hub``); when scaling to several processes it would be replaced by a Redis
pub/sub backend without touching its users (see plan 0003 §Scaling).

Topics:
- ``ride:{ride_id}``       → the passenger who owns the ride (offers and status).
- ``pool:{service_type}``  → online drivers of that type (new requests).
- ``driver:{driver_id}``   → a driver (was chosen / their offers were withdrawn).
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

from starlette.websockets import WebSocket


def ride_topic(ride_id: uuid.UUID) -> str:
    return f"ride:{ride_id}"


def pool_topic(service_type: str) -> str:
    return f"pool:{service_type}"


def driver_topic(driver_id: uuid.UUID) -> str:
    return f"driver:{driver_id}"


class RealtimeHub:
    def __init__(self) -> None:
        self._topics: dict[str, set[WebSocket]] = {}
        # Serializes every send to a socket. The handshake can take this
        # barrier, subscribe and send snapshots without a live event slipping in.
        self._send_locks: dict[WebSocket, asyncio.Lock] = {}
        self._legacy_delivery_enabled = True
        # Only ``live_redis`` toggles this signal. The other modes do not depend
        # on a shared transport and stay fail-safe by default.
        self._shared_transport_healthy = True
        self._shared_transport_recovered_at: float | None = None

    @property
    def legacy_delivery_enabled(self) -> bool:
        """Whether the legacy direct path can deliver visible frames."""
        return self._legacy_delivery_enabled

    def set_legacy_delivery_enabled(self, enabled: bool) -> None:
        """Toggle the legacy path; it does not affect snapshots or durable v2 envelopes."""
        self._legacy_delivery_enabled = enabled

    @property
    def shared_transport_healthy(self) -> bool:
        """Indica si es seguro decidir ausencia bajo el fanout compartido."""
        return self._shared_transport_healthy

    def set_shared_transport_healthy(self, healthy: bool) -> None:
        """Update the health used by presence without exposing Redis details."""
        if healthy and not self._shared_transport_healthy:
            self._shared_transport_recovered_at = time.monotonic()
        self._shared_transport_healthy = healthy

    def shared_transport_recovery_grace_remaining(self, grace_seconds: float) -> float:
        """Return the remaining barrier after recovering the shared transport."""
        if not self._shared_transport_healthy:
            return grace_seconds
        recovered_at = self._shared_transport_recovered_at
        if recovered_at is None:
            return 0.0
        return max(0.0, grace_seconds - (time.monotonic() - recovered_at))

    def _is_subscribed(self, ws: WebSocket) -> bool:
        return any(ws in subscribers for subscribers in self._topics.values())

    @asynccontextmanager
    async def delivery_barrier(self, ws: WebSocket) -> AsyncIterator[None]:
        """Block deliveries to the socket while its snapshot is built and sent."""
        lock = self._send_locks.setdefault(ws, asyncio.Lock())
        try:
            async with lock:
                yield
        finally:
            if not self._is_subscribed(ws):
                self._send_locks.pop(ws, None)

    def subscribe(self, topic: str, ws: WebSocket) -> None:
        self._send_locks.setdefault(ws, asyncio.Lock())
        self._topics.setdefault(topic, set()).add(ws)

    def unsubscribe(self, topic: str, ws: WebSocket) -> None:
        subscribers = self._topics.get(topic)
        if subscribers is not None:
            subscribers.discard(ws)
            if not subscribers:
                del self._topics[topic]
        if not self._is_subscribed(ws):
            self._send_locks.pop(ws, None)

    def unsubscribe_all(self, ws: WebSocket) -> None:
        for topic in list(self._topics):
            self.unsubscribe(topic, ws)
        self._send_locks.pop(ws, None)

    def has_subscribers(self, topic: str) -> bool:
        """``True`` if any WebSocket is still subscribed to the topic (live presence)."""
        return bool(self._topics.get(topic))

    @property
    def subscribed_socket_count(self) -> int:
        """Number of unique local sockets, without exposing their topics."""
        return len(
            {
                websocket
                for subscribers in self._topics.values()
                for websocket in subscribers
            }
        )

    async def broadcast(self, topic: str, message: dict[str, object]) -> None:
        """Legacy direct delivery, if the process policy keeps it active."""
        if not self._legacy_delivery_enabled:
            return
        await self._broadcast(topic, message)

    async def broadcast_versioned(
        self,
        topic: str,
        message: dict[str, object],
    ) -> None:
        """Entrega un envelope durable v2, independiente de la ruta legacy."""
        await self._broadcast(topic, message)

    async def force_resync(self, topics: Sequence[str]) -> None:
        """Close the sockets of streams with a terminal gap so they reconnect."""
        sockets = {
            websocket
            for topic in topics
            for websocket in self._topics.get(topic, ())
        }
        await asyncio.gather(
            *(self._close_for_resync(websocket) for websocket in sockets),
        )

    async def force_resync_all(self) -> None:
        """Close every local socket after losing the shared fan-out."""
        sockets = {
            websocket
            for subscribers in self._topics.values()
            for websocket in subscribers
        }
        await asyncio.gather(
            *(self._close_for_resync(websocket) for websocket in sockets),
        )

    async def _close_for_resync(self, websocket: WebSocket) -> None:
        """Fully discard a socket that can no longer follow the stream."""
        try:
            lock = self._send_locks.setdefault(websocket, asyncio.Lock())
            async with lock:
                await websocket.close(code=1012)
        except Exception:  # noqa: BLE001 - the transport may already be down
            pass
        finally:
            # A driver shares several topics. Keeping the others after
            # losing a frame would leave a live socket with partial state.
            self.unsubscribe_all(websocket)

    async def _broadcast(self, topic: str, message: dict[str, object]) -> None:
        """Send ``message`` (JSON-serializable) to the topic's subscribers.

        Sockets that fail to send are discarded (silent disconnection).
        """
        subscribers = self._topics.get(topic)
        if not subscribers:
            return
        dead: list[WebSocket] = []
        for ws in list(subscribers):
            try:
                lock = self._send_locks.setdefault(ws, asyncio.Lock())
                async with lock:
                    await ws.send_json(message)
            except Exception:  # noqa: BLE001 - dead socket; we clean it up
                dead.append(ws)
        if dead:
            await asyncio.gather(*(self._close_for_resync(ws) for ws in dead))


# Singleton del proceso.
hub = RealtimeHub()
