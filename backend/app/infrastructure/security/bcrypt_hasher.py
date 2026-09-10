"""Reject ambiguous legacy passwords instead of silently truncating UTF-8 bytes."""

from __future__ import annotations

import bcrypt

from app.application.interfaces import PasswordHasher
from app.domain.exceptions import WeakPasswordError

_MAX_BYTES = 72


def _encode(plain: str) -> bytes:
    encoded = plain.encode("utf-8")
    if len(encoded) > _MAX_BYTES:
        raise ValueError("Password exceeds bcrypt byte limit")
    return encoded


class BcryptPasswordHasher(PasswordHasher):
    def hash(self, plain: str) -> str:
        try:
            encoded = _encode(plain)
        except ValueError as exc:
            raise WeakPasswordError("La contraseña no puede superar 72 bytes UTF-8.") from exc
        return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")

    def verify(self, plain: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(_encode(plain), hashed.encode("utf-8"))
        except ValueError:
            return False
