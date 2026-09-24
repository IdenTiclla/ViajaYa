"""Contract time types that always serialize an unambiguous instant."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AwareDatetime, BeforeValidator


def _assume_utc_for_naive(value: object) -> object:
    """SQLite drops ``tzinfo``; the backend persists all those instants in UTC."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


UtcAwareDatetime = Annotated[
    AwareDatetime,
    BeforeValidator(_assume_utc_for_naive),
]
