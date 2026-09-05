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
    # Redis solo participa en el fanout efímero. PostgreSQL conserva eventos,
    # versiones y snapshots autoritativos para recuperar cualquier desconexión.
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
    # El flag separa el despliegue del código de la promoción multiworker. Solo
    # se habilita cuando Redis y cancel_absent_ride durable están activos.
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
    # Los éxitos/cancelaciones no son evidencia de fallo y se purgan siempre;
    # ``dead`` queda fuera de esta política para conservar el diagnóstico.
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
        if (
            self.realtime_outbox_recording_enabled
            and self.realtime_outbox_dispatch_mode == "off"
        ):
            raise ValueError(
                "REALTIME_OUTBOX_RECORDING_ENABLED requiere "
                "REALTIME_OUTBOX_DISPATCH_MODE=shadow|live_local|live_redis."
            )
        if (
            self.realtime_outbox_dispatch_mode in {"live_local", "live_redis"}
            and not self.realtime_outbox_recording_enabled
        ):
            raise ValueError(
                f"{self.realtime_outbox_dispatch_mode} requiere "
                "REALTIME_OUTBOX_RECORDING_ENABLED=true."
            )
        if (
            self.realtime_outbox_dispatch_mode == "live_redis"
            and not self.realtime_redis_url.strip()
        ):
            raise ValueError("REALTIME_REDIS_URL es obligatorio en modo live_redis.")
        if (
            self.realtime_redis_reconnect_max_seconds
            < self.realtime_redis_reconnect_base_seconds
        ):
            raise ValueError(
                "El backoff máximo de Redis no puede ser menor al base."
            )
        if (
            self.realtime_presence_renew_interval_seconds
            >= self.realtime_presence_lease_seconds
        ):
            raise ValueError(
                "La renovación de presencia debe ocurrir antes de vencer su lease."
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
            or self.realtime_outbox_dispatch_mode
            not in {"live_local", "live_redis"}
        ):
            raise ValueError(
                "SCHEDULED_ACTIONS_MODE=live requiere outbox recording en "
                "modo live_local o live_redis."
            )
        if self.realtime_shared_presence_enabled and (
            self.realtime_outbox_dispatch_mode != "live_redis"
            or self.scheduled_actions_mode != "live"
        ):
            raise ValueError(
                "REALTIME_SHARED_PRESENCE_ENABLED requiere live_redis y "
                "SCHEDULED_ACTIONS_MODE=live."
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
