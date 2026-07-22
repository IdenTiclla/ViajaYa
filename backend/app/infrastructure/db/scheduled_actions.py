"""Persistencia PostgreSQL/SQLite de acciones diferidas durables."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto import PendingScheduledAction, ScheduledAction
from app.application.interfaces import ScheduledActionQueue
from app.infrastructure.db.models import ScheduledActionModel


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _to_action(
    row: ScheduledActionModel,
    *,
    lease_recovered: bool = False,
) -> ScheduledAction:
    execute_at = _aware(row.execute_at)
    next_attempt_at = _aware(row.next_attempt_at)
    created_at = _aware(row.created_at)
    updated_at = _aware(row.updated_at)
    assert execute_at is not None
    assert next_attempt_at is not None
    assert created_at is not None
    assert updated_at is not None
    return ScheduledAction(
        id=row.id,
        dedupe_key=row.dedupe_key,
        action_type=row.action_type,
        aggregate_id=row.aggregate_id,
        generation=row.generation,
        execute_at=execute_at,
        payload=dict(row.payload),
        status=row.status,  # type: ignore[arg-type]
        attempts=row.attempts,
        next_attempt_at=next_attempt_at,
        locked_at=_aware(row.locked_at),
        lock_token=row.lock_token,
        last_error=row.last_error,
        terminal_at=_aware(row.terminal_at),
        created_at=created_at,
        updated_at=updated_at,
        lease_recovered=lease_recovered,
    )


class SqlAlchemyScheduledActionRepository(ScheduledActionQueue):
    """Agenda, reclama y finaliza acciones sin confirmar la sesión recibida."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def schedule(self, action: PendingScheduledAction) -> ScheduledAction:
        if action.generation < 1:
            raise ValueError("La generación debe ser positiva.")
        if not 1 <= len(action.dedupe_key.strip()) <= 255:
            raise ValueError("La clave de deduplicación no es válida.")
        if not 1 <= len(action.action_type.strip()) <= 64:
            raise ValueError("El tipo de acción no es válido.")

        values = {
            "id": uuid.uuid4(),
            "dedupe_key": action.dedupe_key,
            "action_type": action.action_type,
            "aggregate_id": action.aggregate_id,
            "generation": action.generation,
            "execute_at": action.execute_at,
            "payload": dict(action.payload),
            "status": "pending",
            "attempts": 0,
            "next_attempt_at": action.execute_at,
            "locked_at": None,
            "lock_token": None,
            "last_error": None,
            "terminal_at": None,
        }
        dialect_name = self._session.get_bind().dialect.name
        if dialect_name == "postgresql":
            statement = postgresql_insert(ScheduledActionModel).values(**values)
        elif dialect_name == "sqlite":
            statement = sqlite_insert(ScheduledActionModel).values(**values)
        else:  # pragma: no cover - solo soportamos los motores del proyecto
            raise RuntimeError(f"Dialect de scheduler no soportado: {dialect_name}")

        excluded = statement.excluded
        statement = statement.on_conflict_do_update(
            index_elements=[ScheduledActionModel.dedupe_key],
            set_={
                "action_type": excluded.action_type,
                "aggregate_id": excluded.aggregate_id,
                "generation": excluded.generation,
                "execute_at": excluded.execute_at,
                "payload": excluded.payload,
                "status": "pending",
                "attempts": 0,
                "next_attempt_at": excluded.next_attempt_at,
                "locked_at": None,
                "lock_token": None,
                "last_error": None,
                "terminal_at": None,
                "updated_at": datetime.now(UTC),
            },
            where=excluded.generation > ScheduledActionModel.generation,
        ).returning(ScheduledActionModel.id)
        action_id = (await self._session.execute(statement)).scalar_one_or_none()
        if action_id is None:
            action_id = (
                await self._session.execute(
                    select(ScheduledActionModel.id).where(
                        ScheduledActionModel.dedupe_key == action.dedupe_key
                    )
                )
            ).scalar_one()
        row = await self._session.get(ScheduledActionModel, action_id)
        assert row is not None
        await self._session.refresh(row)
        return _to_action(row)

    async def claim_due(
        self,
        now: datetime,
        stale_before: datetime,
    ) -> ScheduledAction | None:
        row = (
            await self._session.execute(
                select(ScheduledActionModel)
                .where(
                    or_(
                        and_(
                            ScheduledActionModel.status == "pending",
                            ScheduledActionModel.execute_at <= now,
                            ScheduledActionModel.next_attempt_at <= now,
                        ),
                        and_(
                            ScheduledActionModel.status == "running",
                            ScheduledActionModel.locked_at <= stale_before,
                        ),
                    )
                )
                .order_by(
                    ScheduledActionModel.next_attempt_at,
                    ScheduledActionModel.execute_at,
                    ScheduledActionModel.id,
                )
                .limit(1)
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            return None

        lease_recovered = row.status == "running"
        row.status = "running"
        row.attempts += 1
        row.locked_at = now
        row.lock_token = uuid.uuid4()
        row.last_error = None
        row.terminal_at = None
        await self._session.flush()
        await self._session.refresh(row)
        return _to_action(row, lease_recovered=lease_recovered)

    async def mark_succeeded(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
        terminal_at: datetime,
    ) -> bool:
        written_at = (
            func.clock_timestamp()
            if self._session.get_bind().dialect.name == "postgresql"
            else terminal_at
        )
        result = await self._session.execute(
            update(ScheduledActionModel)
            .where(
                ScheduledActionModel.id == action_id,
                ScheduledActionModel.generation == generation,
                ScheduledActionModel.status == "running",
                ScheduledActionModel.lock_token == lock_token,
            )
            .values(
                status="succeeded",
                locked_at=None,
                lock_token=None,
                last_error=None,
                terminal_at=written_at,
                updated_at=written_at,
            )
        )
        return bool(result.rowcount)

    async def mark_failed(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
        *,
        error_code: str,
        next_attempt_at: datetime,
        terminal: bool,
        terminal_at: datetime,
    ) -> bool:
        if not 1 <= len(error_code.strip()) <= 64:
            raise ValueError("El código de error no es válido.")
        written_at = (
            func.clock_timestamp()
            if self._session.get_bind().dialect.name == "postgresql"
            else terminal_at
        )
        values: dict[str, object | None] = {
            "status": "dead" if terminal else "pending",
            "locked_at": None,
            "lock_token": None,
            "last_error": error_code,
            "next_attempt_at": next_attempt_at,
            "terminal_at": written_at if terminal else None,
            "updated_at": written_at,
        }
        result = await self._session.execute(
            update(ScheduledActionModel)
            .where(
                ScheduledActionModel.id == action_id,
                ScheduledActionModel.generation == generation,
                ScheduledActionModel.status == "running",
                ScheduledActionModel.lock_token == lock_token,
            )
            .values(**values)
        )
        return bool(result.rowcount)

    async def mark_succeeded_if_pending(
        self,
        dedupe_key: str,
        generation: int,
        terminal_at: datetime,
    ) -> bool:
        written_at = (
            func.clock_timestamp()
            if self._session.get_bind().dialect.name == "postgresql"
            else terminal_at
        )
        result = await self._session.execute(
            update(ScheduledActionModel)
            .where(
                ScheduledActionModel.dedupe_key == dedupe_key,
                ScheduledActionModel.generation == generation,
                ScheduledActionModel.status == "pending",
            )
            .values(
                status="succeeded",
                locked_at=None,
                lock_token=None,
                last_error=None,
                terminal_at=written_at,
                updated_at=written_at,
            )
        )
        return bool(result.rowcount)
