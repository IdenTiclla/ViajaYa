"""Hub de conexiones WebSocket en memoria, agrupadas por *topic*.

Transporte puro: no conoce el dominio. Vive como **singleton del proceso**
(``hub``); al escalar a varios procesos se reemplazaría por un backend Redis
pub/sub sin tocar a quien lo usa (ver plan 0003 §Escalado).

Topics:
- ``ride:{ride_id}``       → el pasajero dueño del viaje (ofertas y estado).
- ``pool:{service_type}``  → conductores en línea de ese tipo (solicitudes nuevas).
- ``driver:{driver_id}``   → un conductor (fue elegido / se retiraron sus ofertas).
"""

from __future__ import annotations

import asyncio
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
        # Serializa todos los envíos a un socket. El handshake puede tomar esta
        # barrera, suscribirse y enviar snapshots sin que un evento vivo se cuele.
        self._send_locks: dict[WebSocket, asyncio.Lock] = {}
        self._legacy_delivery_enabled = True
        # Solo ``live_redis`` conmuta esta señal. Los demás modos no dependen
        # de un transporte compartido y permanecen fail-safe por defecto.
        self._shared_transport_healthy = True

    @property
    def legacy_delivery_enabled(self) -> bool:
        """Indica si la ruta directa legacy puede entregar frames visibles."""
        return self._legacy_delivery_enabled

    def set_legacy_delivery_enabled(self, enabled: bool) -> None:
        """Conmuta la ruta legacy; no afecta snapshots ni envelopes durables v2."""
        self._legacy_delivery_enabled = enabled

    @property
    def shared_transport_healthy(self) -> bool:
        """Indica si es seguro decidir ausencia bajo el fanout compartido."""
        return self._shared_transport_healthy

    def set_shared_transport_healthy(self, healthy: bool) -> None:
        """Actualiza la salud usada por presencia sin exponer detalles Redis."""
        self._shared_transport_healthy = healthy

    def _is_subscribed(self, ws: WebSocket) -> bool:
        return any(ws in subscribers for subscribers in self._topics.values())

    @asynccontextmanager
    async def delivery_barrier(self, ws: WebSocket) -> AsyncIterator[None]:
        """Bloquea entregas al socket mientras se arma y envía su snapshot."""
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
        """``True`` si algún WebSocket sigue suscrito al topic (presencia viva)."""
        return bool(self._topics.get(topic))

    @property
    def subscribed_socket_count(self) -> int:
        """Cantidad de sockets locales únicos, sin exponer sus topics."""
        return len(
            {
                websocket
                for subscribers in self._topics.values()
                for websocket in subscribers
            }
        )

    async def broadcast(self, topic: str, message: dict[str, object]) -> None:
        """Entrega directa legacy si la política del proceso la mantiene activa."""
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
        """Cierra sockets de streams con un hueco terminal para que reconecten."""
        sockets = {
            websocket
            for topic in topics
            for websocket in self._topics.get(topic, ())
        }
        await asyncio.gather(
            *(self._close_for_resync(websocket) for websocket in sockets),
        )

    async def force_resync_all(self) -> None:
        """Cierra todos los sockets locales tras perder el fanout compartido."""
        sockets = {
            websocket
            for subscribers in self._topics.values()
            for websocket in subscribers
        }
        await asyncio.gather(
            *(self._close_for_resync(websocket) for websocket in sockets),
        )

    async def _close_for_resync(self, websocket: WebSocket) -> None:
        """Descarta por completo un socket que ya no puede seguir el stream."""
        try:
            lock = self._send_locks.setdefault(websocket, asyncio.Lock())
            async with lock:
                await websocket.close(code=1012)
        except Exception:  # noqa: BLE001 - el transporte ya puede estar caído
            pass
        finally:
            # Un conductor comparte varios topics. Mantener los demás después
            # de perder un frame dejaría un socket vivo con un estado parcial.
            self.unsubscribe_all(websocket)

    async def _broadcast(self, topic: str, message: dict[str, object]) -> None:
        """Envía ``message`` (JSON-serializable) a los suscriptores del topic.

        Los sockets que fallan al enviar se descartan (desconexión silenciosa).
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
            except Exception:  # noqa: BLE001 - socket caído; lo limpiamos
                dead.append(ws)
        if dead:
            await asyncio.gather(*(self._close_for_resync(ws) for ws in dead))


# Singleton del proceso.
hub = RealtimeHub()
