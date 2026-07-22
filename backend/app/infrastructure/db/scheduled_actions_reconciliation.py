"""Reconciliación SQLAlchemy de ofertas sin expiración durable."""

from __future__ import annotations

from datetime import UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto import PendingScheduledAction
from app.application.interfaces import MissingOfferScheduledActionsReconciler
from app.domain.entities import OfferStatus
from app.domain.ride_policy import OFFER_TTL
from app.infrastructure.db.models import OfferModel, ScheduledActionModel
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)


class SqlAlchemyMissingOfferScheduledActionsReconciler(
    MissingOfferScheduledActionsReconciler
):
    """Repara por lotes la ventana entre migración y productor nuevo."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def reconcile(self, action_limit: int) -> int:
        if action_limit <= 0:
            raise ValueError("El límite de reconciliación debe ser positivo.")

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
