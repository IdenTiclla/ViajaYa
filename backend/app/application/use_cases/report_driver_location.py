"""Accept fresh GPS only from the assigned driver while the trip is active."""

import math
from datetime import UTC, datetime
from uuid import UUID

from app.application.driver_location_channel import DriverLocationChannel
from app.domain.driver_location import TRACKED_RIDE_STATUSES, DriverLocation
from app.domain.entities import User, UserRole
from app.domain.exceptions import (
    InvalidLocationError,
    InvalidRideTransitionError,
    NotAuthorizedActionError,
    RideNotFoundError,
)
from app.domain.repositories import RideRequestRepository


class ReportDriverLocation:
    def __init__(self, rides: RideRequestRepository, channel: DriverLocationChannel):
        self._rides = rides
        self._channel = channel

    async def execute(
        self,
        user: User,
        ride_id: UUID,
        *,
        latitude: float,
        longitude: float,
        accuracy_meters: float,
        captured_at: datetime,
        heading: float | None = None,
    ) -> bool:
        ride = await self._rides.get_by_id(ride_id)
        if ride is None:
            raise RideNotFoundError("El viaje no existe.")
        if user.role is not UserRole.DRIVER or ride.driver_id != user.id:
            raise NotAuthorizedActionError(
                "Solo el conductor asignado puede compartir su ubicación."
            )
        if ride.status not in TRACKED_RIDE_STATUSES:
            raise InvalidRideTransitionError("El viaje ya no admite actualizaciones de ubicación.")
        now = datetime.now(UTC)
        if captured_at.tzinfo is None or not -5 <= (now - captured_at).total_seconds() <= 60:
            raise InvalidLocationError(
                "La ubicación está desactualizada. Espera una señal GPS nueva."
            )
        if not (
            math.isfinite(latitude)
            and -90 <= latitude <= 90
            and math.isfinite(longitude)
            and -180 <= longitude <= 180
            and math.isfinite(accuracy_meters)
            and 0 <= accuracy_meters <= 100
            and (heading is None or math.isfinite(heading) and 0 <= heading < 360)
        ):
            raise InvalidLocationError("La señal GPS no tiene suficiente precisión.")
        return await self._channel.publish(
            DriverLocation(
                ride_id=ride_id,
                driver_id=user.id,
                latitude=latitude,
                longitude=longitude,
                accuracy_meters=accuracy_meters,
                captured_at=captured_at.astimezone(UTC),
                received_at=now,
                heading=heading,
            )
        )
