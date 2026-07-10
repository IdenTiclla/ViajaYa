"""Presencia del pasajero en una solicitud (capa realtime de la API).

Una solicitud está activa mientras su pasajero mantiene el WebSocket del viaje.
Una desconexión abre una gracia breve para tolerar cambios de red o de pantalla.
Si no reconecta, la búsqueda se cancela de forma atómica y se notifica a los
conductores. Las solicitudes pausadas para editar quedan fuera de este cierre.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import time
import uuid
from collections.abc import Callable
from typing import Any

from anyio import CancelScope

from app.application.dto import RideDetail
from app.application.use_cases.cancel_ride_on_disconnect import CancelRideOnDisconnect
from app.domain.entities import RideRequest, RideStatus
from app.domain.repositories import OpenRideDetail
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.realtime.hub import hub, ride_topic

logger = logging.getLogger(__name__)

# Cuánto sigue "presente" una solicitud tras caerse la conexión del pasajero.
# En redes móviles un WebSocket puede tardar varios intentos en recuperarse aunque
# la app siga abierta. La consulta HTTP de viaje activo renueva esta ventana, por
# lo que solo se cancela cuando desaparecen ambos canales durante dos minutos.
PRESENCE_GRACE_SECONDS = 120.0

# Instante (reloj monótono) de la última desconexión por ``ride_id``. Mientras
# haya conexión viva no se usa (``has_subscribers`` manda).
_last_seen: dict[uuid.UUID, float] = {}
# Solo contiene tareas que siguen dentro de ``asyncio.sleep`` y por tanto pueden
# cancelarse cuando el pasajero reconecta.
_pending_cancels: dict[uuid.UUID, asyncio.Task[None]] = {}
# Una tarea pasa aquí antes de tocar la base. Reconectar espera esta fase, nunca
# la cancela: incluye tanto la transacción como la publicación de sus eventos.
_critical_cancels: dict[uuid.UUID, asyncio.Task[None]] = {}
_CANCEL_TASKS: set[asyncio.Task[None]] = set()


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


async def on_passenger_connect(
    ride_id: uuid.UUID, session_factory: Callable[[], Any]
) -> None:
    """El pasajero abrió/recuperó su conexión.

    Cancela únicamente una espera de gracia. Si el cierre ya entró en su fase
    crítica, espera a que termine y vuelve a leer el viaje antes de decidir si lo
    publica; así nunca revive en el pool un snapshot anterior a la cancelación.
    """
    # El transporte puede cancelar el scope del handler apenas el peer cierra.
    # Esta revalidación debe cerrar su sesión antes de propagar ese cierre; dura
    # solo una lectura y no mantiene viva la conexión WebSocket.
    with CancelScope(shield=True):
        await _revalidate_passenger_connect(ride_id, session_factory)


async def on_passenger_activity(
    ride_id: uuid.UUID, session_factory: Callable[[], Any]
) -> None:
    """Renueva la presencia desde el polling HTTP de una app todavía activa.

    El WebSocket puede caer de forma transitoria en Android mientras HTTP sigue
    funcionando. Ese caso no es abandono: cancela el temporizador anterior y
    abre una ventana nueva. Si el cierre ya entró en su fase crítica, primero
    espera su resultado para no revivir una solicitud cancelada.
    """
    with CancelScope(shield=True):
        await _revalidate_passenger_activity(ride_id, session_factory)


async def _revalidate_passenger_connect(
    ride_id: uuid.UUID, session_factory: Callable[[], Any]
) -> None:
    _last_seen.pop(ride_id, None)
    pending = _pending_cancels.pop(ride_id, None)
    if pending is not None:
        pending.cancel()

    critical = _critical_cancels.get(ride_id)
    if critical is not None and critical is not asyncio.current_task():
        await asyncio.shield(critical)

    async with session_factory() as session:
        rides = SqlAlchemyRideRequestRepository(session)
        detail = await rides.open_ride_with_rider(ride_id)

    if (
        detail is not None
        and detail.ride.status is RideStatus.SEARCHING
        and not detail.ride.paused
    ):
        from app.api.v1 import events

        await events.publish_ride_created(detail)


async def _revalidate_passenger_activity(
    ride_id: uuid.UUID, session_factory: Callable[[], Any]
) -> None:
    if hub.has_subscribers(ride_topic(ride_id)):
        return

    _last_seen.pop(ride_id, None)
    pending = _pending_cancels.pop(ride_id, None)
    if pending is not None:
        pending.cancel()

    critical = _critical_cancels.get(ride_id)
    if critical is not None and critical is not asyncio.current_task():
        await asyncio.shield(critical)

    async with session_factory() as session:
        rides = SqlAlchemyRideRequestRepository(session)
        detail = await rides.open_ride_with_rider(ride_id)

    if (
        detail is not None
        and detail.ride.status is RideStatus.SEARCHING
        and not detail.ride.paused
        and not hub.has_subscribers(ride_topic(ride_id))
    ):
        # Reutiliza el mismo cierre diferido que una desconexión. Cada respuesta
        # HTTP exitosa mueve la ventana; si el polling también desaparece, este
        # último temporizador termina limpiando la búsqueda abandonada.
        on_passenger_disconnect(ride_id, session_factory)


def on_passenger_disconnect(
    ride_id: uuid.UUID, session_factory: Callable[[], Any]
) -> None:
    """El pasajero se desconectó: arranca la ventana de gracia.

    Si el pasajero no vuelve dentro de la gracia, una tarea con sesión propia
    cancela la búsqueda. La operación final vuelve a comprobar estado y pausa.
    """
    if hub.has_subscribers(ride_topic(ride_id)):
        return

    disconnected_at = time.monotonic()
    _last_seen[ride_id] = disconnected_at
    previous = _pending_cancels.pop(ride_id, None)
    if previous is not None:
        previous.cancel()
    if ride_id in _critical_cancels:
        return

    # La creación se difiere hasta que termine la limpieza del handler WebSocket.
    # ``disconnected_at`` invalida el callback si hubo otra desconexión o una
    # reconexión antes de que llegue a ejecutarse.
    asyncio.get_running_loop().call_soon(
        _start_cancel_timer,
        ride_id,
        session_factory,
        disconnected_at,
    )


def _start_cancel_timer(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    disconnected_at: float,
) -> None:
    if (
        _last_seen.get(ride_id) != disconnected_at
        or hub.has_subscribers(ride_topic(ride_id))
        or ride_id in _pending_cancels
        or ride_id in _critical_cancels
    ):
        return

    # El estado recibido durante el handshake puede haber cambiado. La decisión
    # final se toma bajo lock en la base después de la gracia. El contexto vacío
    # desacopla el worker del cancel-scope del transporte que lo originó.
    task = asyncio.create_task(
        _cancel_after_grace(ride_id, session_factory),
        context=contextvars.Context(),
    )
    _pending_cancels[ride_id] = task
    _CANCEL_TASKS.add(task)
    task.add_done_callback(_CANCEL_TASKS.discard)


async def _cancel_after_grace(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
) -> None:
    # El worker vive más que el handler WS que lo originó. El shield bloquea la
    # cancelación del scope AnyIO del transporte; ``Task.cancel()`` directo (la
    # reconexión durante el sleep) sigue atravesándolo.
    with CancelScope(shield=True):
        await _run_cancel_after_grace(ride_id, session_factory)


async def _run_cancel_after_grace(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
) -> None:
    """Cancela la búsqueda si la ausencia persiste y publica su desenlace."""
    current = asyncio.current_task()
    assert current is not None
    try:
        await asyncio.sleep(PRESENCE_GRACE_SECONDS)
    except asyncio.CancelledError:
        # Reconectar solo puede llegar aquí, durante la espera cancelable.
        return

    # No hay ``await`` entre quitar la tarea cancelable y registrar la fase
    # crítica: otra coroutine nunca observa una ventana intermedia.
    if _pending_cancels.get(ride_id) is not current:
        return
    _pending_cancels.pop(ride_id, None)
    _critical_cancels[ride_id] = current

    try:
        async with session_factory() as session:
            offers = SqlAlchemyOfferRepository(session)
            users = SqlAlchemyUserRepository(session)
            result = await CancelRideOnDisconnect(offers).execute(ride_id)
            if result is None:
                return
            rider = await users.get_by_id(result.ride.rider_id)

        from app.api.v1 import events

        detail = RideDetail(ride=result.ride, rider=rider)
        await events.publish_ride_status(detail)
        await events.publish_ride_closed(result.ride.id, result.ride.service_type)
        for offer in result.cancelled_offers:
            await events.publish_offer_rejected(offer, reason="ride_cancelled")
    except asyncio.CancelledError:
        raise
    except Exception:
        # Notificación best-effort: el polling conserva la convergencia del cliente.
        logger.exception("No se pudo cerrar el viaje ausente %s", ride_id)
        return
    finally:
        if _critical_cancels.get(ride_id) is current:
            _critical_cancels.pop(ride_id, None)
        if ride_id not in _pending_cancels:
            _last_seen.pop(ride_id, None)
