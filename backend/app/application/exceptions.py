"""Errors specific to the application orchestration."""

from __future__ import annotations

from app.application.dto import RealtimeOutboxQuarantineCode


class InvalidRealtimeOutboxBatchError(ValueError):
    """The claimed outbox batch does not meet the publication contract."""

    def __init__(
        self,
        code: RealtimeOutboxQuarantineCode,
        message: str,
    ) -> None:
        super().__init__(message)
        self.code = code


class InvalidScheduledActionError(ValueError):
    """The persisted action does not meet its type's contract."""


class UnsupportedScheduledActionError(ValueError):
    """No handler is deployed for the claimed action type."""


class PassengerPresenceUnavailableError(RuntimeError):
    """Shared presence cannot make a safe decision."""
