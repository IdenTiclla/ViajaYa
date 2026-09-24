"""Tests of the opaque cursor exposed by the API layer."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.exceptions import RequestValidationError

from app.api.v1.pagination import decode_cursor, encode_cursor
from app.application.dto import PageCursor


def test_cursor_roundtrip_normalizes_timestamp_to_utc():
    cursor = PageCursor(
        created_at=datetime.fromisoformat("2026-07-18T00:15:00-04:00"),
        id=uuid.uuid4(),
    )

    encoded = encode_cursor(cursor)
    decoded = decode_cursor(encoded)

    assert encoded is not None
    assert decoded == PageCursor(
        created_at=datetime(2026, 7, 18, 4, 15, tzinfo=UTC),
        id=cursor.id,
    )


@pytest.mark.parametrize("value", ["", "not-base64", "e30", "e1widlwiOjJ9"])
def test_invalid_cursor_maps_to_422(value: str):
    with pytest.raises(RequestValidationError) as error:
        decode_cursor(value)

    assert error.value.errors()[0]["loc"] == ("query", "cursor")
