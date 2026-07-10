"""Caso de uso: resumen de ganancias del conductor."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.application.dto import DriverEarnings, EarningsItem
from app.domain.entities import RideStatus, User
from app.domain.exceptions import NotAuthorizedActionError
from app.domain.repositories import OfferRepository, RideRequestRepository

# Cuántos viajes recientes se devuelven en el desglose.
_RECENT_LIMIT = 10
_BUSINESS_TIMEZONE = ZoneInfo("America/La_Paz")


def _as_utc(moment: datetime) -> datetime:
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


class GetDriverEarnings:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None:
        self._rides = rides
        self._offers = offers

    async def execute(self, driver: User) -> DriverEarnings:
        if not driver.is_driver:
            raise NotAuthorizedActionError("Solo los conductores tienen ganancias.")

        rides = await self._rides.list_by_driver(driver.id)
        completed = [r for r in rides if r.status is RideStatus.COMPLETED]
        completed.sort(
            key=lambda ride: _as_utc(ride.completed_at or ride.created_at)
            if (ride.completed_at or ride.created_at)
            else datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )

        today = datetime.now(_BUSINESS_TIMEZONE).date()
        items: list[EarningsItem] = []
        total_today = Decimal("0")
        total_all = Decimal("0")
        trips_today = 0

        for ride in completed:
            # Precio acordado: oferta aceptada o, en su defecto, el fare ofertado.
            price = ride.fare
            if ride.accepted_offer_id is not None:
                offer = await self._offers.get_by_id(ride.accepted_offer_id)
                if offer is not None:
                    price = offer.price

            total_all += price
            completed_at = ride.completed_at or ride.created_at
            if (
                completed_at is not None
                and _as_utc(completed_at).astimezone(_BUSINESS_TIMEZONE).date() == today
            ):
                total_today += price
                trips_today += 1

            items.append(
                EarningsItem(
                    ride_id=ride.id,
                    destination_name=ride.destination.name,
                    price=price,
                    completed_at=completed_at,
                )
            )

        return DriverEarnings(
            total_today=total_today,
            trips_today=trips_today,
            total_all_time=total_all,
            trips_all_time=len(completed),
            recent=items[:_RECENT_LIMIT],
        )
