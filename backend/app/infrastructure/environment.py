"""Environment boundaries shared by configuration and future provider adapters."""

from __future__ import annotations

import ipaddress
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings

AppEnvironment = Literal["development", "testing", "production"]
OtpMode = Literal["mock", "provider"]
PaymentMode = Literal["mock", "sandbox", "live"]
NotificationMode = Literal["mock", "restricted", "live"]

DEVELOPMENT_JWT_SECRET = "change-me-in-production-use-a-long-random-string"


def is_local_host(host: str) -> bool:
    """Allow private service networks while rejecting local deployment defaults."""
    host = host.rstrip(".").lower()
    if host.isdigit() or host.startswith("0x"):
        return True
    if host.lower() in {"localhost", "db", "redis", "host.docker.internal"}:
        return True
    if host.lower().endswith((".localhost", ".local")):
        return True
    try:
        address = ipaddress.ip_address(host)
        return address.is_loopback or address.is_unspecified or address.is_link_local
    except ValueError:
        return False


def validate_url(value: str, field: str, schemes: set[str], *, hosted: bool) -> None:
    """Reject malformed URLs without echoing credentials into validation errors."""
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme in schemes and bool(parsed.hostname)
        valid = valid and not parsed.query and not parsed.fragment
        if parsed.port is not None:
            valid = valid and parsed.port > 0
        if hosted:
            valid = valid and not is_local_host(parsed.hostname or "")
    except ValueError:
        valid = False
    if not valid:
        raise ValueError(f"{field} must use a valid URL for the selected environment.")


class EnvironmentSettings(BaseSettings):
    """Fail closed when a hosted deployment reuses unsafe development settings."""

    app_env: AppEnvironment = "development"
    public_api_url: str = "http://localhost:8000/api/v1"
    database_url: str = Field(
        default="postgresql+asyncpg://viajaya:viajaya@localhost:5432/viajaya",
        repr=False,
    )
    jwt_secret: str = Field(default=DEVELOPMENT_JWT_SECRET, repr=False)
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_issuer: str = ""
    jwt_audience: str = ""
    access_token_expire_minutes: int = Field(default=30, gt=0, le=1440)
    refresh_token_expire_days: int = Field(default=14, gt=0, le=90)
    cors_origins: str = "http://localhost:8081,http://localhost:19006"
    storage_namespace: str = ""

    # These are contracts only. OTP flows and payment adapters arrive in F02/F07.
    otp_mode: OtpMode = "mock"
    otp_test_autofill: bool = True
    otp_provider_api_key: SecretStr | None = None
    payment_mode: PaymentMode = "mock"
    email_mode: NotificationMode = "mock"
    push_mode: NotificationMode = "mock"
    notification_test_recipients: str = ""

    @model_validator(mode="after")
    def validate_environment(self) -> EnvironmentSettings:
        hosted = self.app_env != "development"
        for field, expected in (
            ("jwt_issuer", f"viajaya:{self.app_env}"),
            ("jwt_audience", f"viajaya:mobile:{self.app_env}"),
            ("storage_namespace", f"viajaya-{self.app_env}"),
        ):
            current = getattr(self, field)
            if current and current != expected:
                raise ValueError(f"{field.upper()} does not match APP_ENV.")
            setattr(self, field, expected)

        validate_url(
            self.public_api_url,
            "PUBLIC_API_URL",
            {"https"} if hosted else {"http", "https"},
            hosted=hosted,
        )
        api = urlsplit(self.public_api_url)
        if api.path.rstrip("/") != "/api/v1" or api.username or api.password:
            raise ValueError("PUBLIC_API_URL must end in /api/v1 without credentials.")
        self.public_api_url = self.public_api_url.rstrip("/")

        expected_payment_mode = {
            "development": "mock",
            "testing": "sandbox",
            "production": "live",
        }[self.app_env]
        if self.payment_mode != expected_payment_mode:
            raise ValueError(f"PAYMENT_MODE must be {expected_payment_mode} for APP_ENV.")
        if self.app_env == "production":
            if self.otp_mode != "provider" or self.otp_test_autofill:
                raise ValueError("Production requires provider OTP without test autofill.")
            if self.email_mode != "live" or self.push_mode != "live":
                raise ValueError("Production requires live email and push modes.")
            if self.notification_test_recipients.strip():
                raise ValueError("Production must not contain test recipient overrides.")
        else:
            if self.otp_mode != "mock" or self.otp_provider_api_key is not None:
                raise ValueError(
                    "Lower environments require mock OTP without provider credentials."
                )
            if "live" in {self.email_mode, self.push_mode}:
                raise ValueError("Lower environments cannot use unrestricted email or push.")
            if (
                "restricted" in {self.email_mode, self.push_mode}
                and not self.notification_test_recipients.strip()
            ):
                raise ValueError("Restricted notifications require explicit test recipients.")

        if hosted:
            validate_url(self.database_url, "DATABASE_URL", {"postgresql+asyncpg"}, hosted=True)
            database = urlsplit(self.database_url)
            if not database.path.endswith(f"_{self.app_env}"):
                raise ValueError("The hosted database name must end with _<APP_ENV>.")
            if not database.username or not database.password:
                raise ValueError("Hosted databases require their own credentials.")
            if database.password.lower() in {"viajaya", "password", "postgres", "change-me"} or any(
                marker in database.password.lower() for marker in ("replace-me", "placeholder")
            ):
                raise ValueError("Hosted databases cannot use example credentials.")
            secret = self.jwt_secret.strip()
            if (
                len(secret.encode()) < 32
                or secret == DEVELOPMENT_JWT_SECRET
                or any(
                    marker in secret.lower()
                    for marker in ("change-me", "replace-me", "placeholder")
                )
            ):
                raise ValueError("Hosted JWT_SECRET must contain at least 32 non-example bytes.")
            origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
            if not origins:
                raise ValueError("Hosted CORS_ORIGINS must explicitly list allowed origins.")
            for origin in origins:
                validate_url(origin, "CORS_ORIGINS", {"https"}, hosted=True)
                parsed = urlsplit(origin)
                if parsed.username or parsed.password or parsed.path not in {"", "/"}:
                    raise ValueError(
                        "CORS_ORIGINS must contain origins without paths or credentials."
                    )
        return self
