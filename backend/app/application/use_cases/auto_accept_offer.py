"""Use case: accept a new offer on the passenger's behalf when the request allows it.

A passenger who enables ``RideRequest.auto_accept`` hands the decision to the
first driver who accepts their fare. Right after an offer is created, this use
case checks the request and, when the offer asks for no more than the
passenger's fare, runs the regular :class:`AcceptOffer` flow as that passenger:
the same atomic assignment and the same events. Counter-offers above the fare
are never accepted automatically.

Losing a race (another acceptance, a cancellation, a pause or an expiry) is not
an error for the driver who offered: the offer simply stays live and the
passenger keeps the final say, exactly as without the option.
"""

from __future__ import annotations

from app.application.dto import AcceptOfferResult
from app.application.use_cases.accept_offer import AcceptOffer
from app.domain.entities import Offer, RideStatus
from app.domain.exceptions import DomainError
from app.domain.repositories import RideRequestRepository, UserRepository


class AutoAcceptOffer:
    def __init__(
        self,
        rides: RideRequestRepository,
        users: UserRepository,
        accept_offer: AcceptOffer,
    ) -> None:
        self._rides = rides
        self._users = users
        self._accept_offer = accept_offer

    async def execute(self, offer: Offer) -> AcceptOfferResult | None:
        """Return the acceptance when it happened, ``None`` when the offer stays live."""
        ride = await self._rides.get_by_id(offer.ride_id)
        if ride is None or not ride.auto_accept:
            return None
        if ride.status is not RideStatus.SEARCHING or ride.paused:
            return None
        if offer.price > ride.fare:
            return None
        rider = await self._users.get_by_id(ride.rider_id)
        if rider is None:
            return None
        try:
            return await self._accept_offer.execute(rider, offer.id)
        except DomainError:
            # AcceptOffer already rolled back; the offer keeps waiting for the passenger.
            return None
