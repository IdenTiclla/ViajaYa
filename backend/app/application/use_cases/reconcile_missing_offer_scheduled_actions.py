"""Caso de uso: repara expiraciones ausentes durante un rolling deploy."""

from __future__ import annotations

from app.application.interfaces import (
    MissingOfferScheduledActionsReconciler,
    UnitOfWork,
)


class ReconcileMissingOfferScheduledActions:
    """Persiste un lote acotado y confirma la reparación en una sola UoW."""

    def __init__(
        self,
        reconciler: MissingOfferScheduledActionsReconciler,
        unit_of_work: UnitOfWork,
    ) -> None:
        self._reconciler = reconciler
        self._unit_of_work = unit_of_work

    async def execute(self, action_limit: int) -> int:
        if action_limit <= 0:
            raise ValueError("El límite de reconciliación debe ser positivo.")
        try:
            created_count = await self._reconciler.reconcile(action_limit)
            await self._unit_of_work.commit()
            return created_count
        except BaseException:
            await self._unit_of_work.rollback()
            raise
