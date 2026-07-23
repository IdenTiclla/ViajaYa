"""Pruebas de los adaptadores one-shot usados por el smoke realtime."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.application.dto import RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    RealtimeOutboxBatchPublisher,
    RealtimeOutboxBatchValidator,
)
from scripts.realtime_faults import (
    FaultInjectingRealtimeOutboxBatchPublisher,
    FaultInjectingRealtimeOutboxBatchValidator,
    RealtimeFaultController,
    RealtimeFaultPlan,
)


def _event(
    *,
    batch_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    sequence: int = 0,
    batch_size: int = 1,
    aggregate_id: uuid.UUID | None = None,
    aggregate_version: int = 1,
    stream_version: int = 1,
    topic: str = "pool:taxi",
) -> RealtimeOutboxEvent:
    now = datetime.now(UTC)
    resolved_aggregate_id = aggregate_id or uuid.uuid4()
    return RealtimeOutboxEvent(
        id=event_id or uuid.uuid4(),
        batch_id=batch_id or uuid.uuid4(),
        correlation_id=uuid.uuid4(),
        sequence=sequence,
        batch_size=batch_size,
        event_type="ride_closed",
        topic=topic,
        aggregate_type="ride",
        aggregate_id=resolved_aggregate_id,
        aggregate_version=aggregate_version,
        stream_version=stream_version,
        payload={
            "type": "ride_closed",
            "data": {
                "ride_id": str(resolved_aggregate_id),
                "pool_version": 1,
                "reason": "terminal",
            },
        },
        created_at=now,
        next_attempt_at=now,
        published_at=None,
        attempts=1,
        last_error=None,
    )


class RecordingValidator(RealtimeOutboxBatchValidator):
    def __init__(self, error: BaseException | None = None) -> None:
        self.error = error
        self.calls: list[list[RealtimeOutboxEvent]] = []

    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        self.calls.append(list(events))
        if self.error is not None:
            raise self.error


class RecordingPublisher(RealtimeOutboxBatchPublisher):
    def __init__(self) -> None:
        self.published: list[list[RealtimeOutboxEvent]] = []
        self.resynced: list[tuple[str, ...]] = []

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        self.published.append(list(events))

    async def force_resync(self, streams: Sequence[str]) -> None:
        self.resynced.append(tuple(streams))


def test_controller_exige_match_exacto_y_consume_una_sola_vez() -> None:
    controller = RealtimeFaultController()
    event = _event()
    controller.arm(
        RealtimeFaultPlan(
            action="duplicate",
            event_type=event.event_type,
            topic=event.topic,
        )
    )

    assert controller.consume(
        [replace(event, topic="pool:moto")],
        allowed_actions={"duplicate"},
    ) is None
    assert controller.consume([event], allowed_actions={"gap"}) is None
    assert controller.plan is not None
    assert controller.plan.hit is False

    match = controller.consume([event], allowed_actions={"duplicate"})

    assert match is not None
    assert match.event_id == event.id
    assert match.plan.hit is True
    assert controller.consume([event], allowed_actions={"duplicate"}) is None


def test_controller_no_permite_sobrescribir_un_plan_pendiente() -> None:
    controller = RealtimeFaultController()
    plan = RealtimeFaultPlan(
        action="gap",
        event_type="ride_closed",
        topic="pool:taxi",
    )
    controller.arm(plan)

    with pytest.raises(RuntimeError, match="pendiente"):
        controller.arm(plan)

    with pytest.raises(ValueError, match="declara hit"):
        RealtimeFaultController().arm(replace(plan, hit=True))


def test_controller_es_thread_safe_y_solo_un_hilo_hace_hit() -> None:
    controller = RealtimeFaultController()
    event = _event()
    controller.arm(
        RealtimeFaultPlan(
            action="duplicate",
            event_type=event.event_type,
            topic=event.topic,
        )
    )
    barrier = threading.Barrier(8)

    def consume() -> bool:
        barrier.wait()
        return (
            controller.consume([event], allowed_actions={"duplicate"})
            is not None
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        hits = list(executor.map(lambda _: consume(), range(8)))

    assert sum(hits) == 1


def test_validator_delega_antes_de_inyectar_cuarentena_sanitizada() -> None:
    controller = RealtimeFaultController()
    delegate = RecordingValidator()
    event = _event()
    private_value = "PAYLOAD_PRIVADO"
    event = replace(event, payload={**event.payload, "privado": private_value})
    controller.arm(
        RealtimeFaultPlan(
            action="quarantine",
            event_type=event.event_type,
            topic=event.topic,
        )
    )
    validator = FaultInjectingRealtimeOutboxBatchValidator(delegate, controller)

    with pytest.raises(InvalidRealtimeOutboxBatchError) as captured:
        validator.validate([event])

    assert delegate.calls == [[event]]
    assert captured.value.code == "invalid_payload"
    assert private_value not in str(captured.value)
    assert controller.plan is not None and controller.plan.hit is True


def test_validator_no_consume_plan_si_delegado_rechaza_el_lote() -> None:
    event = _event()
    controller = RealtimeFaultController()
    controller.arm(
        RealtimeFaultPlan(
            action="quarantine",
            event_type=event.event_type,
            topic=event.topic,
        )
    )
    delegate = RecordingValidator(ValueError("contrato canónico inválido"))
    validator = FaultInjectingRealtimeOutboxBatchValidator(delegate, controller)

    with pytest.raises(ValueError, match="canónico inválido"):
        validator.validate([event])

    assert controller.plan is not None and controller.plan.hit is False


async def test_publisher_duplica_el_batch_exacto_una_sola_vez() -> None:
    event = _event()
    controller = RealtimeFaultController()
    controller.arm(
        RealtimeFaultPlan(
            action="duplicate",
            event_type=event.event_type,
            topic=event.topic,
        )
    )
    delegate = RecordingPublisher()
    broadcasts: list[tuple[str, dict[str, object]]] = []

    async def broadcast(topic: str, envelope: dict[str, object]) -> None:
        broadcasts.append((topic, envelope))

    publisher = FaultInjectingRealtimeOutboxBatchPublisher(
        delegate,
        controller,
        broadcast,
    )

    await publisher.publish([event])
    await publisher.publish([event])

    assert delegate.published == [[event], [event], [event]]
    assert broadcasts == []


async def test_publisher_gap_serializa_todo_y_omite_solo_el_primer_objetivo() -> None:
    batch_id = uuid.uuid4()
    aggregate_id = uuid.uuid4()
    first = _event(
        batch_id=batch_id,
        sequence=0,
        batch_size=2,
        aggregate_id=aggregate_id,
        aggregate_version=1,
        stream_version=8,
    )
    second = _event(
        batch_id=batch_id,
        sequence=1,
        batch_size=2,
        aggregate_id=aggregate_id,
        aggregate_version=2,
        stream_version=9,
    )
    controller = RealtimeFaultController()
    controller.arm(
        RealtimeFaultPlan(
            action="gap",
            event_type=first.event_type,
            topic=first.topic,
        )
    )
    delegate = RecordingPublisher()
    broadcasts: list[tuple[str, dict[str, object]]] = []

    async def broadcast(topic: str, envelope: dict[str, object]) -> None:
        broadcasts.append((topic, envelope))

    publisher = FaultInjectingRealtimeOutboxBatchPublisher(
        delegate,
        controller,
        broadcast,
    )

    await publisher.publish([first, second])

    assert delegate.published == []
    assert len(broadcasts) == 1
    assert broadcasts[0][0] == second.topic
    assert broadcasts[0][1]["event_id"] == str(second.id)
    assert broadcasts[0][1]["stream_version"] == 9


async def test_publisher_delega_sin_match_y_delega_force_resync() -> None:
    event = _event()
    controller = RealtimeFaultController()
    controller.arm(
        RealtimeFaultPlan(
            action="gap",
            event_type=event.event_type,
            topic="pool:moto",
        )
    )
    delegate = RecordingPublisher()

    async def broadcast(topic: str, envelope: dict[str, object]) -> None:
        del topic, envelope

    publisher = FaultInjectingRealtimeOutboxBatchPublisher(
        delegate,
        controller,
        broadcast,
    )

    await publisher.publish([event])
    await publisher.force_resync([event.topic])

    assert delegate.published == [[event]]
    assert delegate.resynced == [(event.topic,)]
    assert controller.plan is not None and controller.plan.hit is False
