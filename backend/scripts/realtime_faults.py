"""One-shot adapters to test realtime resilience outside production.

This module lives under ``scripts`` and is not part of the ``app`` package. It reads no
environment variables and exposes no remote controls: the smoke runner keeps
a direct reference to the controller and arms each fault explicitly.
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
_QUARANTINE_REASON = "Quarantine fault injected by the realtime smoke."


@dataclass(frozen=True, slots=True)
class RealtimeFaultPlan:
    """Exact, observable plan; ``hit`` changes only once per arming."""

    action: RealtimeFaultAction
    event_type: str
    topic: str
    hit: bool = False

    def __post_init__(self) -> None:
        if not self.event_type.strip():
            raise ValueError("The fault's event_type cannot be empty.")
        if not self.topic.strip():
            raise ValueError("The fault's topic cannot be empty.")


@dataclass(frozen=True, slots=True)
class RealtimeFaultMatch:
    """Stable result of consuming a plan and its first target event."""

    plan: RealtimeFaultPlan
    event_id: uuid.UUID


class RealtimeFaultController:
    """Arm and consume exactly one match in a thread-safe way."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._plan: RealtimeFaultPlan | None = None

    @property
    def plan(self) -> RealtimeFaultPlan | None:
        """Devuelve un corte inmutable del plan actual."""
        with self._lock:
            return self._plan

    def arm(self, plan: RealtimeFaultPlan) -> None:
        """Arm a new plan without overwriting another that has not hit yet."""
        if plan.hit:
            raise ValueError("Cannot arm a plan that already declares a hit.")
        with self._lock:
            if self._plan is not None and not self._plan.hit:
                raise RuntimeError("A realtime fault is already pending.")
            self._plan = plan

    def consume(
        self,
        events: Sequence[RealtimeOutboxEvent],
        *,
        allowed_actions: Collection[RealtimeFaultAction],
    ) -> RealtimeFaultMatch | None:
        """Consume the plan if action, event_type and topic match exactly."""
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
    """Wrap the canonical validator and inject a one-shot quarantine."""

    def __init__(
        self,
        delegate: RealtimeOutboxBatchValidator,
        controller: RealtimeFaultController,
    ) -> None:
        self._delegate = delegate
        self._controller = controller

    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        # A genuinely invalid batch always keeps its canonical error and does not
        # consume the smoke plan.
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
    """Inject a delivery failure and delegate any normal publication."""

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

        # Serializing the whole batch before the first broadcast keeps the
        # production guarantee of never partially delivering an invalid contract.
        envelopes = serialize_realtime_outbox_batch_v2(events)
        skipped = False
        for event, envelope in zip(events, envelopes, strict=True):
            if not skipped and event.id == match.event_id:
                skipped = True
                continue
            await self._broadcast(event.topic, envelope)

    async def force_resync(self, streams: Sequence[str]) -> None:
        await self._delegate.force_resync(streams)
