"""Infraestructura aislada para pruebas PostgreSQL destructivas y opt-in."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.infrastructure.config import get_settings

_TEST_DATABASE_ENV = "VIAJAYA_TEST_DATABASE_URL"
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True, slots=True)
class PostgreSQLTestDatabase:
    """Base desechable y operaciones Alembic apuntadas exclusivamente a ella."""

    url: str
    engine: AsyncEngine

    def migrate(self, action: str, revision: str) -> None:
        """Ejecuta Alembic aislando la URL de prueba de la configuración normal."""
        previous_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = self.url
        get_settings.cache_clear()
        try:
            config = Config(str(_BACKEND_ROOT / "alembic.ini"))
            config.set_main_option("script_location", str(_BACKEND_ROOT / "migrations"))
            if action == "upgrade":
                command.upgrade(config, revision)
            elif action == "downgrade":
                command.downgrade(config, revision)
            else:  # pragma: no cover - solo lo usa esta suite
                raise ValueError(f"Acción Alembic desconocida: {action}")
        finally:
            if previous_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_url
            get_settings.cache_clear()

    async def migrate_async(self, action: str, revision: str) -> None:
        """Evita anidar el ``asyncio.run`` de Alembic en el loop de pytest."""
        await asyncio.to_thread(self.migrate, action, revision)

    async def purge_accounts(self) -> None:
        """Drop every test account so a downgrade below 0025 is not refused.

        Phone-only accounts are the norm now; the 0025 guard still protects real
        environments, but this database is disposable by construction.
        """
        async with self.engine.begin() as connection:
            exists = await connection.scalar(text("SELECT to_regclass('users') IS NOT NULL"))
            if exists:
                await connection.execute(text("TRUNCATE TABLE users CASCADE"))


def _test_database_url() -> str:
    raw_url = os.getenv(_TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(
            f"Define {_TEST_DATABASE_ENV} para ejecutar la certificación PostgreSQL aislada."
        )

    url = make_url(raw_url)
    if url.drivername != "postgresql+asyncpg":
        pytest.fail(f"{_TEST_DATABASE_ENV} debe usar el driver postgresql+asyncpg.")

    database = url.database or ""
    if not (database.startswith("test_") or database.endswith("_test")):
        pytest.fail(
            f"Base rechazada por seguridad: {database!r}. "
            "El nombre debe empezar por 'test_' o terminar en '_test'."
        )
    return raw_url


@pytest_asyncio.fixture(scope="session")
async def pg_test_db() -> PostgreSQLTestDatabase:
    """Recrea solo el esquema Alembic de una base señalada expresamente como test."""
    url = _test_database_url()
    engine = create_async_engine(url, poolclass=NullPool)
    database = PostgreSQLTestDatabase(url=url, engine=engine)

    await database.purge_accounts()
    await database.migrate_async("downgrade", "base")
    await database.migrate_async("upgrade", "head")
    try:
        yield database
    finally:
        await database.purge_accounts()
        await engine.dispose()
        await database.migrate_async("downgrade", "base")


async def _clean_scheduled_actions_if_present(
    database: PostgreSQLTestDatabase,
) -> None:
    """Aísla backfills 0022 creados al re-upgradear fixtures de revisiones viejas."""
    async with database.engine.begin() as connection:
        exists = await connection.scalar(
            text("SELECT to_regclass('scheduled_actions') IS NOT NULL")
        )
        if exists:
            await connection.execute(text("DELETE FROM scheduled_actions"))


@pytest_asyncio.fixture(autouse=True)
async def isolate_scheduled_actions(pg_test_db: PostgreSQLTestDatabase):
    """Limpia solo la cola de la base desechable entre casos PostgreSQL."""
    await _clean_scheduled_actions_if_present(pg_test_db)
    try:
        yield
    finally:
        await _clean_scheduled_actions_if_present(pg_test_db)
