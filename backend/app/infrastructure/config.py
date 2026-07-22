"""Configuración central de la aplicación (única fuente de verdad, DRY)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://viajaya:viajaya@localhost:5432/viajaya"

    jwt_secret: str = "change-me-in-production-use-a-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14

    cors_origins: str = "http://localhost:8081,http://localhost:19006"

    google_client_id: str = ""
    facebook_app_id: str = ""
    facebook_app_secret: str = ""

    # El endpoint operativo se publica solo cuando el despliegue puede
    # restringirlo a la red de monitoreo.
    openmetrics_enabled: bool = False

    # El recorder queda apagado hasta desplegar un consumidor shadow/live que
    # drene los batches sin dejar un backlog histórico abandonado.
    realtime_outbox_recording_enabled: bool = False
    realtime_outbox_dispatch_mode: Literal["off", "shadow", "live_local"] = "off"
    realtime_outbox_poll_interval_seconds: float = Field(default=1.0, gt=0, le=60)
    realtime_outbox_retry_base_seconds: float = Field(default=1.0, gt=0, le=3600)
    realtime_outbox_retry_max_seconds: float = Field(default=60.0, gt=0, le=86400)
    realtime_outbox_shutdown_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    # La limpieza solo elimina batches publicados y queda desactivada hasta que
    # operación haya observado el backlog del entorno. Las cuarentenas se
    # conservan indefinidamente para auditoría.
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

    # Rollout independiente del scheduler: shadow hace dual-write pero conserva
    # el timer local; live entrega la ejecución al worker durable.
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

    @model_validator(mode="after")
    def validate_realtime_outbox_rollout(self) -> Settings:
        if (
            self.realtime_outbox_recording_enabled
            and self.realtime_outbox_dispatch_mode == "off"
        ):
            raise ValueError(
                "REALTIME_OUTBOX_RECORDING_ENABLED requiere "
                "REALTIME_OUTBOX_DISPATCH_MODE=shadow|live_local."
            )
        if (
            self.realtime_outbox_dispatch_mode == "live_local"
            and not self.realtime_outbox_recording_enabled
        ):
            raise ValueError(
                "REALTIME_OUTBOX_DISPATCH_MODE=live_local requiere "
                "REALTIME_OUTBOX_RECORDING_ENABLED=true."
            )
        if (
            self.realtime_outbox_retry_max_seconds
            < self.realtime_outbox_retry_base_seconds
        ):
            raise ValueError(
                "El backoff máximo de la outbox no puede ser menor al base."
            )
        if self.scheduled_actions_mode == "live" and (
            not self.realtime_outbox_recording_enabled
            or self.realtime_outbox_dispatch_mode != "live_local"
        ):
            raise ValueError(
                "SCHEDULED_ACTIONS_MODE=live requiere outbox recording en "
                "modo live_local."
            )
        if (
            self.scheduled_actions_retry_max_seconds
            < self.scheduled_actions_retry_base_seconds
        ):
            raise ValueError(
                "El backoff máximo de scheduled_actions no puede ser menor al base."
            )
        if (
            self.scheduled_actions_handler_timeout_seconds
            >= self.scheduled_actions_lease_seconds
        ):
            raise ValueError(
                "El timeout del handler debe ser menor al lease de scheduled_actions."
            )
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
