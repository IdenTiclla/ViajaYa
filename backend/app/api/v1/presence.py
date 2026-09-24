"""Passenger presence on a request (the API's realtime layer).

A request is active while its passenger keeps the ride's WebSocket.
A disconnection opens a short grace period to tolerate network or screen changes.
If they do not reconnect, the search is cancelled atomically and the
drivers are notified. Requests paused for editing are excluded from this close.
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

from app.api.deps import (
    build_announce_open_ride,
    build_cancel_ride_on_disconnect,
    build_disconnect_passenger_presence,
    build_renew_passenger_presence,
)
from app.application.dto import Page
from app.application.exceptions import PassengerPresenceUnavailableError
from app.application.interfaces import PassengerPresenceLeaseStore
from app.domain.entities import RideRequest, RideStatus
from app.domain.repositories import OpenRideDetail
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.db.clock import database_utc_now
from app.infrastructure.db.repositories import SqlAlchemyRideRequestRepository
from app.infrastructure.realtime.hub import hub, ride_topic

logger = logging.getLogger(__name__)

# How long a request stays "present" after the passenger's connection drops.
# On mobile networks a WebSocket may take several attempts to recover even though
# the app is still open. The active-ride HTTP query renews this window, so
# it is only cancelled when both channels disappear for two minutes.
PRESENCE_GRACE_SECONDS = 120.0
# A live_redis timer never treats a transport outage as abandonment.
# Short polling stays cancellable by a real passenger reconnection.
TRANSPORT_HEALTH_RECHECK_SECONDS = 1.0

# Instant (monotonic clock) of the last disconnection per ``ride_id``. While
# there is a live connection it is not used (``has_subscribers`` rules).
_last_seen: dict[uuid.UUID, float] = {}
# Only holds tasks that are still inside ``asyncio.sleep`` and can therefore
# be cancelled when the passenger reconnects.
_pending_cancels: dict[uuid.UUID, asyncio.Task[None]] = {}
# A task moves here before touching the database. Reconnecting waits for this phase, never
# cancels it: it covers both the transaction and the publication of its events.
_critical_cancels: dict[uuid.UUID, asyncio.Task[None]] = {}
_CANCEL_TASKS: set[asyncio.Task[None]] = set()


async def shutdown_presence_tasks() -> None:
    """Stop timers and wait for critical closes before shutting down the API."""
    pending_tasks = set(_pending_cancels.values())
    for task in pending_tasks:
        task.cancel()

    tasks = set(_CANCEL_TASKS)
    tasks.update(_critical_cancels.values())
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    _pending_cancels.clear()
    _critical_cancels.clear()
    _CANCEL_TASKS.clear()
    _last_seen.clear()


def is_ride_present(ride: RideRequest) -> bool:
    """``True`` if the passenger is connected or within the grace window."""
    if hub.has_subscribers(ride_topic(ride.id)):
        return True
    ts = _last_seen.get(ride.id)
    if ts is None:
        return False
    if (time.monotonic() - ts) < PRESENCE_GRACE_SECONDS:
        return True
    # The grace period passed without reconnecting: considered absent (app closed).
    _last_seen.pop(ride.id, None)
    return False


def present_rides(page: Page[OpenRideDetail]) -> Page[OpenRideDetail]:
    """Filter the present items without changing the SQL continuation position."""
    return Page(
        items=[detail for detail in page.items if is_ride_present(detail.ride)],
        next_cursor=page.next_cursor,
    )


async def present_rides_shared(
    page: Page[OpenRideDetail],
    leases: PassengerPresenceLeaseStore,
) -> Page[OpenRideDetail]:
    """Filter with Redis; when in doubt keep the pool so searches are not hidden."""
    try:
        present_ids = await leases.present_ride_ids(
            [detail.ride.id for detail in page.items]
        )
    except PassengerPresenceUnavailableError:
        logger.warning("Could not filter the pool by shared presence.")
        return page
    return Page(
        items=[
            detail for detail in page.items if detail.ride.id in present_ids
        ],
        next_cursor=page.next_cursor,
    )


async def on_shared_passenger_connect(
    ride_id: uuid.UUID,
    connection_id: uuid.UUID,
    session_factory: Callable[[], Any],
    leases: PassengerPresenceLeaseStore,
    settings: Settings,
) -> None:
    """Confirm the lease before announcing a search in any process."""
    await renew_shared_passenger_connection(
        ride_id,
        connection_id,
        session_factory,
        leases,
    )
    await _announce_present_ride(ride_id, session_factory, settings)


async def renew_shared_passenger_connection(
    ride_id: uuid.UUID,
    connection_id: uuid.UUID,
    session_factory: Callable[[], Any],
    leases: PassengerPresenceLeaseStore,
) -> None:
    """Renew the lease and durable generation from the gateway heartbeat."""
    async with session_factory() as session:
        observed_at = await database_utc_now(session)
        await build_renew_passenger_presence(session, leases).execute(
            ride_id,
            observed_at,
            source="websocket",
            connection_id=connection_id,
        )


async def on_shared_passenger_activity(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    leases: PassengerPresenceLeaseStore,
) -> None:
    """Renew the HTTP member and move its durable generation."""
    async with session_factory() as session:
        observed_at = await database_utc_now(session)
        await build_renew_passenger_presence(session, leases).execute(
            ride_id,
            observed_at,
            source="http",
        )


async def on_shared_passenger_disconnect(
    ride_id: uuid.UUID,
    connection_id: uuid.UUID,
    session_factory: Callable[[], Any],
    leases: PassengerPresenceLeaseStore,
) -> None:
    """Close only one connection and open the durable grace that still applies."""
    try:
        async with session_factory() as session:
            observed_at = await database_utc_now(session)
            await build_disconnect_passenger_presence(session, leases).execute(
                ride_id,
                connection_id,
                observed_at,
            )
    except Exception as error:  # noqa: BLE001 - fail-safe, sanitized disconnection
        # A Redis outage does not prove absence. The previous action will be postponed
        # by health/recovery and the expired lease keeps the fail-safe decision.
        logger.warning(
            "Could not record a shared presence disconnection (%s).",
            type(error).__name__,
        )


async def _announce_present_ride(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings,
) -> None:
    try:
        async with session_factory() as session:
            detail = await build_announce_open_ride(session, settings).execute(ride_id)
        if detail is not None:
            from app.api.v1 import events

            await events.publish_ride_created(detail)
    except Exception:
        logger.exception("Could not announce presence for ride %s", ride_id)


async def on_passenger_connect(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings | None = None,
) -> None:
    """The passenger opened/recovered their connection.

    It only cancels a grace wait. If the close already entered its critical
    phase, it waits for it to finish and re-reads the ride before deciding whether to
    publish it; this way a snapshot older than the cancellation never revives in the pool.
    """
    # The transport may cancel the handler's scope as soon as the peer closes.
    # This re-validation must close its session before propagating that close; it lasts
    # only one read and does not keep the WebSocket connection alive.
    with CancelScope(shield=True):
        await _revalidate_passenger_connect(
            ride_id,
            session_factory,
            settings or get_settings(),
        )


async def on_passenger_activity(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings | None = None,
) -> None:
    """Renew presence from the HTTP polling of an app that is still active.

    The WebSocket may drop transiently on Android while HTTP keeps
    working. That case is not abandonment: it cancels the previous timer and
    opens a new window. If the close already entered its critical phase, it first
    waits for its result so it does not revive a cancelled request.
    """
    with CancelScope(shield=True):
        await _revalidate_passenger_activity(
            ride_id,
            session_factory,
            settings or get_settings(),
        )


async def _revalidate_passenger_connect(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings,
) -> None:
    _last_seen.pop(ride_id, None)
    pending = _pending_cancels.pop(ride_id, None)
    if pending is not None:
        pending.cancel()

    critical = _critical_cancels.get(ride_id)
    if critical is not None and critical is not asyncio.current_task():
        await asyncio.shield(critical)

    try:
        async with session_factory() as session:
            detail = await build_announce_open_ride(
                session,
                settings,
            ).execute(ride_id)

        if detail is not None:
            from app.api.v1 import events

            await events.publish_ride_created(detail)
    except Exception:
        # The live connection is still a valid presence signal. A failed
        # announcement must not close the socket and turn it into an absence;
        # snapshots/polling keep convergence while the outbox alerts.
        logger.exception("Could not announce presence for ride %s", ride_id)


async def _revalidate_passenger_activity(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings,
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
        # Reuses the same deferred close as a disconnection. Every successful HTTP
        # response moves the window; if polling also disappears, this
        # last timer ends up cleaning up the abandoned search.
        on_passenger_disconnect(ride_id, session_factory, settings)


def on_passenger_disconnect(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings | None = None,
) -> None:
    """The passenger disconnected: the grace window starts.

    If the passenger does not come back within the grace period, a task with its own session
    cancels the search. The final operation re-checks status and pause.
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

    # Creation is deferred until the WebSocket handler's cleanup finishes.
    # ``disconnected_at`` invalidates the callback if there was another disconnection or a
    # reconnection before it runs.
    asyncio.get_running_loop().call_soon(
        _start_cancel_timer,
        ride_id,
        session_factory,
        disconnected_at,
        settings or get_settings(),
    )


def _start_cancel_timer(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    disconnected_at: float,
    settings: Settings,
) -> None:
    if (
        _last_seen.get(ride_id) != disconnected_at
        or hub.has_subscribers(ride_topic(ride_id))
        or ride_id in _pending_cancels
        or ride_id in _critical_cancels
    ):
        return

    # The state received during the handshake may have changed. The final
    # decision is made under a database lock after the grace period. The empty context
    # decouples the worker from the cancel scope of the transport that started it.
    task = asyncio.create_task(
        _cancel_after_grace(ride_id, session_factory, settings),
        context=contextvars.Context(),
    )
    _pending_cancels[ride_id] = task
    _CANCEL_TASKS.add(task)
    task.add_done_callback(_CANCEL_TASKS.discard)


async def _cancel_after_grace(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings,
) -> None:
    # The worker outlives the WS handler that started it. The shield blocks the
    # cancellation of the transport's AnyIO scope; a direct ``Task.cancel()`` (the
    # reconnection during the sleep) still goes through it.
    with CancelScope(shield=True):
        await _run_cancel_after_grace(ride_id, session_factory, settings)


async def _run_cancel_after_grace(
    ride_id: uuid.UUID,
    session_factory: Callable[[], Any],
    settings: Settings,
) -> None:
    """Cancel the search if the absence persists and publish its outcome."""
    current = asyncio.current_task()
    assert current is not None
    try:
        await asyncio.sleep(PRESENCE_GRACE_SECONDS)
    except asyncio.CancelledError:
        # Reconnecting can only get here, during the cancellable wait.
        return

    transport_was_unhealthy = False
    while settings.realtime_outbox_dispatch_mode == "live_redis":
        if not hub.shared_transport_healthy:
            transport_was_unhealthy = True
            try:
                await asyncio.sleep(TRANSPORT_HEALTH_RECHECK_SECONDS)
            except asyncio.CancelledError:
                # A reconnection/HTTP activity wins even during a long outage.
                return
            continue
        if not transport_was_unhealthy:
            break

        # When Redis comes back the search is not cancelled right away: the client gets a
        # full window to get through readiness/LB and renew its presence.
        transport_was_unhealthy = False
        _last_seen[ride_id] = time.monotonic()
        try:
            await asyncio.sleep(PRESENCE_GRACE_SECONDS)
        except asyncio.CancelledError:
            return

    # There is no ``await`` between removing the cancellable task and recording the critical
    # phase: another coroutine never observes an intermediate window.
    if _pending_cancels.get(ride_id) is not current:
        return
    _pending_cancels.pop(ride_id, None)
    _critical_cancels[ride_id] = current

    try:
        async with session_factory() as session:
            result = await build_cancel_ride_on_disconnect(
                session,
                settings,
            ).execute(ride_id)
            if result is None:
                return

        from app.api.v1 import events

        await events.publish_ride_cancelled(result)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Best-effort notification: polling keeps the client converging.
        logger.exception("Could not close absent ride %s", ride_id)
        return
    finally:
        if _critical_cancels.get(ride_id) is current:
            _critical_cancels.pop(ride_id, None)
        if ride_id not in _pending_cancels:
            _last_seen.pop(ride_id, None)
