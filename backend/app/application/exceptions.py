"""Errores propios de la orquestación de la aplicación."""

from __future__ import annotations

from app.application.dto import RealtimeOutboxQuarantineCode


class InvalidRealtimeOutboxBatchError(ValueError):
    """El lote reclamado de la outbox no cumple el contrato de publicación."""

    def __init__(
        self,
        code: RealtimeOutboxQuarantineCode,
        message: str,
    ) -> None:
        super().__init__(message)
        self.code = code


class InvalidScheduledActionError(ValueError):
    """La acción persistida no cumple el contrato de su tipo."""


class UnsupportedScheduledActionError(ValueError):
    """No existe un handler desplegado para el tipo de acción reclamado."""


class PassengerPresenceUnavailableError(RuntimeError):
    """La presencia compartida no puede tomar una decisión segura."""
