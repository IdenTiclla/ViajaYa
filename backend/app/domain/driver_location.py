"""Latest authorized trip position; no historical GPS trail is retained."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.domain.entities import RideStatus

TRACKED_RIDE_STATUSES = {RideStatus.ACCEPTED, RideStatus.ARRIVING, RideStatus.IN_PROGRESS}
LOCATION_RETENTION_SECONDS = 120


@dataclass(frozen=True)
class DriverLocation:
    ride_id: UUID
    driver_id: UUID
    latitude: float
    longitude: float
    accuracy_meters: float
    heading: float | None
    captured_at: datetime
    received_at: datetime
