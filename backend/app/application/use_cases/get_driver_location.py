"""Read the latest sample only for participants of an assigned active trip."""

from uuid import UUID

from app.application.driver_location_channel import DriverLocationChannel
from app.domain.driver_location import TRACKED_RIDE_STATUSES, DriverLocation
from app.domain.entities import User
from app.domain.exceptions import NotAuthorizedActionError, RideNotFoundError
from app.domain.repositories import RideRequestRepository


class GetDriverLocation:
    def __init__(self, rides: RideRequestRepository, channel: DriverLocationChannel):
        self._rides = rides
        self._channel = channel

    async def execute(self, user: User, ride_id: UUID) -> DriverLocation | None:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("El viaje no existe.")
        if user.id not in {ride.rider_id, ride.driver_id}:
            raise NotAuthorizedActionError("No tienes acceso a la ubicación de este viaje.")
        if ride.status not in TRACKED_RIDE_STATUSES:
            return None
        location = await self._channel.latest(ride_id)
        return location if location and location.driver_id == ride.driver_id else None
