"""SQLAlchemy reconciliation of missing durable actions."""

from __future__ import annotations

from datetime import UTC, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto import PendingScheduledAction
from app.application.interfaces import MissingScheduledActionsReconciler
from app.domain.entities import OfferStatus, RideStatus
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.db.models import (
    OfferModel,
    RideRequestModel,
    ScheduledActionModel,
)
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)


class SqlAlchemyMissingOfferScheduledActionsReconciler(
    MissingScheduledActionsReconciler
):
    """Repair in batches the window between the migration and the new producer."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def reconcile(self, action_limit: int) -> int:
        if action_limit <= 0:
            raise ValueError("The reconciliation limit must be positive.")

        already_scheduled = (
            select(ScheduledActionModel.id)
            .where(
                ScheduledActionModel.action_type == "expire_offer",
                ScheduledActionModel.aggregate_id == OfferModel.id,
                ScheduledActionModel.generation == 1,
            )
            .exists()
        )
        missing = (
            await self._session.execute(
                select(OfferModel.id, OfferModel.created_at)
                .where(
                    OfferModel.status == OfferStatus.PENDING,
                    ~already_scheduled,
                )
                .order_by(OfferModel.created_at, OfferModel.id)
                .limit(action_limit)
            )
        ).all()
        actions = SqlAlchemyScheduledActionRepository(self._session)
        for offer_id, created_at in missing:
            created_at = (
                created_at.replace(tzinfo=UTC)
                if created_at.tzinfo is None
                else created_at.astimezone(UTC)
            )
            execute_at = created_at + OFFER_TTL
            await actions.schedule(
                PendingScheduledAction(
                    dedupe_key=f"expire_offer:{offer_id}",
                    action_type="expire_offer",
                    aggregate_id=offer_id,
                    generation=1,
                    execute_at=execute_at,
                    payload={"offer_id": str(offer_id)},
                )
            )
        return len(missing)


class SqlAlchemyMissingPassengerPresenceActionsReconciler(
    MissingScheduledActionsReconciler
):
    """Give searches that predate the shared producer a full grace period."""

    def __init__(self, session: AsyncSession, *, grace_seconds: float) -> None:
        if grace_seconds <= 0:
            raise ValueError("The presence grace period must be positive.")
        self._session = session
        self._grace = timedelta(seconds=grace_seconds)

    async def reconcile(self, action_limit: int) -> int:
        if action_limit <= 0:
            raise ValueError("The reconciliation limit must be positive.")

        already_scheduled = (
            select(ScheduledActionModel.id)
            .where(
                ScheduledActionModel.action_type == "cancel_absent_ride",
                ScheduledActionModel.aggregate_id == RideRequestModel.id,
            )
            .exists()
        )
        ride_ids = (
            await self._session.execute(
                select(RideRequestModel.id)
                .where(
                    RideRequestModel.status == RideStatus.SEARCHING,
                    ~already_scheduled,
                )
                .order_by(RideRequestModel.created_at, RideRequestModel.id)
                .limit(action_limit)
            )
        ).scalars().all()
        if not ride_ids:
            return 0

        database_now = (await self._session.scalar(select(func.now())))
        assert database_now is not None
        database_now = (
            database_now.replace(tzinfo=UTC)
            if database_now.tzinfo is None
            else database_now.astimezone(UTC)
        )
        actions = SqlAlchemyScheduledActionRepository(self._session)
        for ride_id in ride_ids:
            await actions.schedule(
                PendingScheduledAction(
                    dedupe_key=f"cancel_absent_ride:{ride_id}",
                    action_type="cancel_absent_ride",
                    aggregate_id=ride_id,
                    generation=1,
                    execute_at=database_now + self._grace,
                    payload={"ride_id": str(ride_id)},
                )
            )
        return len(ride_ids)


class CompositeMissingScheduledActionsReconciler(MissingScheduledActionsReconciler):
    """Run one bounded batch per independent action class."""

    def __init__(self, *reconcilers: MissingScheduledActionsReconciler) -> None:
        if not reconcilers:
            raise ValueError("At least one reconciler is required.")
        self._reconcilers = reconcilers

    async def reconcile(self, action_limit: int) -> int:
        if action_limit <= 0:
            raise ValueError("The reconciliation limit must be positive.")
        created_count = 0
        for reconciler in self._reconcilers:
            created_count += await reconciler.reconcile(action_limit)
        return created_count
