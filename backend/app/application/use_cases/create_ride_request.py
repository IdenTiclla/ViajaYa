"""Use case: create a ride request."""

from __future__ import annotations

from datetime import UTC, timedelta

from app.application.dto import CreateRideRequestInput, RenewableScheduledAction
from app.application.interfaces import ScheduledActionScheduler, UnitOfWork
from app.domain.entities import Location, RideRequest, User, UserRole
from app.domain.exceptions import NotAuthorizedActionError, RideAlreadyActiveError
from app.domain.repositories import RideRequestRepository
from app.domain.value_objects import FareOffer, ServiceAreaPoint


class CreateRideRequest:
    def __init__(
        self,
        rides: RideRequestRepository,
        unit_of_work: UnitOfWork,
        scheduled_actions: ScheduledActionScheduler | None = None,
        *,
        passenger_presence_grace_seconds: float = 120.0,
    ) -> None:
        if passenger_presence_grace_seconds <= 0:
            raise ValueError("The presence grace period must be positive.")
        self._rides = rides
        self._unit_of_work = unit_of_work
        self._scheduled_actions = scheduled_actions
        self._passenger_presence_grace = timedelta(
            seconds=passenger_presence_grace_seconds
        )

    async def execute(self, rider: User, data: CreateRideRequestInput) -> RideRequest:
        try:
            ride = await self._create(rider, data)
            await self._schedule_initial_absence_check(ride)
            await self._unit_of_work.commit()
            return ride
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _create(
        self,
        rider: User,
        data: CreateRideRequestInput,
    ) -> RideRequest:
        if rider.role is not UserRole.PASSENGER:
            raise NotAuthorizedActionError("Solo los pasajeros pueden solicitar viajes.")

        # Validates range, operating country and a positive fare.
        origin_point = ServiceAreaPoint(
            data.origin.latitude, data.origin.longitude, data.origin.country_code
        )
        destination_point = ServiceAreaPoint(
            data.destination.latitude,
            data.destination.longitude,
            data.destination.country_code,
        )
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

    async def _schedule_initial_absence_check(self, ride: RideRequest) -> None:
        """Covers the window between creating the search and opening its first channel."""
        if self._scheduled_actions is None:
            return
        if ride.created_at is None:  # pragma: no cover - persistencia exige timestamp
            raise RuntimeError("The persisted request has no creation date.")
        created_at = (
            ride.created_at.replace(tzinfo=UTC)
            if ride.created_at.tzinfo is None
            else ride.created_at.astimezone(UTC)
        )
        await self._scheduled_actions.schedule_next(
            RenewableScheduledAction(
                dedupe_key=f"cancel_absent_ride:{ride.id}",
                action_type="cancel_absent_ride",
                aggregate_id=ride.id,
                execute_at=created_at + self._passenger_presence_grace,
                payload={"ride_id": str(ride.id)},
            )
        )
