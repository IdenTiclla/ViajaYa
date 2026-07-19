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
