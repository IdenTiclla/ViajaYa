"""Caso de uso: repara acciones durables ausentes durante un despliegue."""

from __future__ import annotations

from app.application.interfaces import MissingScheduledActionsReconciler, UnitOfWork


class ReconcileMissingScheduledActions:
    """Persist a bounded batch and confirm the repair in a single UoW."""

    def __init__(
        self,
        reconciler: MissingScheduledActionsReconciler,
        unit_of_work: UnitOfWork,
    ) -> None:
        self._reconciler = reconciler
        self._unit_of_work = unit_of_work

    async def execute(self, action_limit: int) -> int:
        if action_limit <= 0:
            raise ValueError("The reconciliation limit must be positive.")
        try:
            created_count = await self._reconciler.reconcile(action_limit)
            await self._unit_of_work.commit()
            return created_count
        except BaseException:
            await self._unit_of_work.rollback()
            raise
