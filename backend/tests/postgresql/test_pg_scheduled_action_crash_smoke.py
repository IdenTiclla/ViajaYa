"""SIGKILL real después del claim y recuperación durable de la expiración."""

from __future__ import annotations

import asyncio
import multiprocessing
import os
import signal
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.domain.entities import OfferStatus
from app.infrastructure.db.models import (
    OfferModel,
    RealtimeOutboxModel,
    ScheduledActionModel,
)
from tests.postgresql import test_pg_scheduled_offer_expiry as scheduler_support
from tests.postgresql.scheduled_action_crash_support import run_claim_process

_TIMEOUT_SECONDS = 20


async def _wait_event(event, label: str) -> None:
    reached = await asyncio.to_thread(event.wait, _TIMEOUT_SECONDS)
    assert reached, f"No se alcanzó la compuerta {label}."


async def _stop_process(process, release) -> None:
    if process is None:
        return
    if process.is_alive():
        release.set()
        await asyncio.to_thread(process.join, 5)
    if process.is_alive():
        process.kill()
        await asyncio.to_thread(process.join, 5)
    process.close()


async def test_sigkill_despues_del_claim_recupera_la_expiracion(pg_test_db) -> None:
    if os.name != "posix":
        pytest.skip("El smoke de SIGKILL requiere POSIX.")
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    settings = scheduler_support._settings()
    _, _, ride, offer = await scheduler_support._create_scheduled_offer(
        sessions,
        settings,
    )
    claim_at = datetime.now(UTC)
    await scheduler_support._make_due(sessions, offer.id, claim_at)
    context = multiprocessing.get_context("spawn")
    reached = context.Event()
    release = context.Event()
    process = context.Process(
        target=run_claim_process,
        args=(pg_test_db.url, claim_at.isoformat(), reached, release),
        name="scheduled-action-claim-crash-smoke",
    )
    try:
        process.start()
        await _wait_event(reached, "claim confirmado")
        process.kill()
        await asyncio.to_thread(process.join, _TIMEOUT_SECONDS)
        assert process.exitcode == -signal.SIGKILL

        async with sessions() as session:
            claimed = await session.scalar(
                select(ScheduledActionModel).where(
                    ScheduledActionModel.aggregate_id == offer.id
                )
            )
            assert claimed is not None and claimed.status == "running"
            assert claimed.attempts == 1
            assert claimed.lock_token is not None

        restart_at = claim_at + timedelta(seconds=31)
        result = await scheduler_support._worker(
            sessions,
            settings,
            restart_at,
        ).dispatch_once()

        async with sessions() as session:
            action = await session.scalar(
                select(ScheduledActionModel).where(
                    ScheduledActionModel.aggregate_id == offer.id
                )
            )
            offer_status = await session.scalar(
                select(OfferModel.status).where(OfferModel.id == offer.id)
            )
            outbox_count = await session.scalar(
                select(func.count(RealtimeOutboxModel.id)).where(
                    RealtimeOutboxModel.aggregate_id == ride.id
                )
            )
        assert result.status == "succeeded"
        assert result.lease_recovered is True
        assert action is not None and action.status == "succeeded"
        assert action.attempts == 2
        assert offer_status is OfferStatus.EXPIRED
        assert outbox_count == 3
    finally:
        await _stop_process(process, release)
        await scheduler_support._delete_action(sessions, offer.id)
