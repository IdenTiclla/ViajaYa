"""Presencia del pasajero en una solicitud (capa realtime de la API).

Una solicitud está "activa" para los conductores mientras su pasajero está
presente. La presencia se basa en la conexión WebSocket a ``ride:{id}``, pero con
un **período de gracia**: si la conexión se cae (el pasajero **minimiza** la app,
cambia de pantalla o pierde la red un momento), la solicitud sigue presente unos
segundos. La app reconecta sola al volver al primer plano, así que en la práctica
minimizar no la saca del pool.

Solo si el pasajero **no vuelve** dentro de la ventana de gracia (la app se
**cerró**) la solicitud deja de estar presente y sale del pool en el siguiente
refresco de los conductores. **Cancelar** la saca al instante (lo hace el endpoint
``/cancel`` publicando ``ride_closed``). La solicitud nunca se borra de la BD
mientras busca: si el pasajero reabre la app, vuelve a estar presente.
"""

from __future__ import annotations

import time
import uuid

from app.domain.entities import RideRequest, RideStatus
from app.domain.repositories import OpenRideDetail
from app.infrastructure.realtime.hub import hub, ride_topic

# Cuánto sigue "presente" una solicitud tras caerse la conexión del pasajero,
# para tolerar minimizados, cambios de pantalla y caídas de red transitorias.
PRESENCE_GRACE_SECONDS = 120.0

# Instante (reloj monótono) de la última desconexión por ``ride_id``. Mientras
# haya conexión viva no se usa (``has_subscribers`` manda).
_last_seen: dict[uuid.UUID, float] = {}


def is_ride_present(ride: RideRequest) -> bool:
    """``True`` si el pasajero está conectado o dentro de la ventana de gracia."""
    if hub.has_subscribers(ride_topic(ride.id)):
        return True
    ts = _last_seen.get(ride.id)
    if ts is None:
        return False
    if (time.monotonic() - ts) < PRESENCE_GRACE_SECONDS:
        return True
    # Pasó la gracia sin reconectar: se considera ausente (app cerrada).
    _last_seen.pop(ride.id, None)
    return False


def present_rides(details: list[OpenRideDetail]) -> list[OpenRideDetail]:
    """Filtra una lista de solicitudes enriquecidas a solo las que tienen pasajero presente."""
    return [detail for detail in details if is_ride_present(detail.ride)]


async def on_passenger_connect(detail: OpenRideDetail) -> None:
    """El pasajero abrió/recuperó su conexión.

    Cancela la ventana de gracia y, si la solicitud sigue buscando, la (re)publica
    al pool (ya enriquecida con sus datos) para que los conductores la vean (el
    cliente deduplica por id).
    """
    _last_seen.pop(detail.ride.id, None)
    if detail.ride.status is RideStatus.SEARCHING:
        from app.api.v1 import events

        await events.publish_ride_created(detail)


def on_passenger_disconnect(ride: RideRequest) -> None:
    """El pasajero se desconectó: arranca la ventana de gracia.

    No saca la solicitud del pool de inmediato; queda "presente" hasta que venza
    la gracia (ver :data:`PRESENCE_GRACE_SECONDS`). Si el pasajero reconecta antes,
    no se nota. Si no, dejará de aparecer en el siguiente refresco del conductor.
    """
    if not hub.has_subscribers(ride_topic(ride.id)):
        _last_seen[ride.id] = time.monotonic()
