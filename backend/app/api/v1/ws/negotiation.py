"""WebSocket endpoints of the offer negotiation (downstream only).

Actions (create request/offer, accept, advance status) are still HTTP
POST; these sockets only **push events** to whoever they concern. On connect a
*snapshot* of the current state is sent so there is no blind window.

Auth: the access token travels as a subprotocol, never in the URL. Invalid token or
unauthorized user → close with code 1008.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.api.deps import (
    PassengerPresenceLeaseStoreDep,
    SessionFactoryDep,
    SettingsDep,
    build_expire_offer_and_complete_scheduled_action,
    build_managed_sessions,
    get_build_driver_realtime_snapshot,
    get_build_passenger_realtime_snapshot,
)
from app.api.v1 import events, presence
from app.api.v1.realtime_snapshots import (
    build_driver_snapshot_message_v2,
    build_passenger_snapshot_message_v2,
)
from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.realtime import (
    DriverActiveRideMessage,
    DriverOffersSnapshotMessage,
    NegotiationMessage,
    OffersSnapshotMessage,
    OpenRidesSnapshotMessage,
    PausedRidesSnapshotMessage,
    dump_negotiation_message,
)
from app.api.v1.schemas.rides import OpenRidePageResponse, OpenRideResponse, RideResponse
from app.api.v1.ws.session_guard import guard_session
from app.application.dto import OfferDetail, Page
from app.application.interfaces import PassengerPresenceLeaseStore
from app.application.use_cases.build_driver_realtime_snapshot import (
    BuildDriverRealtimeSnapshot,
)
from app.application.use_cases.build_passenger_realtime_snapshot import (
    BuildPassengerRealtimeSnapshot,
)
from app.application.use_cases.get_driver_active_ride import GetDriverActiveRide
from app.application.use_cases.list_offers_for_ride import ListOffersForRide
from app.application.use_cases.list_open_rides import ListOpenRides
from app.domain.entities import UserRole
from app.domain.exceptions import InvalidTokenError
from app.domain.ride_policy import is_offer_expired
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyRideReadRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.realtime.hub import (
    driver_topic,
    hub,
    pool_topic,
    ride_topic,
)
from app.infrastructure.realtime.ws_auth import (
    AUTH_SUBPROTOCOL,
    token_from_subprotocol,
)

router = APIRouter(tags=["ws"])
logger = logging.getLogger(__name__)

_POLICY_VIOLATION = 1008


async def _send_message(websocket: WebSocket, message: NegotiationMessage) -> None:
    await websocket.send_json(dump_negotiation_message(message))


async def _drain(websocket: WebSocket) -> None:
    """Keep the connection open until the client closes it.

    The channel is downstream only; any incoming message (e.g. a ping) is ignored.
    """
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass


async def _drain_passenger_with_shared_presence(
    websocket: WebSocket,
    ride_id: uuid.UUID,
    connection_id: uuid.UUID,
    session_factory: SessionFactoryDep,
    leases: PassengerPresenceLeaseStore,
    renew_interval_seconds: float,
) -> None:
    """Renew the lease even if the downstream channel receives no messages."""
    async def renew() -> None:
        while True:
            await asyncio.sleep(renew_interval_seconds)
            try:
                await presence.renew_shared_passenger_connection(
                    ride_id,
                    connection_id,
                    session_factory,
                    leases,
                )
            except Exception as error:  # noqa: BLE001 - cierre fail-safe
                logger.warning(
                    "WebSocket lease renewal failed (%s).",
                    type(error).__name__,
                )
                await websocket.close(code=1012)
                return

    drain_task = asyncio.create_task(_drain(websocket))
    renew_task = asyncio.create_task(renew())
    try:
        await asyncio.wait({drain_task, renew_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (drain_task, renew_task):
            task.cancel()
        await asyncio.gather(drain_task, renew_task, return_exceptions=True)


async def _authenticate_session(token, session, settings):
    if not token:
        return None
    try:
        user, _ = await build_managed_sessions(session, settings).authenticate(token)
        return user
    except InvalidTokenError:
        return None


async def _guarded_drain(websocket, receive, token, session_factory, settings):
    async def validate() -> None:
        async with session_factory() as session:
            await build_managed_sessions(session, settings).authenticate(token)
    await guard_session(websocket, receive, validate)


@router.websocket("/ws/rides/{ride_id}")
async def passenger_ws(
    websocket: WebSocket,
    ride_id: uuid.UUID,
    session_factory: SessionFactoryDep,
    settings: SettingsDep,
    passenger_presence: PassengerPresenceLeaseStoreDep,
    snapshot_builder: Annotated[
        BuildPassengerRealtimeSnapshot,
        Depends(get_build_passenger_realtime_snapshot),
    ],
) -> None:
    """The passenger who owns the ride receives offers and status changes live."""
    token = token_from_subprotocol(websocket)
    await websocket.accept(subprotocol=AUTH_SUBPROTOCOL if token else None)
    topic = ride_topic(ride_id)
    connection_id = uuid.uuid4()
    subscribed = False
    try:
        async with session_factory() as session:
            users = SqlAlchemyUserRepository(session)
            rides = SqlAlchemyRideRequestRepository(session)
            offers = SqlAlchemyOfferRepository(session)
            user = await _authenticate_session(token, session, settings)
            if user is None:
                await websocket.close(code=_POLICY_VIOLATION)
                return
            ride = await rides.get_by_id(ride_id)
            if ride is None or ride.rider_id != user.id:
                await websocket.close(code=_POLICY_VIOLATION)
                return

            async with hub.delivery_barrier(websocket):
                hub.subscribe(topic, websocket)
                subscribed = True
                if settings.realtime_outbox_dispatch_mode in {
                    "live_local",
                    "live_redis",
                }:
                    snapshot = await snapshot_builder.execute(user, ride_id)
                    await websocket.send_json(
                        build_passenger_snapshot_message_v2(snapshot).model_dump(
                            mode="json"
                        )
                    )
                else:
                    details = await ListOffersForRide(rides, offers, users).execute(
                        user, ride_id
                    )
                    snapshot = [OfferResponse.from_detail(detail) for detail in details]
                    await _send_message(
                        websocket,
                        OffersSnapshotMessage(data=snapshot),
                    )

        # Presence: the request appears in the pool while the passenger is
        # present (connected or within the grace window). The ``finally``
        # also covers a disconnection during this re-validation.
        if settings.realtime_shared_presence_enabled:
            if passenger_presence is None:
                await websocket.close(code=1012)
                return
            try:
                await presence.on_shared_passenger_connect(
                    ride_id,
                    connection_id,
                    session_factory,
                    passenger_presence,
                    settings,
                )
            except Exception as error:  # noqa: BLE001 - cierre fail-safe
                logger.warning(
                    "Could not confirm WebSocket presence (%s).",
                    type(error).__name__,
                )
                await websocket.close(code=1012)
                return
            await _guarded_drain(websocket, _drain_passenger_with_shared_presence(
                websocket,
                ride_id,
                connection_id,
                session_factory,
                passenger_presence,
                settings.realtime_presence_renew_interval_seconds,
            ), token, session_factory, settings)
        else:
            await presence.on_passenger_connect(ride_id, session_factory, settings)
            await _guarded_drain(websocket, _drain(websocket), token, session_factory, settings)
    finally:
        if subscribed:
            hub.unsubscribe(topic, websocket)
            if (
                settings.realtime_shared_presence_enabled
                and passenger_presence is not None
            ):
                await presence.on_shared_passenger_disconnect(
                    ride_id,
                    connection_id,
                    session_factory,
                    passenger_presence,
                )
            else:
                presence.on_passenger_disconnect(ride_id, session_factory, settings)


@router.websocket("/ws/driver")
async def driver_ws(
    websocket: WebSocket,
    session_factory: SessionFactoryDep,
    settings: SettingsDep,
    passenger_presence: PassengerPresenceLeaseStoreDep,
    snapshot_builder: Annotated[
        BuildDriverRealtimeSnapshot,
        Depends(get_build_driver_realtime_snapshot),
    ],
) -> None:
    """The online driver receives new requests and the notice of being chosen."""
    token = token_from_subprotocol(websocket)
    await websocket.accept(subprotocol=AUTH_SUBPROTOCOL if token else None)
    topics: list[str] = []
    try:
        async with session_factory() as session:
            rides = SqlAlchemyRideRequestRepository(session)
            ride_reads = SqlAlchemyRideReadRepository(session)
            offers = SqlAlchemyOfferRepository(session)
            user = await _authenticate_session(token, session, settings)
            if user is None or user.role is not UserRole.DRIVER or user.vehicle_type is None:
                await websocket.close(code=_POLICY_VIOLATION)
                return

            topics = [
                *(pool_topic(service.value) for service in user.offered_services),
                driver_topic(user.id),
            ]
            # Subscribing inside the barrier closes the window between reading the state
            # and starting to receive events. A concurrent broadcast waits until
            # the full snapshots have gone out.
            async with hub.delivery_barrier(websocket):
                for topic in topics:
                    hub.subscribe(topic, websocket)

                # State recovery on (re)connect:
                # 1) expire offers past their TTL and exclude them from the snapshot.
                expired_offers = []
                active_offers = []
                for offer in await offers.list_active_by_driver(user.id):
                    if is_offer_expired(offer):
                        done = await build_expire_offer_and_complete_scheduled_action(
                            session,
                            settings,
                        ).execute(offer.id, datetime.now(UTC))
                        if done is not None:
                            expired_offers.append(done)
                    else:
                        active_offers.append(offer)

                if settings.realtime_outbox_dispatch_mode in {
                    "live_local",
                    "live_redis",
                }:
                    captured = await snapshot_builder.execute(user)
                    open_rides = captured.open_rides
                    if settings.realtime_shared_presence_enabled:
                        if passenger_presence is not None:
                            open_rides = await presence.present_rides_shared(
                                open_rides,
                                passenger_presence,
                            )
                    else:
                        open_rides = presence.present_rides(open_rides)
                    captured = replace(
                        captured,
                        open_rides=open_rides,
                    )
                    await websocket.send_json(
                        build_driver_snapshot_message_v2(captured).model_dump(
                            mode="json"
                        )
                    )
                else:
                    open_rides_page = Page(items=[])
                    if user.is_online:
                        open_rides_page = await ListOpenRides(rides).execute(user)
                        if settings.realtime_shared_presence_enabled:
                            if passenger_presence is not None:
                                open_rides_page = await presence.present_rides_shared(
                                    open_rides_page,
                                    passenger_presence,
                                )
                        else:
                            open_rides_page = presence.present_rides(open_rides_page)
                    snapshot = OpenRidePageResponse.from_page(open_rides_page)
                    paused_snapshot = [
                        OpenRideResponse.from_open_ride(detail)
                        for detail in await rides.list_paused_with_rider_for_driver(user.id)
                    ]
                    offer_snapshot = [
                        OfferResponse.from_detail(OfferDetail(offer=offer, driver=user))
                        for offer in active_offers
                    ]
                    # 2) active ride (recovers an offer_accepted that was lost).
                    active_detail = await GetDriverActiveRide(ride_reads).execute(user)

                    # Authoritative legacy handshake, always in this order.
                    await _send_message(
                        websocket,
                        OpenRidesSnapshotMessage(data=snapshot),
                    )
                    await _send_message(
                        websocket,
                        PausedRidesSnapshotMessage(data=paused_snapshot),
                    )
                    await _send_message(
                        websocket,
                        DriverOffersSnapshotMessage(data=offer_snapshot),
                    )
                    if active_detail is not None:
                        await _send_message(
                            websocket,
                            DriverActiveRideMessage(
                                data=RideResponse.from_detail(active_detail)
                            ),
                        )

        # Broadcast after the handshake; the same socket is already subscribed.
        for offer in expired_offers:
            await events.publish_offer_expired(offer)
        await _guarded_drain(websocket, _drain(websocket), token, session_factory, settings)
    finally:
        for topic in topics:
            hub.unsubscribe(topic, websocket)
