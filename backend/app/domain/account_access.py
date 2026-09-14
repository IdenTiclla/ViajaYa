"""Business errors for account completion and session management."""

from __future__ import annotations

from app.domain.exceptions import DomainError


class InvalidAccountProfileError(DomainError):
    pass


class ReauthenticationRequiredError(DomainError):
    def __init__(self) -> None:
        super().__init__("Vuelve a verificar tu número actual para continuar.")


class AccountAccessDeniedError(DomainError):
    def __init__(self, message: str = "No puedes realizar esta acción sobre la cuenta.") -> None:
        super().__init__(message)
