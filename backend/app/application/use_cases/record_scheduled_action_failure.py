"""Caso de uso: reprogramar o agotar una acción reclamada."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.application.dto import DispatchScheduledActionResult, ScheduledAction
from app.application.interfaces import ScheduledActionQueue, UnitOfWork


class RecordScheduledActionFailure:
    def __init__(
        self,
        actions: ScheduledActionQueue,
        unit_of_work: UnitOfWork,
        *,
        max_attempts: int,
        retry_base_seconds: float,
        retry_max_seconds: float,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("La cantidad máxima de intentos debe ser positiva.")
        if retry_base_seconds <= 0:
            raise ValueError("El backoff base debe ser positivo.")
        if retry_max_seconds < retry_base_seconds:
            raise ValueError("El backoff máximo no puede ser menor al base.")
        self._actions = actions
        self._unit_of_work = unit_of_work
        self._max_attempts = max_attempts
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds

    async def execute(
        self,
        action: ScheduledAction,
        error_code: str,
        now: datetime,
        *,
        force_terminal: bool = False,
    ) -> DispatchScheduledActionResult:
        if action.lock_token is None:
            raise ValueError("La acción no tiene un lease reclamado.")
        terminal = force_terminal or action.attempts >= self._max_attempts
        delay = min(
            self._retry_max_seconds,
            self._retry_base_seconds * (2 ** max(0, action.attempts - 1)),
        )
        try:
            updated = await self._actions.mark_failed(
                action.id,
                action.generation,
                action.lock_token,
                error_code=error_code[:64],
                next_attempt_at=now + timedelta(seconds=delay),
                terminal=terminal,
                terminal_at=now,
            )
            if not updated:
                await self._unit_of_work.rollback()
                return DispatchScheduledActionResult(
                    status="lost_lease",
                    action_id=action.id,
                    action_type=action.action_type,
                    attempts=action.attempts,
                    lease_recovered=action.lease_recovered,
                )
            await self._unit_of_work.commit()
            return DispatchScheduledActionResult(
                status="dead" if terminal else "retried",
                action_id=action.id,
                action_type=action.action_type,
                attempts=action.attempts,
                lease_recovered=action.lease_recovered,
            )
        except BaseException:
            await self._unit_of_work.rollback()
            raise
