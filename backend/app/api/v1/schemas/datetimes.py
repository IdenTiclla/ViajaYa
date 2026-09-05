"""Tipos temporales del contrato que siempre serializan un instante inequívoco."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AwareDatetime, BeforeValidator


def _assume_utc_for_naive(value: object) -> object:
    """SQLite pierde ``tzinfo``; el backend persiste todos esos instantes en UTC."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


UtcAwareDatetime = Annotated[
    AwareDatetime,
    BeforeValidator(_assume_utc_for_naive),
]
