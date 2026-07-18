"""Codificación opaca de cursores de paginación para el contrato HTTP/WS."""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from datetime import UTC, datetime

from fastapi.exceptions import RequestValidationError

from app.application.dto import PageCursor

_CURSOR_VERSION = 1
_MAX_CURSOR_LENGTH = 512


def encode_cursor(cursor: PageCursor | None) -> str | None:
    if cursor is None:
        return None
    moment = cursor.created_at
    moment_utc = moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)
    payload = json.dumps(
        {
            "v": _CURSOR_VERSION,
            "created_at": moment_utc.isoformat().replace("+00:00", "Z"),
            "id": str(cursor.id),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(value: str | None) -> PageCursor | None:
    if value is None:
        return None
    try:
        if not value or len(value) > _MAX_CURSOR_LENGTH:
            raise ValueError
        padding = "=" * (-len(value) % 4)
        raw = base64.b64decode(value + padding, altchars=b"-_", validate=True)
        payload = json.loads(raw.decode())
        if not isinstance(payload, dict) or set(payload) != {"v", "created_at", "id"}:
            raise ValueError
        if payload["v"] != _CURSOR_VERSION:
            raise ValueError
        created_at = datetime.fromisoformat(str(payload["created_at"]).replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            raise ValueError
        return PageCursor(
            created_at=created_at.astimezone(UTC),
            id=uuid.UUID(str(payload["id"])),
        )
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error):
        raise RequestValidationError(
            [
                {
                    "type": "cursor_invalid",
                    "loc": ("query", "cursor"),
                    "msg": "Cursor de paginación inválido.",
                    "input": value,
                }
            ]
        ) from None
