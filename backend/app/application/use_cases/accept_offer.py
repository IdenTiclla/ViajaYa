"""Use case: the passenger accepts an offer (direct ride assignment).

The passenger has the final say: accepting a ``PENDING`` offer assigns the
ride to that driver in an atomic transaction
(:meth:`OfferRepository.accept_atomically`). The ride's other live offers
become ``REJECTED`` and the driver's other live offers on other rides are
withdrawn.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from app.application.dto import AcceptOfferResult, RideDetail
from app.application.interfaces import AcceptOfferEventRecorder, UnitOfWork
from app.domain.entities import OfferStatus, RideStatus, User
from app.domain.exceptions import (
    DriverUnavailableError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    OfferNotFoundError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository
from app.domain.ride_policy import is_offer_expired


async def _utc_now() -> datetime:
    return datetime.now(UTC)


class AcceptOffer:
    def __init__(
        self,
        rides: RideRequestRepository,
        offers: OfferRepository,
        unit_of_work: UnitOfWork,
        event_recorder: AcceptOfferEventRecorder,
        clock: Callable[[], Awaitable[datetime]] = _utc_now,
    ) -> None:
        self._rides = rides
        self._offers = offers
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder
        self._clock = clock

    async def execute(self, rider: User, offer_id: uuid.UUID) -> AcceptOfferResult:
        try:
            result = await self._mutate(rider, offer_id)
            await self._event_recorder.record(result)
            await self._unit_of_work.commit()
            return result
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _mutate(self, rider: User, offer_id: uuid.UUID) -> AcceptOfferResult:
        offer = await self._offers.get_by_id(offer_id)
        if offer is None:
            raise OfferNotFoundError("La oferta no existe.")

        ride = await self._rides.get_by_id(offer.ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No puedes aceptar ofertas de este viaje.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError("El viaje ya no está buscando conductor.")
        if offer.status is not OfferStatus.PENDING:
            raise InvalidRideTransitionError("La oferta ya no está disponible.")
        if is_offer_expired(offer, await self._clock()):
            raise InvalidRideTransitionError("La oferta expiró; elige otra.")
        # Atomic assignment: re-checks under lock that the offer is still PENDING,
        # the ride SEARCHING, the driver free and the TTL against the DB clock.
        # If anything changed (race with cancel, expiry, withdrawal or an earlier accept),
        # it returns None → 409.
        acceptance = await self._offers.accept_atomically(offer_id)
        if acceptance is None:
            raise DriverUnavailableError("El viaje ya no está disponible.")

        return AcceptOfferResult(
            detail=RideDetail(
                ride=acceptance.ride,
                rider=rider,
                driver=acceptance.driver,
                accepted_offer=acceptance.accepted_offer,
            ),
            withdrawn_offers=acceptance.withdrawn_offers,
            losing_driver_ids=acceptance.losing_driver_ids,
        )
