"""Verified identities keep the existing account UUID as their stable owner."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from app.domain.exceptions import DomainError

IdentityProvider = Literal["phone", "google", "facebook"]
VerificationPurpose = Literal["sign_in", "link_identity", "change_phone", "recovery"]


@dataclass(frozen=True)
class VerifiedIdentity:
    user_id: UUID
    provider: IdentityProvider
    subject: str
    verified_at: datetime


class InvalidPhoneError(DomainError):
    pass


class InvalidPhoneCodeError(DomainError):
    def __init__(self) -> None:
        super().__init__("Código inválido o vencido. Solicita uno nuevo si es necesario.")


class PhoneVerificationUnavailableError(DomainError):
    def __init__(self) -> None:
        super().__init__("La verificación por teléfono no está disponible por el momento.")


class PhoneVerificationRateLimitError(DomainError):
    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("Espera antes de volver a intentarlo.")
        self.retry_after_seconds = max(1, retry_after_seconds)


class IdentityAlreadyLinkedError(DomainError):
    def __init__(self) -> None:
        super().__init__("La identidad ya está vinculada. Recupera el acceso a tu cuenta.")
