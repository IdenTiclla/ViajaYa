"""Proyección SQLAlchemy sanitizada para observar scheduled_actions."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto import (
    ScheduledActionDeadCount,
    ScheduledActionsOperationalState,
)
from app.application.interfaces import ScheduledActionsOperationalReader
from app.infrastructure.db.models import ScheduledActionModel


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class SqlAlchemyScheduledActionsOperationalReader(
    ScheduledActionsOperationalReader
):
    """Agrega estados sin cargar dedupe keys, agregados ni payloads."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def read(
        self,
        now: datetime,
        stale_before: datetime,
    ) -> ScheduledActionsOperationalState:
        due = and_(
            ScheduledActionModel.status == "pending",
            ScheduledActionModel.execute_at <= now,
            ScheduledActionModel.next_attempt_at <= now,
        )
        stale = and_(
            ScheduledActionModel.status == "running",
            ScheduledActionModel.locked_at <= stale_before,
        )
        row = (
            await self._session.execute(
                select(
                    func.coalesce(
                        func.sum(
                            case((ScheduledActionModel.status == "pending", 1), else_=0)
                        ),
                        0,
                    ),
                    func.coalesce(func.sum(case((due, 1), else_=0)), 0),
                    func.coalesce(
                        func.sum(
                            case((ScheduledActionModel.status == "running", 1), else_=0)
                        ),
                        0,
                    ),
                    func.coalesce(func.sum(case((stale, 1), else_=0)), 0),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    and_(
                                        ScheduledActionModel.status == "pending",
                                        ScheduledActionModel.attempts > 0,
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.min(ScheduledActionModel.execute_at).filter(due),
                    func.min(ScheduledActionModel.next_attempt_at).filter(
                        ScheduledActionModel.status == "pending"
                    ),
                    func.max(ScheduledActionModel.terminal_at).filter(
                        ScheduledActionModel.status == "succeeded"
                    ),
                )
            )
        ).one()
        dead_rows = (
            await self._session.execute(
                select(
                    ScheduledActionModel.action_type,
                    func.count(ScheduledActionModel.id),
                )
                .where(ScheduledActionModel.status == "dead")
                .group_by(ScheduledActionModel.action_type)
                .order_by(ScheduledActionModel.action_type)
            )
        ).all()
        return ScheduledActionsOperationalState(
            pending_count=int(row[0]),
            due_count=int(row[1]),
            running_count=int(row[2]),
            stale_count=int(row[3]),
            retrying_count=int(row[4]),
            dead_counts=tuple(
                ScheduledActionDeadCount(
                    action_type=str(action_type),
                    action_count=int(count),
                )
                for action_type, count in dead_rows
            ),
            oldest_due_at=_as_utc(row[5]),
            next_due_at=_as_utc(row[6]),
            latest_succeeded_at=_as_utc(row[7]),
        )
