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

    # El recorder queda apagado hasta que exista un dispatcher sombra que drene
    # y marque los batches sin reproducir eventos históricos al cliente.
    realtime_outbox_recording_enabled: bool = False
    realtime_outbox_dispatch_mode: Literal["off", "shadow"] = "off"
    realtime_outbox_poll_interval_seconds: float = Field(default=1.0, gt=0, le=60)
    realtime_outbox_retry_base_seconds: float = Field(default=1.0, gt=0, le=3600)
    realtime_outbox_retry_max_seconds: float = Field(default=60.0, gt=0, le=86400)
    realtime_outbox_shutdown_timeout_seconds: float = Field(default=5.0, gt=0, le=60)

    @model_validator(mode="after")
    def validate_realtime_outbox_rollout(self) -> Settings:
        if (
            self.realtime_outbox_recording_enabled
            and self.realtime_outbox_dispatch_mode == "off"
        ):
            raise ValueError(
                "REALTIME_OUTBOX_RECORDING_ENABLED requiere "
                "REALTIME_OUTBOX_DISPATCH_MODE=shadow."
            )
        if (
            self.realtime_outbox_retry_max_seconds
            < self.realtime_outbox_retry_base_seconds
        ):
            raise ValueError(
                "El backoff máximo de la outbox no puede ser menor al base."
            )
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
