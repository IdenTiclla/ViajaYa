"""Snapshot sanitario y endpoint operativo de scheduled_actions."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.api.deps import get_scheduled_actions_operational_snapshot
from app.application.use_cases.get_scheduled_actions_operational_snapshot import (
    GetScheduledActionsOperationalSnapshot,
)
from app.infrastructure.config import Settings
from app.infrastructure.db.models import ScheduledActionModel
from app.infrastructure.db.scheduled_actions_observability import (
    SqlAlchemyScheduledActionsOperationalReader,
)
from app.main import create_app


@pytest_asyncio.fixture
async def sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(ScheduledActionModel.__table__.create)
    try:
        yield factory
    finally:
        await engine.dispose()


def _row(
    *,
    now: datetime,
    status: str,
    action_type: str = "expire_offer",
    execute_offset: int = -10,
    next_attempt_offset: int | None = None,
    attempts: int = 0,
    locked_offset: int | None = None,
    terminal_offset: int | None = None,
) -> ScheduledActionModel:
    locked_at = (
        now + timedelta(seconds=locked_offset)
        if locked_offset is not None
        else None
    )
    terminal_at = (
        now + timedelta(seconds=terminal_offset)
        if terminal_offset is not None
        else None
    )
    aggregate_id = uuid.uuid4()
    return ScheduledActionModel(
        dedupe_key=f"{action_type}:{aggregate_id}",
        action_type=action_type,
        aggregate_id=aggregate_id,
        generation=1,
        execute_at=now + timedelta(seconds=execute_offset),
        payload={"dato_privado": "no-exponer"},
        status=status,
        attempts=attempts,
        next_attempt_at=now
        + timedelta(
            seconds=(
                next_attempt_offset
                if next_attempt_offset is not None
                else execute_offset
            )
        ),
        locked_at=locked_at,
        lock_token=uuid.uuid4() if locked_at is not None else None,
        last_error="RuntimeError" if attempts else None,
        terminal_at=terminal_at,
    )


async def _seed(sessions, now: datetime) -> None:
    async with sessions() as session:
        session.add_all(
            [
                _row(now=now, status="pending", execute_offset=-10),
                _row(
                    now=now,
                    status="pending",
                    execute_offset=60,
                    attempts=1,
                ),
                _row(now=now, status="running", locked_offset=-40),
                _row(now=now, status="running", locked_offset=-5),
                _row(now=now, status="dead", terminal_offset=-20),
                _row(
                    now=now,
                    status="dead",
                    action_type="tipo_desconocido",
                    terminal_offset=-10,
                ),
                _row(now=now, status="succeeded", terminal_offset=-5),
            ]
        )
        await session.commit()


async def _get(app, path: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def test_snapshot_cuenta_due_retries_leases_y_dead_sin_payloads(
    sessions,
) -> None:
    now = datetime.now(UTC)
    await _seed(sessions, now)
    async with sessions() as session:
        snapshot = await GetScheduledActionsOperationalSnapshot(
            SqlAlchemyScheduledActionsOperationalReader(session)
        ).execute(now, lease_seconds=30)

    assert snapshot.pending_count == 2
    assert snapshot.due_count == 1
    assert snapshot.running_count == 2
    assert snapshot.stale_count == 1
    assert snapshot.retrying_count == 1
    assert [(item.action_type, item.action_count) for item in snapshot.dead_counts] == [
        ("expire_offer", 1),
        ("tipo_desconocido", 1),
    ]
    assert snapshot.oldest_due_age_seconds == 10
    assert snapshot.next_due_at == now - timedelta(seconds=10)
    assert snapshot.latest_succeeded_at == now - timedelta(seconds=5)
    assert "dato_privado" not in repr(snapshot)


async def test_next_due_respeta_el_backoff_y_no_el_deadline_original(sessions) -> None:
    now = datetime.now(UTC)
    async with sessions() as session:
        session.add(
            _row(
                now=now,
                status="pending",
                execute_offset=-30,
                next_attempt_offset=45,
                attempts=1,
            )
        )
        await session.commit()

    async with sessions() as session:
        snapshot = await GetScheduledActionsOperationalSnapshot(
            SqlAlchemyScheduledActionsOperationalReader(session)
        ).execute(now, lease_seconds=30)

    assert snapshot.due_count == 0
    assert snapshot.next_due_at == now + timedelta(seconds=45)


async def test_health_scheduled_actions_off_no_exige_tabla() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        app = create_app(
            settings=Settings(_env_file=None),
            session_factory=sessions,
        )
        response = await _get(app, "/health/scheduled-actions")
    finally:
        await engine.dispose()

    assert response.status_code == 200
    assert response.json() == {"status": "disabled", "mode": "off"}


async def test_health_shadow_expone_solo_agregados(sessions) -> None:
    now = datetime.now(UTC)
    await _seed(sessions, now)
    app = create_app(
        settings=Settings(
            _env_file=None,
            scheduled_actions_mode="shadow",
        ),
        session_factory=sessions,
    )

    response = await _get(app, "/health/scheduled-actions")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["mode"] == "shadow"
    assert payload["due_count"] == 1
    assert payload["stale_count"] == 1
    assert payload["dead_counts"] == [
        {"action_type": "expire_offer", "action_count": 1},
        {"action_type": "tipo_desconocido", "action_count": 1},
    ]
    assert payload["claimed_count"] == 0
    assert payload["retention_days"] == 30
    assert payload["retention_deleted_action_count"] == 0
    assert "payload" not in response.text
    assert "dedupe" not in response.text
    assert "dato_privado" not in response.text


async def test_health_falla_cerrado_sin_filtrar_error(sessions, caplog) -> None:
    secret = "payload-super-secreto"

    class FailingUseCase:
        async def execute(self, now, *, lease_seconds):
            del now, lease_seconds
            raise RuntimeError(secret)

    app = create_app(
        settings=Settings(_env_file=None, scheduled_actions_mode="shadow"),
        session_factory=sessions,
    )
    app.dependency_overrides[
        get_scheduled_actions_operational_snapshot
    ] = FailingUseCase

    response = await _get(app, "/health/scheduled-actions")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "mode": "shadow"}
    assert secret not in response.text
    assert secret not in caplog.text
    assert "RuntimeError" in caplog.text
