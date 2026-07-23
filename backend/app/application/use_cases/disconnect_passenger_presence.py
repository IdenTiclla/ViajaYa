"""Caso de uso: cerrar un lease WebSocket sin borrar otras presencias."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from app.application.dto import RenewableScheduledAction, ScheduledAction
from app.application.interfaces import (
    PassengerPresenceLeaseStore,
    ScheduledActionScheduler,
    UnitOfWork,
)


class DisconnectPassengerPresence:
    def __init__(
        self,
        leases: PassengerPresenceLeaseStore,
        actions: ScheduledActionScheduler,
        unit_of_work: UnitOfWork,
    ) -> None:
        self._leases = leases
        self._actions = actions
        self._unit_of_work = unit_of_work

    async def execute(
        self,
        ride_id: uuid.UUID,
        connection_id: uuid.UUID,
        observed_at: datetime,
    ) -> ScheduledAction:
        try:
            delay = await self._leases.disconnect_websocket(ride_id, connection_id)
            action = await self._actions.schedule_next(
                RenewableScheduledAction(
                    dedupe_key=f"cancel_absent_ride:{ride_id}",
                    action_type="cancel_absent_ride",
                    aggregate_id=ride_id,
                    execute_at=observed_at + timedelta(seconds=max(delay, 0.001)),
                    payload={"ride_id": str(ride_id)},
                )
            )
            await self._unit_of_work.commit()
            return action
        except BaseException:
            await self._unit_of_work.rollback()
            raise
