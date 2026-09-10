"""Phone metadata validation and environment-separated verification secrets."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from app.domain.phone_identity import InvalidPhoneError


class LibPhoneNumberNormalizer:
    def __init__(self, allowed_regions: tuple[str, ...]) -> None:
        self._allowed_regions = allowed_regions

    def normalize(self, phone: str) -> str:
        # Keep metadata loading outside the application startup path during rollout.
        import phonenumbers

        try:
            if not phone.strip().startswith("+"):
                raise ValueError("International country code required")
            parsed = phonenumbers.parse(phone, None)
            if (
                parsed.extension or not phonenumbers.is_valid_number(parsed)
                or phonenumbers.region_code_for_number(parsed) not in self._allowed_regions
            ):
                raise ValueError("Unsupported phone number")
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except (phonenumbers.NumberParseException, ValueError) as exc:
            raise InvalidPhoneError("Ingresa un número válido de un país habilitado.") from exc


class HmacPhoneVerificationSecrets:
    def __init__(self, secret: str, environment: str) -> None:
        self._key = secret.encode()
        self._environment = environment

    def code(self) -> str:
        return f"{secrets.randbelow(1_000_000):06d}"

    def token(self) -> str:
        return secrets.token_urlsafe(32)

    def digest(self, scope: str, value: str) -> str:
        payload = f"phone-otp:v1:{self._environment}:{scope}:{value}".encode()
        return hmac.new(self._key, payload, hashlib.sha256).hexdigest()
