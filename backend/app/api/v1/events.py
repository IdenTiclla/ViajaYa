"""Publishing negotiation events over WebSocket.

It lives in the API layer (not in the use cases) because publishing is a
transport detail: it translates the DTOs/entities the use cases already return into
``{type, data}`` messages and broadcasts them through the :data:`hub`. HTTP routers
call these functions after a successful use case.
"""

from __future__ import annotations

import uuid

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.realtime import (
    NegotiationMessage,
    OfferAcceptedMessage,
    OfferCreatedMessage,
    OfferExpiredData,
    OfferExpiredMessage,
    OfferRejectedData,
    OfferRejectedMessage,
    OfferRejectedReason,
    OffersWithdrawnData,
    OffersWithdrawnMessage,
    OfferWithdrawnData,
    OfferWithdrawnMessage,
    OfferWithdrawnReason,
    RideClosedData,
    RideClosedMessage,
    RideClosedReason,
    RideCreatedMessage,
    RidePausedData,
    RidePausedMessage,
    RideStatusMessage,
    WithdrawnOfferReferenceData,
    dump_negotiation_message,
)
from app.api.v1.schemas.rides import OpenRideResponse, RideResponse
from app.application.dto import (
    AcceptOfferResult,
    CancelRideResult,
    CreateOfferResult,
    DriverAvailabilityResult,
    OfferDetail,
    PendingRealtimeEvent,
    RideDetail,
    RidePausedResult,
    RideRepublishedResult,
)
from app.domain.entities import Offer, ServiceType
from app.domain.repositories import OpenRideDetail
from app.infrastructure.correlation import current_correlation_id
from app.infrastructure.realtime.hub import (
    driver_topic,
    hub,
    pool_topic,
    ride_topic,
)


async def _broadcast(topic: str, message: NegotiationMessage) -> None:
    await hub.broadcast(topic, dump_negotiation_message(message))


async def _broadcast_pending(events: list[PendingRealtimeEvent]) -> None:
    """Direct delivery of an already serialized batch with the canonical contract.

    While the outbox runs in shadow mode, this is still the path that reaches the
    sockets. Reusing the same batch keeps both paths from drifting into a different
    payload or order.
    """
    for event in events:
        await hub.broadcast(event.topic, event.payload)


def _pending_offer_event(
    ride_id: uuid.UUID, message: NegotiationMessage
) -> PendingRealtimeEvent:
    return _pending_realtime_event(
        topic=ride_topic(ride_id),
        aggregate_type="ride",
        aggregate_id=ride_id,
        message=message,
    )


def _pending_realtime_event(
    *,
    topic: str,
    aggregate_type: str,
    aggregate_id: uuid.UUID,
    message: NegotiationMessage,
) -> PendingRealtimeEvent:
    return PendingRealtimeEvent(
        event_type=message.type,
        topic=topic,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        correlation_id=current_correlation_id(),
        payload=dump_negotiation_message(message),
    )


def build_create_offer_events(result: CreateOfferResult) -> list[PendingRealtimeEvent]:
    """Build the durable/direct batch for creating or replacing an offer."""
    detail = result.detail
    ride_id = detail.offer.ride_id
    pending: list[PendingRealtimeEvent] = []
    if result.superseded_offer_id is not None:
        pending.append(
            _pending_offer_event(
                ride_id,
                OfferWithdrawnMessage(
                    data=OfferWithdrawnData(
                        driver_id=detail.driver.id,
                        offer_id=result.superseded_offer_id,
                        reason="superseded",
                    )
                ),
            )
        )
    pending.append(
        _pending_offer_event(
            ride_id,
            OfferCreatedMessage(data=OfferResponse.from_detail(detail)),
        )
    )
    return pending


def build_accept_offer_events(result: AcceptOfferResult) -> list[PendingRealtimeEvent]:
    """Build the durable/direct fan-out of an atomic acceptance."""
    ride = result.detail.ride
    driver = result.detail.driver
    if driver is None:
        raise ValueError("A successful acceptance must include the chosen driver.")
    ride_response = RideResponse.from_detail(result.detail)
    withdrawn_offers = sorted(
        result.withdrawn_offers,
        key=lambda item: (item.ride_id.hex, item.offer_id.hex),
    )
    pending = [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideStatusMessage(data=ride_response),
        ),
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideClosedMessage(
                data=RideClosedData(
                    ride_id=ride.id,
                    pool_version=ride.pool_version,
                    reason="terminal",
                )
            ),
        ),
    ]
    pending.extend(
        [
            _pending_realtime_event(
                topic=driver_topic(driver.id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=OfferAcceptedMessage(data=ride_response),
            ),
            _pending_realtime_event(
                topic=driver_topic(driver.id),
                aggregate_type="driver",
                aggregate_id=driver.id,
                message=OffersWithdrawnMessage(
                    data=OffersWithdrawnData(
                        ride_ids=[offer.ride_id for offer in withdrawn_offers],
                        offers=[
                            WithdrawnOfferReferenceData(
                                ride_id=offer.ride_id,
                                offer_id=offer.offer_id,
                            )
                            for offer in withdrawn_offers
                        ],
                    )
                ),
            ),
        ]
    )
    for withdrawn_offer in withdrawn_offers:
        pending.append(
            _pending_realtime_event(
                topic=ride_topic(withdrawn_offer.ride_id),
                aggregate_type="ride",
                aggregate_id=withdrawn_offer.ride_id,
                message=OfferWithdrawnMessage(
                    data=OfferWithdrawnData(
                        driver_id=driver.id,
                        offer_id=withdrawn_offer.offer_id,
                    )
                )
            )
        )

    for loser_id in sorted(result.losing_driver_ids, key=lambda item: item.hex):
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(loser_id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=OfferRejectedMessage(
                    data=OfferRejectedData(
                        ride_id=ride.id,
                        offer_id=None,
                        reason="ride_taken",
                    )
                ),
            )
        )
    return pending


def build_pause_ride_events(result: RidePausedResult) -> list[PendingRealtimeEvent]:
    """Build the durable/direct fan-out of pausing a request."""
    ride = result.ride
    open_ride = OpenRideResponse.from_open_ride(result.open_detail)
    pending = [
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideClosedMessage(
                data=RideClosedData(
                    ride_id=ride.id,
                    pool_version=ride.pool_version,
                    reason="paused",
                )
            ),
        )
    ]
    for offer in sorted(result.paused_offers, key=lambda item: item.id.hex):
        pending.extend(
            [
                _pending_realtime_event(
                    topic=ride_topic(ride.id),
                    aggregate_type="ride",
                    aggregate_id=ride.id,
                    message=OfferWithdrawnMessage(
                        data=OfferWithdrawnData(
                            driver_id=offer.driver_id,
                            offer_id=offer.id,
                        )
                    ),
                ),
                _pending_realtime_event(
                    topic=driver_topic(offer.driver_id),
                    aggregate_type="ride",
                    aggregate_id=ride.id,
                    message=RidePausedMessage(
                        data=RidePausedData.from_open_ride(open_ride, offer.id)
                    ),
                ),
            ]
        )
    return pending


def build_cancel_ride_events(result: CancelRideResult) -> list[PendingRealtimeEvent]:
    """Build the durable/direct fan-out of a cancellation."""
    ride = result.detail.ride
    message = RideStatusMessage(data=RideResponse.from_detail(result.detail))
    pending = [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=message,
        )
    ]
    if result.detail.driver is not None:
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(result.detail.driver.id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=message,
            )
        )
    pending.append(
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideClosedMessage(
                data=RideClosedData(
                    ride_id=ride.id,
                    pool_version=ride.pool_version,
                    reason="terminal",
                )
            ),
        )
    )
    for offer in sorted(result.cancelled_offers, key=lambda item: item.id.hex):
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(offer.driver_id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=OfferRejectedMessage(
                    data=OfferRejectedData(
                        ride_id=ride.id,
                        offer_id=offer.id,
                        reason="ride_cancelled",
                    )
                ),
            )
        )
    return pending


def build_republish_ride_events(
    result: RideRepublishedResult,
) -> list[PendingRealtimeEvent]:
    """Build the durable/direct batch of a pool renewal."""
    ride = result.ride
    return [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideStatusMessage(data=RideResponse.from_detail(result.detail)),
        ),
        _pending_realtime_event(
            topic=pool_topic(ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=RideCreatedMessage(
                data=OpenRideResponse.from_open_ride(result.open_detail)
            ),
        ),
    ]


def build_announce_open_ride_events(
    detail: OpenRideDetail,
) -> list[PendingRealtimeEvent]:
    """Build the durable/direct announcement when presence is confirmed."""
    return [
        _pending_realtime_event(
            topic=pool_topic(detail.ride.service_type.value),
            aggregate_type="ride",
            aggregate_id=detail.ride.id,
            message=RideCreatedMessage(
                data=OpenRideResponse.from_open_ride(detail)
            ),
        )
    ]


def build_withdraw_offer_events(
    offer: Offer,
    *,
    reason: OfferWithdrawnReason | None = None,
) -> list[PendingRealtimeEvent]:
    """Build the durable/direct withdrawal of a driver's offer."""
    data = OfferWithdrawnData(driver_id=offer.driver_id, offer_id=offer.id)
    if reason is not None:
        data = OfferWithdrawnData(
            driver_id=offer.driver_id,
            offer_id=offer.id,
            reason=reason,
        )
    return [
        _pending_realtime_event(
            topic=ride_topic(offer.ride_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=OfferWithdrawnMessage(data=data),
        )
    ]


def build_reject_offer_events(
    offer: Offer,
    *,
    reason: OfferRejectedReason = "declined",
) -> list[PendingRealtimeEvent]:
    """Build the durable/direct rejection of an offer by the passenger."""
    return [
        _pending_realtime_event(
            topic=driver_topic(offer.driver_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=OfferRejectedMessage(
                data=OfferRejectedData(
                    ride_id=offer.ride_id,
                    offer_id=offer.id,
                    reason=reason,
                )
            ),
        )
    ]


def build_expire_offer_events(offer: Offer) -> list[PendingRealtimeEvent]:
    """Build the durable/direct fan-out of an expired offer."""
    message = OfferExpiredMessage(
        data=OfferExpiredData(
            ride_id=offer.ride_id,
            offer_id=offer.id,
            driver_id=offer.driver_id,
            reason="expired",
        )
    )
    return [
        _pending_realtime_event(
            topic=driver_topic(offer.driver_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=message,
        ),
        _pending_realtime_event(
            topic=ride_topic(offer.ride_id),
            aggregate_type="ride",
            aggregate_id=offer.ride_id,
            message=message,
        ),
    ]


def build_update_ride_status_events(
    detail: RideDetail,
) -> list[PendingRealtimeEvent]:
    """Build the durable/direct fan-out of a ride status change."""
    ride = detail.ride
    message = RideStatusMessage(data=RideResponse.from_detail(detail))
    pending = [
        _pending_realtime_event(
            topic=ride_topic(ride.id),
            aggregate_type="ride",
            aggregate_id=ride.id,
            message=message,
        )
    ]
    if detail.driver is not None:
        pending.append(
            _pending_realtime_event(
                topic=driver_topic(detail.driver.id),
                aggregate_type="ride",
                aggregate_id=ride.id,
                message=message,
            )
        )
    return pending


def build_driver_availability_events(
    result: DriverAvailabilityResult,
) -> list[PendingRealtimeEvent]:
    """Construye el fanout durable/directo de quedar offline."""
    offers = result.withdrawn_offers
    if not offers:
        return []
    pending: list[PendingRealtimeEvent] = []
    for offer in offers:
        pending.extend(
            build_withdraw_offer_events(offer, reason="driver_offline")
        )
    pending.append(
        _pending_realtime_event(
            topic=driver_topic(result.driver.id),
            aggregate_type="driver",
            aggregate_id=result.driver.id,
            message=OffersWithdrawnMessage(
                data=OffersWithdrawnData(
                    ride_ids=[offer.ride_id for offer in offers],
                    offers=[
                        WithdrawnOfferReferenceData(
                            ride_id=offer.ride_id,
                            offer_id=offer.id,
                        )
                        for offer in offers
                    ],
                    reason="driver_offline",
                )
            ),
        )
    )
    return pending


async def publish_ride_created(detail: OpenRideDetail) -> None:
    """A new (or renewed) request shows up for the drivers in the pool.

    It arrives already enriched with the passenger's data: the driver sees it on the
    card from the first ``ride_created`` (not only in the snapshot).
    """
    await _broadcast_pending(build_announce_open_ride_events(detail))


async def publish_ride_closed(
    ride_id: uuid.UUID,
    service_type: ServiceType,
    pool_version: int,
    reason: RideClosedReason,
) -> None:
    """The request is no longer open (assigned/cancelled): it leaves the pool."""
    await _broadcast(
        pool_topic(service_type.value),
        RideClosedMessage(
            data=RideClosedData(
                ride_id=ride_id,
                pool_version=pool_version,
                reason=reason,
            )
        ),
    )


async def publish_ride_paused(result: RidePausedResult) -> None:
    """The passenger paused the request to edit it: it leaves the pool and its
    live offers are withdrawn.

    - To the pool: ``RIDE_CLOSED`` (drivers **without** an offer stop seeing it; they
      cannot offer on a request that is about to change).
    - To each driver **with** a live offer: ``RIDE_PAUSED`` with the full ride
      payload, so the client keeps it in its list marked as paused
      (banner "El pasajero está modificando su solicitud" + only Remove) **for as long
      as the edit lasts**. It replaces the old ``OFFER_REJECTED {ride_paused}``, which did not
      carry the ride data and, together with ``RIDE_CLOSED``, made the card
      disappear during the edit (timing bug).
    - To the passenger: ``OFFER_WITHDRAWN`` so they remove the offer cards.
    """
    await _broadcast_pending(build_pause_ride_events(result))


async def publish_ride_cancelled(result: CancelRideResult) -> None:
    """Broadcast a cancellation using exactly the outbox batch."""
    await _broadcast_pending(build_cancel_ride_events(result))


async def publish_ride_republished(result: RideRepublishedResult) -> None:
    """Broadcast a renewal using exactly the outbox batch."""
    await _broadcast_pending(build_republish_ride_events(result))


async def publish_offer_created(detail: OfferDetail) -> None:
    """A new offer reaches the passenger who owns the ride."""
    await _broadcast_pending(
        build_create_offer_events(
            CreateOfferResult(detail=detail, superseded_offer_id=None)
        )
    )


async def publish_offer_rejected(
    offer: Offer, reason: OfferRejectedReason = "declined"
) -> None:
    """The offer died for the driver: rejected by the passenger (``declined``),
    the ride was taken by another driver (``ride_taken``) or it was cancelled
    (``ride_cancelled``).
    """
    await _broadcast_pending(build_reject_offer_events(offer, reason=reason))


async def publish_offer_expired(offer: Offer) -> None:
    """The driver's offer expired (30 s) without an answer from the passenger.

    Both sides are notified in real time: the driver stops seeing "waiting" and
    can offer again; the passenger gets the event to remove the card from their
    live list (without having to poll ``/offers`` again). The
    ``driver_id`` is included so the client can read the driver's name from its
    cache before removing the card.
    """
    await _broadcast_pending(build_expire_offer_events(offer))


async def publish_offer_withdrawn_by_driver(
    offer: Offer, *, reason: OfferWithdrawnReason | None = None
) -> None:
    """The driver withdrew (or declined to confirm) their offer: the passenger stops seeing it."""
    await _broadcast_pending(build_withdraw_offer_events(offer, reason=reason))


async def publish_driver_offline_offers(result: DriverAvailabilityResult) -> None:
    """Withdraw the offline driver's offers from both roles' screens."""
    await _broadcast_pending(build_driver_availability_events(result))


async def publish_offer_superseded(superseded_offer_id: uuid.UUID, detail: OfferDetail) -> None:
    """The driver improved their offer: the old one is withdrawn and the new one announced.

    ``reason: "superseded"`` tells this withdrawal apart from a real one: the client
    removes the old card without saying "withdrew their offer" (the immediate
    ``offer_created`` already announces the new amount).
    """
    await _broadcast_pending(
        build_create_offer_events(
            CreateOfferResult(
                detail=detail,
                superseded_offer_id=superseded_offer_id,
            )
        )
    )


async def publish_ride_status(detail: RideDetail) -> None:
    """Ride status change: to the owning passenger and the assigned driver.

    The driver also receives it on their personal channel to learn live about
    changes they did not start (e.g. the passenger cancelled the ride).
    """
    await _broadcast_pending(build_update_ride_status_events(detail))


async def publish_offer_accepted(result: AcceptOfferResult) -> None:
    """Broadcast the outcome of the passenger's acceptance (the "golden rule").

    - To the owning passenger: the ride becomes ``accepted``.
    - To the chosen driver: ``offer_accepted`` (they go to their navigation screen) and
      ``offers_withdrawn`` (their other offers were withdrawn).
    - To the **other** drivers of this ride: ``offer_rejected`` with reason
      ``ride_taken`` (the passenger chose someone else).
    - To the driver's **other** passengers: ``offer_withdrawn`` (so they remove the
      driver from their screen).
    - To the pool: the request is closed.
    """
    await _broadcast_pending(build_accept_offer_events(result))
