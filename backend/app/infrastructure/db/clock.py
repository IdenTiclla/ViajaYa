"""Reloj autoritativo respaldado por la base de datos."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

DatabaseClock = Callable[[AsyncSession], Awaitable[datetime]]


def _as_utc(moment: datetime) -> datetime:
    """Normaliza el ``CURRENT_TIMESTAMP`` sin zona que devuelve SQLite."""
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


async def database_utc_now(session: AsyncSession) -> datetime:
    """Lee tiempo real de la base, no el inicio de la transacción.

    PostgreSQL mantiene ``now()`` estable durante toda la transacción. Eso no
    sirve después de esperar un bloqueo de fila: ``clock_timestamp()`` devuelve el
    instante efectivo en que se ejecuta la consulta. SQLite solo participa en
    pruebas locales y usa su ``CURRENT_TIMESTAMP``.
    """
    if session.get_bind().dialect.name == "postgresql":
        moment = await session.scalar(select(func.clock_timestamp()))
    else:
        moment = await session.scalar(select(func.current_timestamp()))
    if moment is None:  # pragma: no cover - una base sana siempre devuelve un valor
        raise RuntimeError("La base de datos no devolvió su reloj.")
    return _as_utc(moment)
