"""Authoritative clock backed by the database."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

DatabaseClock = Callable[[AsyncSession], Awaitable[datetime]]


def _as_utc(moment: datetime) -> datetime:
    """Normalize the timezone-less ``CURRENT_TIMESTAMP`` SQLite returns."""
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


async def database_utc_now(session: AsyncSession) -> datetime:
    """Read the database's real time, not the start of the transaction.

    PostgreSQL keeps ``now()`` stable for the whole transaction. That is no
    use after waiting on a row lock: ``clock_timestamp()`` returns the
    actual instant the query runs. SQLite only takes part in
    local tests and uses its ``CURRENT_TIMESTAMP``.
    """
    if session.get_bind().dialect.name == "postgresql":
        moment = await session.scalar(select(func.clock_timestamp()))
    else:
        moment = await session.scalar(select(func.current_timestamp()))
    if moment is None:  # pragma: no cover - a healthy database always returns a value
        raise RuntimeError("La base de datos no devolvió su reloj.")
    return _as_utc(moment)
