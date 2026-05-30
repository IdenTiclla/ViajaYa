"""Modelos ORM (tablas). Se mapean a/desde las entidades del dominio."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.entities import AuthProvider, RideStatus, ServiceType
from app.infrastructure.db.base import Base


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider, name="auth_provider", native_enum=False, length=20),
        default=AuthProvider.LOCAL,
        nullable=False,
    )
    provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RideRequestModel(Base):
    __tablename__ = "ride_requests"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    rider_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )

    origin_latitude: Mapped[float] = mapped_column(Float, nullable=False)
    origin_longitude: Mapped[float] = mapped_column(Float, nullable=False)
    origin_name: Mapped[str] = mapped_column(String(255), nullable=False)
    origin_address: Mapped[str] = mapped_column(String(512), nullable=False)

    destination_latitude: Mapped[float] = mapped_column(Float, nullable=False)
    destination_longitude: Mapped[float] = mapped_column(Float, nullable=False)
    destination_name: Mapped[str] = mapped_column(String(255), nullable=False)
    destination_address: Mapped[str] = mapped_column(String(512), nullable=False)

    service_type: Mapped[ServiceType] = mapped_column(
        Enum(ServiceType, name="service_type", native_enum=False, length=20), nullable=False
    )
    fare: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[RideStatus] = mapped_column(
        Enum(RideStatus, name="ride_status", native_enum=False, length=20),
        default=RideStatus.SEARCHING,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
