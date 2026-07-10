"""Caso de uso: crear una solicitud de viaje."""

from __future__ import annotations

from app.application.dto import CreateRideRequestInput
from app.domain.entities import Location, RideRequest, User, UserRole
from app.domain.exceptions import NotAuthorizedActionError, RideAlreadyActiveError
from app.domain.repositories import RideRequestRepository
from app.domain.value_objects import FareOffer, GeoPoint


class CreateRideRequest:
    def __init__(self, rides: RideRequestRepository) -> None:
        self._rides = rides

    async def execute(self, rider: User, data: CreateRideRequestInput) -> RideRequest:
        if rider.role is not UserRole.PASSENGER:
            raise NotAuthorizedActionError("Solo los pasajeros pueden solicitar viajes.")

        # Validan reglas de dominio (rango de coordenadas, oferta positiva).
        origin_point = GeoPoint(data.origin.latitude, data.origin.longitude)
        destination_point = GeoPoint(data.destination.latitude, data.destination.longitude)
        fare = FareOffer(data.fare)

        ride = RideRequest(
            rider_id=rider.id,
            origin=Location(
                latitude=origin_point.latitude,
                longitude=origin_point.longitude,
                name=data.origin.name.strip(),
                address=data.origin.address.strip(),
            ),
            destination=Location(
                latitude=destination_point.latitude,
                longitude=destination_point.longitude,
                name=data.destination.name.strip(),
                address=data.destination.address.strip(),
            ),
            service_type=data.service_type,
            fare=fare.amount,
            payment_method=data.payment_method,
        )
        created = await self._rides.add_if_no_active(ride)
        if created is None:
            raise RideAlreadyActiveError("Ya tienes una solicitud o un viaje activo.")
        return created
