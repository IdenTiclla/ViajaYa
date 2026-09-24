"""Use case: validate presence and close a search from the scheduler."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.application.dto import (
    CancelRideResult,
    ExecuteCancelAbsentRideScheduledActionResult,
    RenewableScheduledAction,
    RideDetail,
    ScheduledAction,
)
from app.application.exceptions import (
    InvalidScheduledActionError,
    PassengerPresenceUnavailableError,
)
from app.application.interfaces import (
    CancelRideEventRecorder,
    PassengerPresenceLeaseStore,
    ScheduledActionQueue,
    UnitOfWork,
)
from app.domain.exceptions import RideNotFoundError
from app.domain.repositories import OfferRepository, UserRepository


class ExecuteCancelAbsentRideScheduledAction:
    def __init__(
        self,
        offers: OfferRepository,
        users: UserRepository,
        actions: ScheduledActionQueue,
        unit_of_work: UnitOfWork,
        event_recorder: CancelRideEventRecorder,
        leases: PassengerPresenceLeaseStore,
        *,
        unavailable_recheck_seconds: float,
    ) -> None:
        self._offers = offers
        self._users = users
        self._actions = actions
        self._unit_of_work = unit_of_work
        self._event_recorder = event_recorder
        self._leases = leases
        self._unavailable_recheck_seconds = unavailable_recheck_seconds

    async def execute(
        self,
        action: ScheduledAction,
        completed_at: datetime,
    ) -> ExecuteCancelAbsentRideScheduledActionResult:
        if (
            action.action_type != "cancel_absent_ride"
            or action.payload != {"ride_id": str(action.aggregate_id)}
            or action.lock_token is None
        ):
            raise InvalidScheduledActionError(
                "The cancel_absent_ride action does not match its aggregate."
            )
        try:
            owned = await self._actions.lock_owned(
                action.id,
                action.generation,
                action.lock_token,
            )
            if not owned:
                await self._unit_of_work.rollback()
                return ExecuteCancelAbsentRideScheduledActionResult(
                    status="lost_lease"
                )

            try:
                observation = await self._leases.observe(action.aggregate_id)
            except PassengerPresenceUnavailableError:
                await self._defer(
                    action,
                    completed_at,
                    self._unavailable_recheck_seconds,
                )
                await self._unit_of_work.commit()
                return ExecuteCancelAbsentRideScheduledActionResult(status="deferred")

            if observation.live or observation.present:
                await self._defer(
                    action,
                    completed_at,
                    max(
                        observation.retry_after_seconds,
                        self._unavailable_recheck_seconds,
                    ),
                )
                await self._unit_of_work.commit()
                return ExecuteCancelAbsentRideScheduledActionResult(status="deferred")

            result = await self._mutate(action)
            if result is not None:
                await self._event_recorder.record(result)
            completed = await self._actions.mark_succeeded(
                action.id,
                action.generation,
                action.lock_token,
                completed_at,
            )
            if not completed:
                await self._unit_of_work.rollback()
                return ExecuteCancelAbsentRideScheduledActionResult(
                    status="lost_lease"
                )
            await self._unit_of_work.commit()
            return ExecuteCancelAbsentRideScheduledActionResult(
                status="succeeded",
                cancelled_ride=result,
            )
        except BaseException:
            await self._unit_of_work.rollback()
            raise

    async def _defer(
        self,
        action: ScheduledAction,
        completed_at: datetime,
        delay_seconds: float,
    ) -> None:
        await self._actions.schedule_next(
            RenewableScheduledAction(
                dedupe_key=action.dedupe_key,
                action_type=action.action_type,
                aggregate_id=action.aggregate_id,
                execute_at=completed_at
                + timedelta(seconds=max(delay_seconds, 0.001)),
                payload=dict(action.payload),
            )
        )

    async def _mutate(self, action: ScheduledAction) -> CancelRideResult | None:
        transition = await self._offers.cancel_ride_on_disconnect_atomically(
            action.aggregate_id
        )
        if transition is None:
            return None
        rider = await self._users.get_by_id(transition.ride.rider_id)
        if rider is None:
            raise RideNotFoundError("No se pudo enriquecer el pasajero del viaje.")
        return CancelRideResult(
            detail=RideDetail(ride=transition.ride, rider=rider),
            cancelled_offers=transition.cancelled_offers,
        )
