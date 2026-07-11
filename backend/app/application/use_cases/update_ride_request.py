"""Caso de uso: el pasajero actualiza su solicitud mientras busca conductor."""

from __future__ import annotations

import uuid

from app.application.dto import CreateRideRequestInput, UpdateRideResult
from app.domain.entities import ACTIVE_OFFER_STATUSES, RideStatus, User
from app.domain.exceptions import (
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import OfferRepository, RideRequestRepository
from app.domain.value_objects import FareOffer, ServiceAreaPoint


class UpdateRideRequest:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(
        self, rider: User, ride_id: uuid.UUID, data: CreateRideRequestInput
    ) -> UpdateRideResult:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("La solicitud de viaje no existe.")
        if ride.rider_id != rider.id:
            raise NotAuthorizedActionError("No puedes modificar esta solicitud.")
        if ride.status is not RideStatus.SEARCHING:
            raise InvalidRideTransitionError(
                "Solo puedes modificar una solicitud que sigue buscando conductor."
            )

        previous_service_type = ride.service_type
        origin_point = ServiceAreaPoint(
            data.origin.latitude, data.origin.longitude, data.origin.country_code
        )
        destination_point = ServiceAreaPoint(
            data.destination.latitude,
            data.destination.longitude,
            data.destination.country_code,
        )
        fare = FareOffer(data.fare)

        from app.domain.entities import Location

        ride.origin = Location(
            latitude=origin_point.latitude,
            longitude=origin_point.longitude,
            name=data.origin.name.strip(),
            address=data.origin.address.strip(),
        )
        ride.destination = Location(
            latitude=destination_point.latitude,
            longitude=destination_point.longitude,
            name=data.destination.name.strip(),
            address=data.destination.address.strip(),
        )
        ride.service_type = data.service_type
        ride.fare = fare.amount
        ride.payment_method = data.payment_method

        # Ofertas previas ya no aplican: avisamos a cada conductor antes de rechazarlas.
        rejected_offers = [
            o
            for o in await self._offers.list_by_ride(ride_id)
            if o.status in ACTIVE_OFFER_STATUSES
        ]
        updated = await self._rides.update(ride)
        await self._offers.reject_pending(ride_id)
        return UpdateRideResult(
            ride=updated,
            previous_service_type=previous_service_type,
            rejected_offers=rejected_offers,
        )
