"""Tests of the shadow dispatcher's transactional boundary."""

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
    RealtimeOutboxBatchPublisher,
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
        correlation_id=uuid.uuid4(),
        sequence=0,
        batch_size=1,
        event_type="ride_closed",
        topic=f"ride:{ride_id}",
        aggregate_type="ride",
        aggregate_id=ride_id,
        aggregate_version=1,
        stream_version=1,
        payload={
            "type": "ride_closed",
            "data": {
                "ride_id": str(ride_id),
                "pool_version": 1,
                "reason": "terminal",
            },
        },
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
        self.quarantined: list[tuple[uuid.UUID, str, datetime]] = []
        self.quarantine_count: int | None = None

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

    async def mark_batch_quarantined(
        self,
        batch_id: uuid.UUID,
        code: str,
        quarantined_at: datetime,
    ) -> int:
        self.quarantined.append((batch_id, code, quarantined_at))
        if self.quarantine_count is not None:
            return self.quarantine_count
        return len(self.events)


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


class RecordingPublisher(RealtimeOutboxBatchPublisher):
    def __init__(
        self,
        error: BaseException | None = None,
        operations: list[str] | None = None,
    ) -> None:
        self.error = error
        self.operations = operations
        self.published: list[list[RealtimeOutboxEvent]] = []
        self.resynced: list[tuple[str, ...]] = []

    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        if self.operations is not None:
            self.operations.append("publish")
        if self.error is not None:
            raise self.error
        self.published.append(list(events))

    async def force_resync(self, streams: Sequence[str]) -> None:
        if self.operations is not None:
            self.operations.append("resync")
        self.resynced.append(tuple(streams))


def _use_case(
    outbox: RecordingOutbox,
    unit_of_work: RecordingUnitOfWork,
    validator: ConfigurableValidator,
) -> DispatchRealtimeOutboxBatch:
    return DispatchRealtimeOutboxBatch(outbox, unit_of_work, validator)


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
    assert outbox.quarantined == []
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 0


async def test_live_uses_completion_clock_after_publishing() -> None:
    started_at = datetime.now(UTC)
    completed_at = started_at + timedelta(seconds=3)
    event = _event()
    outbox = RecordingOutbox([event])
    unit_of_work = RecordingUnitOfWork()
    publisher = RecordingPublisher()
    use_case = DispatchRealtimeOutboxBatch(
        outbox,
        unit_of_work,
        ConfigurableValidator(),
        publisher,
        completion_clock=lambda: completed_at,
    )

    result = await use_case.execute(started_at)

    assert result.status == "published"
    assert outbox.claimed_at == started_at
    assert outbox.published == [(event.batch_id, completed_at)]


async def test_live_publishes_before_marking_and_committing() -> None:
    operations: list[str] = []
    event = _event()

    class OrderedOutbox(RecordingOutbox):
        async def mark_batch_published(self, batch_id, published_at):
            operations.append("mark")
            await super().mark_batch_published(batch_id, published_at)

    class OrderedUnitOfWork(RecordingUnitOfWork):
        async def commit(self):
            operations.append("commit")
            await super().commit()

    outbox = OrderedOutbox([event])
    unit_of_work = OrderedUnitOfWork()
    publisher = RecordingPublisher(operations=operations)
    use_case = DispatchRealtimeOutboxBatch(
        outbox,
        unit_of_work,
        ConfigurableValidator(),
        publisher,
    )

    result = await use_case.execute(datetime.now(UTC))

    assert result.status == "published"
    assert operations == ["publish", "mark", "commit"]
    assert publisher.published == [[event]]


async def test_live_persists_sanitized_failure_with_exponential_backoff() -> None:
    now = datetime.now(UTC)
    event = _event(attempts=3)
    outbox = RecordingOutbox([event])
    unit_of_work = RecordingUnitOfWork()
    publisher = RecordingPublisher(RuntimeError("payload privado"))
    use_case = DispatchRealtimeOutboxBatch(
        outbox,
        unit_of_work,
        ConfigurableValidator(),
        publisher,
        retry_base_seconds=2,
        retry_max_seconds=10,
    )

    result = await use_case.execute(now)

    assert result.status == "failed"
    assert outbox.failed == [(event.batch_id, "RuntimeError", now + timedelta(seconds=8))]
    assert outbox.published == []
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 0


async def test_live_quarantines_before_forcing_resync_after_commit() -> None:
    operations: list[str] = []
    event = _event()

    class OrderedOutbox(RecordingOutbox):
        async def mark_batch_quarantined(self, batch_id, code, quarantined_at):
            operations.append("quarantine")
            return await super().mark_batch_quarantined(
                batch_id,
                code,
                quarantined_at,
            )

    class OrderedUnitOfWork(RecordingUnitOfWork):
        async def commit(self):
            operations.append("commit")
            await super().commit()

    publisher = RecordingPublisher(
        InvalidRealtimeOutboxBatchError("invalid_payload", "contrato v2"),
        operations,
    )
    use_case = DispatchRealtimeOutboxBatch(
        OrderedOutbox([event]),
        OrderedUnitOfWork(),
        ConfigurableValidator(),
        publisher,
    )

    result = await use_case.execute(datetime.now(UTC))

    assert result.status == "quarantined"
    assert result.affected_streams == (event.topic,)
    assert operations == ["publish", "quarantine", "commit", "resync"]
    assert publisher.resynced == [(event.topic,)]


async def test_transport_limit_is_quarantined_instead_of_retried() -> None:
    now = datetime.now(UTC)
    event = _event(attempts=3)
    outbox = RecordingOutbox([event])
    unit_of_work = RecordingUnitOfWork()
    publisher = RecordingPublisher(
        InvalidRealtimeOutboxBatchError(
            "transport_limit",
            "batch demasiado grande",
        )
    )
    use_case = DispatchRealtimeOutboxBatch(
        outbox,
        unit_of_work,
        ConfigurableValidator(),
        publisher,
    )

    result = await use_case.execute(now)

    assert result.status == "quarantined"
    assert result.quarantine_code == "transport_limit"
    assert outbox.quarantined == [(event.batch_id, "transport_limit", now)]
    assert outbox.failed == []
    assert unit_of_work.commits == 1


async def test_cancel_after_quarantine_commit_waits_for_forced_resync() -> None:
    entered = asyncio.Event()
    release = asyncio.Event()
    completed = False
    event = _event()

    class SlowResyncPublisher(RecordingPublisher):
        async def force_resync(self, streams: Sequence[str]) -> None:
            nonlocal completed
            entered.set()
            await release.wait()
            completed = True

    outbox = RecordingOutbox([event])
    unit_of_work = RecordingUnitOfWork()
    publisher = SlowResyncPublisher(
        InvalidRealtimeOutboxBatchError("invalid_payload", "contrato v2")
    )
    use_case = DispatchRealtimeOutboxBatch(
        outbox,
        unit_of_work,
        ConfigurableValidator(),
        publisher,
    )

    task = asyncio.create_task(use_case.execute(datetime.now(UTC)))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)

    assert task.done() is False
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert completed is True
    assert unit_of_work.commits == 1


async def test_invalid_batch_is_quarantined_without_retry_and_committed() -> None:
    now = datetime.now(UTC)
    event = _event(attempts=4)
    outbox = RecordingOutbox([event])
    unit_of_work = RecordingUnitOfWork()
    validator = ConfigurableValidator(
        InvalidRealtimeOutboxBatchError("invalid_payload", "contrato inválido")
    )

    result = await _use_case(outbox, unit_of_work, validator).execute(now)

    assert result.status == "quarantined"
    assert result.batch_id == event.batch_id
    assert result.event_count == 1
    assert result.quarantine_code == "invalid_payload"
    assert outbox.quarantined == [
        (event.batch_id, "invalid_payload", now),
    ]
    assert outbox.failed == []
    assert outbox.published == []
    assert unit_of_work.commits == 1
    assert unit_of_work.rollbacks == 0


async def test_partial_quarantine_rolls_back_and_propagates() -> None:
    event = _event()
    outbox = RecordingOutbox([event])
    outbox.quarantine_count = 0
    unit_of_work = RecordingUnitOfWork()
    validator = ConfigurableValidator(
        InvalidRealtimeOutboxBatchError("invalid_payload", "contrato inválido")
    )

    with pytest.raises(RuntimeError, match="no alcanzó"):
        await _use_case(outbox, unit_of_work, validator).execute(datetime.now(UTC))

    assert unit_of_work.commits == 0
    assert unit_of_work.rollbacks == 1


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
