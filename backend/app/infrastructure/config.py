"""Central application configuration and staged realtime rollout settings."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import SettingsConfigDict

from app.infrastructure.environment import EnvironmentSettings, validate_url


class Settings(EnvironmentSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    google_client_id: str = ""
    facebook_app_id: str = ""
    facebook_app_secret: str = ""

    # Enable only after migration 0025 and the phone entry flow are deployed.
    phone_otp_enabled: bool = False
    phone_otp_allowed_regions: tuple[str, ...] = ("BO",)
    phone_otp_ttl_seconds: int = Field(default=300, ge=30, le=600)
    phone_terms_version: str = Field(default="testing-2026-09", min_length=1, max_length=80)
    phone_terms_text: str = (
        "Estás usando una versión de pruebas de ViajaYa. Los viajes de prueba no contratan "
        "un servicio real. Usaremos tu número para identificar tu cuenta y tus datos para "
        "probar la aplicación. No uses documentos ni información sensible en estas pruebas."
    )

    # Expose operational metrics only behind the monitoring network perimeter.
    openmetrics_enabled: bool = False

    # Keep recording disabled until a shadow/live consumer can drain its backlog.
    realtime_outbox_recording_enabled: bool = False
    realtime_outbox_dispatch_mode: Literal[
        "off",
        "shadow",
        "live_local",
        "live_redis",
    ] = "off"
    realtime_outbox_poll_interval_seconds: float = Field(default=1.0, gt=0, le=60)
    realtime_outbox_retry_base_seconds: float = Field(default=1.0, gt=0, le=3600)
    realtime_outbox_retry_max_seconds: float = Field(default=60.0, gt=0, le=86400)
    realtime_outbox_shutdown_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    # Retention only removes published batches after operators inspect the backlog.
    # Quarantined batches remain available for audit.
    realtime_outbox_published_retention_days: int = Field(
        default=0,
        ge=0,
        le=3650,
    )
    realtime_outbox_retention_interval_seconds: float = Field(
        default=3600,
        gt=0,
        le=86400,
    )
    realtime_outbox_retention_batch_limit: int = Field(
        default=100,
        ge=1,
        le=1000,
    )
    # Redis provides transient fanout; PostgreSQL owns durable events and snapshots.
    realtime_redis_url: str = "redis://localhost:6379/0"
    realtime_redis_channel: str = Field(
        default="viajaya:realtime:v2",
        min_length=1,
        max_length=255,
        pattern=r"^[A-Za-z0-9:._-]+$",
    )
    realtime_redis_connect_timeout_seconds: float = Field(
        default=2.0,
        gt=0,
        le=30,
    )
    realtime_redis_reconnect_base_seconds: float = Field(
        default=0.5,
        gt=0,
        le=60,
    )
    realtime_redis_reconnect_max_seconds: float = Field(
        default=30.0,
        gt=0,
        le=600,
    )
    # Enable multiple workers only after Redis and durable presence are active.
    realtime_shared_presence_enabled: bool = False
    realtime_presence_key_prefix: str = Field(
        default="viajaya:presence:v1",
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9:._-]+$",
    )
    realtime_presence_lease_seconds: float = Field(default=30.0, gt=1, le=300)
    realtime_presence_renew_interval_seconds: float = Field(
        default=10.0,
        gt=0,
        le=120,
    )
    realtime_presence_grace_seconds: float = Field(default=120.0, gt=1, le=900)
    realtime_presence_recheck_seconds: float = Field(default=5.0, gt=0, le=60)

    # Shadow preserves local timers; live delegates execution to the durable worker.
    scheduled_actions_mode: Literal["off", "shadow", "live"] = "off"
    scheduled_actions_poll_interval_seconds: float = Field(
        default=1.0,
        gt=0,
        le=60,
    )
    scheduled_actions_lease_seconds: float = Field(default=30.0, gt=1, le=3600)
    scheduled_actions_handler_timeout_seconds: float = Field(
        default=10.0,
        gt=0,
        le=600,
    )
    scheduled_actions_max_attempts: int = Field(default=5, ge=1, le=100)
    scheduled_actions_retry_base_seconds: float = Field(default=1.0, gt=0, le=3600)
    scheduled_actions_retry_max_seconds: float = Field(default=60.0, gt=0, le=86400)
    scheduled_actions_shutdown_timeout_seconds: float = Field(
        default=12.0,
        gt=0,
        le=600,
    )
    # Purge successful/cancelled actions; keep dead actions for diagnostics.
    scheduled_actions_terminal_retention_days: int = Field(
        default=30,
        ge=1,
        le=3650,
    )
    scheduled_actions_retention_interval_seconds: float = Field(
        default=60,
        gt=0,
        le=86400,
    )
    scheduled_actions_retention_batch_limit: int = Field(
        default=1000,
        ge=1,
        le=10000,
    )

    @model_validator(mode="after")
    def validate_realtime_outbox_rollout(self) -> Settings:
        if self.realtime_outbox_recording_enabled and self.realtime_outbox_dispatch_mode == "off":
            raise ValueError(
                "REALTIME_OUTBOX_RECORDING_ENABLED requires "
                "REALTIME_OUTBOX_DISPATCH_MODE=shadow|live_local|live_redis."
            )
        if (
            self.realtime_outbox_dispatch_mode in {"live_local", "live_redis"}
            and not self.realtime_outbox_recording_enabled
        ):
            raise ValueError(
                f"{self.realtime_outbox_dispatch_mode} requires "
                "REALTIME_OUTBOX_RECORDING_ENABLED=true."
            )
        if (
            self.realtime_outbox_dispatch_mode == "live_redis"
            and not self.realtime_redis_url.strip()
        ):
            raise ValueError("REALTIME_REDIS_URL is required in live_redis mode.")
        if self.realtime_redis_reconnect_max_seconds < self.realtime_redis_reconnect_base_seconds:
            raise ValueError("Redis maximum backoff must not be shorter than its base.")
        if self.realtime_presence_renew_interval_seconds >= self.realtime_presence_lease_seconds:
            raise ValueError("Presence renewal must happen before its lease expires.")
        if self.realtime_outbox_retry_max_seconds < self.realtime_outbox_retry_base_seconds:
            raise ValueError("Outbox maximum backoff must not be shorter than its base.")
        if self.scheduled_actions_mode == "live" and (
            not self.realtime_outbox_recording_enabled
            or self.realtime_outbox_dispatch_mode not in {"live_local", "live_redis"}
        ):
            raise ValueError(
                "SCHEDULED_ACTIONS_MODE=live requires outbox recording in "
                "mode live_local or live_redis."
            )
        if self.realtime_shared_presence_enabled and (
            self.realtime_outbox_dispatch_mode != "live_redis"
            or self.scheduled_actions_mode != "live"
        ):
            raise ValueError(
                "REALTIME_SHARED_PRESENCE_ENABLED requires live_redis and "
                "SCHEDULED_ACTIONS_MODE=live."
            )
        if self.scheduled_actions_retry_max_seconds < self.scheduled_actions_retry_base_seconds:
            raise ValueError("Scheduled actions maximum backoff must not be shorter than its base.")
        if self.scheduled_actions_handler_timeout_seconds >= self.scheduled_actions_lease_seconds:
            raise ValueError(
                "The handler timeout must be shorter than the scheduled actions lease."
            )
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def validate_hosted_realtime_resources(self) -> Settings:
        if self.app_env == "development":
            return self
        validate_url(
            self.realtime_redis_url, "REALTIME_REDIS_URL", {"redis", "rediss"}, hosted=True
        )
        if self.realtime_redis_channel != f"viajaya:{self.app_env}:realtime:v2":
            raise ValueError("REALTIME_REDIS_CHANNEL must be scoped to APP_ENV.")
        if self.realtime_presence_key_prefix != f"viajaya:{self.app_env}:presence:v1":
            raise ValueError("REALTIME_PRESENCE_KEY_PREFIX must be scoped to APP_ENV.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
