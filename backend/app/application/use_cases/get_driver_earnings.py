"""Use case: the driver's earnings summary."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.application.dto import DriverEarnings
from app.application.interfaces import RideReadRepository
from app.domain.entities import User
from app.domain.exceptions import NotAuthorizedActionError

# How many recent rides are returned in the breakdown.
_RECENT_LIMIT = 10
_BUSINESS_TIMEZONE = ZoneInfo("America/La_Paz")


class GetDriverEarnings:
    def __init__(self, ride_reads: RideReadRepository) -> None:
        self._ride_reads = ride_reads

    async def execute(self, driver: User) -> DriverEarnings:
        if not driver.is_driver:
            raise NotAuthorizedActionError("Solo los conductores tienen ganancias.")

        today = datetime.now(_BUSINESS_TIMEZONE).date()
        day_start = datetime.combine(today, time.min, tzinfo=_BUSINESS_TIMEZONE)
        day_end = day_start + timedelta(days=1)
        return await self._ride_reads.get_driver_earnings_summary(
            driver.id,
            day_start.astimezone(UTC),
            day_end.astimezone(UTC),
            _RECENT_LIMIT,
        )
