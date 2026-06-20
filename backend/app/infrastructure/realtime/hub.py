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

import uuid

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

    def subscribe(self, topic: str, ws: WebSocket) -> None:
        self._topics.setdefault(topic, set()).add(ws)

    def unsubscribe(self, topic: str, ws: WebSocket) -> None:
        subscribers = self._topics.get(topic)
        if subscribers is None:
            return
        subscribers.discard(ws)
        if not subscribers:
            del self._topics[topic]

    def unsubscribe_all(self, ws: WebSocket) -> None:
        for topic in list(self._topics):
            self.unsubscribe(topic, ws)

    def has_subscribers(self, topic: str) -> bool:
        """``True`` si algún WebSocket sigue suscrito al topic (presencia viva)."""
        return bool(self._topics.get(topic))

    async def broadcast(self, topic: str, message: dict) -> None:
        """Envía ``message`` (JSON-serializable) a todos los suscriptores del topic.

        Los sockets que fallan al enviar se descartan (desconexión silenciosa).
        """
        subscribers = self._topics.get(topic)
        if not subscribers:
            return
        dead: list[WebSocket] = []
        for ws in list(subscribers):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - socket caído; lo limpiamos
                dead.append(ws)
        for ws in dead:
            self.unsubscribe(topic, ws)


# Singleton del proceso.
hub = RealtimeHub()
