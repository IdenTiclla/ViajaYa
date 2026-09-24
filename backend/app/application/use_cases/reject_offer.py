"""Use case: the passenger rejects a specific offer on their ride.

Unlike accepting, rejecting does NOT assign a driver: it only discards that offer
(e.g. the passenger does not want that driver). The driver is notified via
WebSocket and their waiting screen stops showing it as current.
"""

from __future__ import annotations

import uuid

from app.application.interfaces import RejectOfferEventRecorder, UnitOfWork
from app.domain.entities import ACTIVE_OFFER_STATUSES, Offer, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    OfferNotFoundError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository


class RejectOffer:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        unit_of_work: UnitOfWork,
        event_recorder: RejectOfferEventRecorder,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder

    async def execute(self, rider: User, offer_id: uuid.UUID) -> Offer:
        try:
            offer = await self._reject(rider, offer_id)
            await self._event_recorder.record(offer)
            await self._unit_of_work.commit()
            return offer
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _reject(self, rider: User, offer_id: uuid.UUID) -> Offer:
        offer = await self._offers.get_by_id(offer_id)
        if offer is None:
            raise OfferNotFoundError("La oferta no existe.")

        ride = await self._rides.get_by_id(offer.ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No puedes rechazar ofertas de este viaje.")
        # Only a pending (active) offer can be rejected. The driver is notified
        # via WebSocket and their waiting screen stops showing it as current.
        if offer.status not in ACTIVE_OFFER_STATUSES:
            raise InvalidRideTransitionError("La oferta ya no está disponible.")

        rejected = await self._offers.reject_if_pending(offer.id)
        if rejected is None:
            raise InvalidRideTransitionError("La oferta ya no está disponible.")
        return rejected
