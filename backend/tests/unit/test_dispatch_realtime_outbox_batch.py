"""Pruebas de la frontera transaccional del dispatcher sombra."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import pytest

from app.application.dto import RealtimeOutboxEvent
from app.application.exceptions import InvalidRealtimeOutboxBatchError
from app.application.interfaces import (
    RealtimeOutbox,
    RealtimeOutboxBatchValidator,
    UnitOfWork,
)
from app.application.use_cases.dispatch_realtime_outbox_batch import (
    DispatchRealtimeOutboxBatch,
)


def _event(*, attempts: int = 1) -> RealtimeOutboxEvent:
    now = datetime.now(UTC)
    ride_id = uuid.uuid4()
    return RealtimeOutboxEvent(
        id=uuid.uuid4(),
        batch_id=uuid.uuid4(),
        sequence=0,
        event_type="ride_closed",
        topic=f"ride:{ride_id}",
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=1,
        stream_version=1,
        payload={"type": "ride_closed", "data": {"ride_id": str(ride_id)}},
        created_at=now,
        next_attempt_at=now,
        published_at=None,
        attempts=attempts,
        last_error=None,
    )


class RecordingOutbox(RealtimeOutbox):
    def __init__(
        self,
        events: Sequence[RealtimeOutboxEvent] = (),
        *,
        claim_error: BaseException | None = None,
    ) -> None:
        self.events = list(events)
        self.claim_error = claim_error
        self.claimed_at: datetime | None = None
        self.published: list[tuple[uuid.UUID, datetime]] = []
        self.failed: list[tuple[uuid.UUID, str, datetime]] = []

    async def add_batch(self, events):  # pragma: no cover - no interviene en el UC
        del events
        return []

    async def claim_next_batch(self, now: datetime) -> list[RealtimeOutboxEvent]:
        self.claimed_at = now
        if self.claim_error is not None:
            raise self.claim_error
        return list(self.events)

    async def mark_batch_published(
        self,
        batch_id: uuid.UUID,
        published_at: datetime,
    ) -> None:
        self.published.append((batch_id, published_at))

    async def mark_batch_failed(
        self,
        batch_id: uuid.UUID,
        error: str,
        next_attempt_at: datetime,
    ) -> None:
        self.failed.append((batch_id, error, next_attempt_at))


class RecordingUnitOfWork(UnitOfWork):
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


class ConfigurableValidator(RealtimeOutboxBatchValidator):
    def __init__(self, error: BaseException | None = None) -> None:
        self.error = error
        self.validated: list[list[RealtimeOutboxEvent]] = []

    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        self.validated.append(list(events))
        if self.error is not None:
            raise self.error


def _use_case(
    outbox: RecordingOutbox,
    unit_of_work: RecordingUnitOfWork,
    validator: ConfigurableValidator,
    *,
    retry_base_seconds: float = 2,
    retry_max_seconds: float = 30,
) -> DispatchRealtimeOutboxBatch:
    return DispatchRealtimeOutboxBatch(
        outbox,
        unit_of_work,
        validator,
        retry_base_seconds=retry_base_seconds,
        retry_max_seconds=retry_max_seconds,
    )


async def test_empty_batch_rolls_back_the_read_transaction() -> None:
    now = datetime.now(UTC)
    outbox = RecordingOutbox()
    unit_of_work = RecordingUnitOfWork()
    validator = ConfigurableValidator()

    result = await _use_case(outbox, unit_of_work, validator).execute(now)

    assert result.status == "empty"
    assert result.batch_id is None
    assert result.event_count == 0
    assert outbox.claimed_at == now
    assert validator.validated == []
    assert unit_of_work.rollbacks == 1
    assert unit_of_work.commits == 0


async def test_valid_batch_is_marked_published_and_committed() -> None:
    now = datetime.now(UTC)
    event = _event()
    outbox = RecordingOutbox([event])
    unit_of_work = RecordingUnitOfWork()
    validator = ConfigurableValidator()

    result = await _use_case(outbox, unit_of_work, validator).execute(now)

    assert result.status == "published"
    assert result.batch_id == event.batch_id
    assert result.event_count == 1
    assert validator.validated == [[event]]
    assert outbox.published == [(event.batch_id, now)]
    assert outbox.failed == []
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 0


async def test_invalid_batch_is_retried_with_exponential_backoff_and_committed() -> None:
    now = datetime.now(UTC)
    event = _event(attempts=4)
    outbox = RecordingOutbox([event])
    unit_of_work = RecordingUnitOfWork()
    validator = ConfigurableValidator(
        InvalidRealtimeOutboxBatchError("contrato inválido")
    )

    result = await _use_case(outbox, unit_of_work, validator).execute(now)

    assert result.status == "failed"
    assert result.batch_id == event.batch_id
    assert result.event_count == 1
    assert outbox.failed == [
        (event.batch_id, "contrato inválido", now + timedelta(seconds=16))
    ]
    assert outbox.published == []
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 0


async def test_unexpected_error_rolls_back_and_propagates() -> None:
    outbox = RecordingOutbox([_event()])
    unit_of_work = RecordingUnitOfWork()
    validator = ConfigurableValidator(RuntimeError("fallo inesperado"))

    with pytest.raises(RuntimeError, match="fallo inesperado"):
        await _use_case(outbox, unit_of_work, validator).execute(datetime.now(UTC))

    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


async def test_cancellation_rolls_back_and_propagates() -> None:
    outbox = RecordingOutbox([_event()])
    unit_of_work = RecordingUnitOfWork()
    validator = ConfigurableValidator(asyncio.CancelledError())

    with pytest.raises(asyncio.CancelledError):
        await _use_case(outbox, unit_of_work, validator).execute(datetime.now(UTC))

    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


@pytest.mark.parametrize(
    ("retry_base_seconds", "retry_max_seconds"),
    [(0, 1), (-1, 1), (2, 1)],
)
def test_rejects_invalid_backoff_configuration(
    retry_base_seconds: float,
    retry_max_seconds: float,
) -> None:
    with pytest.raises(ValueError):
        _use_case(
            RecordingOutbox(),
            RecordingUnitOfWork(),
            ConfigurableValidator(),
            retry_base_seconds=retry_base_seconds,
            retry_max_seconds=retry_max_seconds,
        )
