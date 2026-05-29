"""Fixtures e2e: app FastAPI con DB SQLite en memoria y OAuth simulado."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import get_oauth_verifiers
from app.domain.entities import AuthProvider
from app.infrastructure.db.base import Base
from app.infrastructure.db.session import get_session
from app.main import create_app
from tests.fakes import FakeVerifier


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_session() -> AsyncIterator:
        async with session_factory() as session:
            yield session

    def override_get_verifiers() -> dict[str, FakeVerifier]:
        return {
            AuthProvider.GOOGLE.value: FakeVerifier(AuthProvider.GOOGLE),
            AuthProvider.FACEBOOK.value: FakeVerifier(AuthProvider.FACEBOOK),
        }

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_oauth_verifiers] = override_get_verifiers

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    await engine.dispose()
