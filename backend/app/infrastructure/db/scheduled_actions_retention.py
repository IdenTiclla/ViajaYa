"""SQLAlchemy retention of successful terminal deferred actions."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.interfaces import TerminalScheduledActionsRetention
from app.infrastructure.db.models import ScheduledActionModel


class SqlAlchemyTerminalScheduledActionsRetention(TerminalScheduledActionsRetention):
    """Delete an old chunk without touching pending actions, leases or ``dead`` actions."""

    _PURGEABLE_STATUSES = ("succeeded", "cancelled")

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def purge(
        self,
        cutoff: datetime,
        action_limit: int,
    ) -> int:
        if action_limit <= 0:
            raise ValueError("The action limit must be positive.")

        candidate_ids = list(
            (
                await self._session.execute(
                    select(ScheduledActionModel.id)
                    .where(
                        ScheduledActionModel.status.in_(self._PURGEABLE_STATUSES),
                        ScheduledActionModel.terminal_at.is_not(None),
                        ScheduledActionModel.terminal_at <= cutoff,
                    )
                    .order_by(
                        ScheduledActionModel.terminal_at,
                        ScheduledActionModel.id,
                    )
                    .limit(action_limit)
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        if not candidate_ids:
            return 0

        result = await self._session.execute(
            delete(ScheduledActionModel).where(
                ScheduledActionModel.id.in_(candidate_ids),
                ScheduledActionModel.status.in_(self._PURGEABLE_STATUSES),
                ScheduledActionModel.terminal_at.is_not(None),
                ScheduledActionModel.terminal_at <= cutoff,
            )
        )
        return int(result.rowcount or 0)
