"""Implementación de ``PasswordHasher`` con la librería ``bcrypt``.

bcrypt opera sobre como máximo 72 bytes; las contraseñas más largas se truncan a
ese límite (comportamiento estándar) para evitar errores en bcrypt >= 5.
"""

from __future__ import annotations

import bcrypt

from app.application.interfaces import PasswordHasher

_MAX_BYTES = 72


def _encode(plain: str) -> bytes:
    return plain.encode("utf-8")[:_MAX_BYTES]


class BcryptPasswordHasher(PasswordHasher):
    def hash(self, plain: str) -> str:
        return bcrypt.hashpw(_encode(plain), bcrypt.gensalt()).decode("utf-8")

    def verify(self, plain: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(_encode(plain), hashed.encode("utf-8"))
        except ValueError:
            return False
