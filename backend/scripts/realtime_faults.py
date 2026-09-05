"""Adaptadores one-shot para probar resiliencia realtime fuera de producción.

Este módulo vive bajo ``scripts`` y no forma parte del paquete ``app``. No lee
variables de entorno ni expone controles remotos: el runner de smoke conserva
una referencia directa al controlador y arma cada fallo de forma explícita.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Awaitable, Callable, Collection, Sequence
from dataclasses import dataclass, replace
from typing import Literal, TypeAlias

from app.api.v1.realtime_outbox import serialize_realtime_outbox_batch_v2
from app.application.dto import RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
)

RealtimeFaultAction: TypeAlias = Literal[
    "duplicate",
    "gap",
    "invalid_frame",
    "quarantine",
]
RealtimeBroadcast: TypeAlias = Callable[[str, dict[str, object]], Awaitable[None]]

_PUBLISH_ACTIONS = frozenset({"duplicate", "gap", "invalid_frame"})
_QUARANTINE_ACTIONS = frozenset({"quarantine"})
_QUARANTINE_REASON = "Fallo de cuarentena inyectado por el smoke realtime."


@dataclass(frozen=True, slots=True)
class RealtimeFaultPlan:
    """Plan exacto y observable; ``hit`` cambia una sola vez por armado."""

    action: RealtimeFaultAction
    event_type: str
    topic: str
    hit: bool = False

    def __post_init__(self) -> None:
        if not self.event_type.strip():
            raise ValueError("El event_type del fallo no puede estar vacío.")
        if not self.topic.strip():
            raise ValueError("El topic del fallo no puede estar vacío.")


@dataclass(frozen=True, slots=True)
class RealtimeFaultMatch:
    """Resultado estable de consumir un plan y su primer evento objetivo."""

    plan: RealtimeFaultPlan
    event_id: uuid.UUID


class RealtimeFaultController:
    """Arma y consume exactamente una coincidencia de forma thread-safe."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._plan: RealtimeFaultPlan | None = None

    @property
    def plan(self) -> RealtimeFaultPlan | None:
        """Devuelve un corte inmutable del plan actual."""
        with self._lock:
            return self._plan

    def arm(self, plan: RealtimeFaultPlan) -> None:
        """Arma un plan nuevo sin sobrescribir otro que todavía no hizo hit."""
        if plan.hit:
            raise ValueError("No se puede armar un plan que ya declara hit.")
        with self._lock:
            if self._plan is not None and not self._plan.hit:
                raise RuntimeError("Ya existe un fallo realtime pendiente.")
            self._plan = plan

    def consume(
        self,
        events: Sequence[RealtimeOutboxEvent],
        *,
        allowed_actions: Collection[RealtimeFaultAction],
    ) -> RealtimeFaultMatch | None:
        """Consume el plan si acción, event_type y topic coinciden exactamente."""
        with self._lock:
            plan = self._plan
            if plan is None or plan.hit or plan.action not in allowed_actions:
                return None

            target = next(
                (
                    event
                    for event in events
                    if event.event_type == plan.event_type
                    and event.topic == plan.topic
                ),
                None,
            )
            if target is None:
                return None

            consumed = replace(plan, hit=True)
            self._plan = consumed
            return RealtimeFaultMatch(plan=consumed, event_id=target.id)


class FaultInjectingRealtimeOutboxBatchValidator(RealtimeOutboxBatchValidator):
    """Decora el validador canónico e inyecta una cuarentena one-shot."""

    def __init__(
        self,
        delegate: RealtimeOutboxBatchValidator,
        controller: RealtimeFaultController,
    ) -> None:
        self._delegate = delegate
        self._controller = controller

    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        # Un lote genuinamente inválido conserva siempre su error canónico y no
        # consume el plan de smoke.
        self._delegate.validate(events)
        match = self._controller.consume(
            events,
            allowed_actions=_QUARANTINE_ACTIONS,
        )
        if match is not None:
            raise InvalidRealtimeOutboxBatchError(
                "invalid_payload",
                _QUARANTINE_REASON,
            )


class FaultInjectingRealtimeOutboxBatchPublisher(RealtimeOutboxBatchPublisher):
    """Inyecta un fallo de entrega y delega cualquier publicación normal."""

    def __init__(
        self,
        delegate: RealtimeOutboxBatchPublisher,
        controller: RealtimeFaultController,
        broadcast: RealtimeBroadcast,
    ) -> None:
        self._delegate = delegate
        self._controller = controller
        self._broadcast = broadcast

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        match = self._controller.consume(
            events,
            allowed_actions=_PUBLISH_ACTIONS,
        )
        if match is None:
            await self._delegate.publish(events)
            return

        if match.plan.action == "duplicate":
            await self._delegate.publish(events)
            await self._delegate.publish(events)
            return

        if match.plan.action == "invalid_frame":
            await self._broadcast(
                match.plan.topic,
                {
                    "type": match.plan.event_type,
                    "data": {},
                },
            )
            await self._delegate.publish(events)
            return

        # Serializar el lote completo antes del primer broadcast conserva la
        # garantía productiva de no entregar parcialmente un contrato inválido.
        envelopes = serialize_realtime_outbox_batch_v2(events)
        skipped = False
        for event, envelope in zip(events, envelopes, strict=True):
            if not skipped and event.id == match.event_id:
                skipped = True
                continue
            await self._broadcast(event.topic, envelope)

    async def force_resync(self, streams: Sequence[str]) -> None:
        await self._delegate.force_resync(streams)
