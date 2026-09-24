"""E2E fixtures: FastAPI app with an in-memory SQLite DB, simulated OTP and simulated OAuth."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.deps import get_oauth_verifiers, get_session_factory
from app.api.v1 import presence
from app.domain.entities import AuthProvider
from app.infrastructure.db.base import Base
from app.infrastructure.db.session import get_session
from app.main import create_app
from tests.e2e.helpers import test_settings
from tests.fakes import FakeVerifier


@pytest_asyncio.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker]:
    """Shared in-memory SQLite engine (StaticPool) with the tables created."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        future=True,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield factory

    await engine.dispose()


@pytest_asyncio.fixture
async def client(request, session_factory) -> AsyncIterator[AsyncClient]:
    """App under test; ``@pytest.mark.settings(**overrides)`` tunes its Settings."""
    marker = request.node.get_closest_marker("settings")
    overrides = dict(marker.kwargs) if marker else {}

    async def override_get_session() -> AsyncIterator:
        async with session_factory() as session:
            yield session

    def override_get_verifiers() -> dict[str, FakeVerifier]:
        return {
            AuthProvider.GOOGLE.value: FakeVerifier(AuthProvider.GOOGLE),
            AuthProvider.FACEBOOK.value: FakeVerifier(AuthProvider.FACEBOOK),
        }

    app = create_app(settings=test_settings(**overrides))
    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_session_factory] = lambda: session_factory
    app.dependency_overrides[get_oauth_verifiers] = override_get_verifiers

    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        # Presence heartbeats leave deferred closes behind. Each test uses
        # its own SQLite database: they are cancelled before disposing of that engine so
        # an old task does not operate on the next test's database.
        tasks = set(presence._CANCEL_TASKS)
        tasks.update(presence._pending_cancels.values())
        tasks.update(presence._critical_cancels.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        presence._pending_cancels.clear()
        presence._critical_cancels.clear()
        presence._CANCEL_TASKS.clear()
        presence._last_seen.clear()
