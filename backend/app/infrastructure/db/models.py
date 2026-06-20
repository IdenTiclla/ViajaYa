"""Modelos ORM (tablas). Se mapean a/desde las entidades del dominio."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.entities import (
    AuthProvider,
    OfferStatus,
    PaymentMethod,
    RideStatus,
    SavedPlaceCategory,
    ServiceType,
    UserRole,
)
from app.infrastructure.db.base import Base


def _enum_values(enum_cls: type) -> list[str]:
    """Hace que SQLAlchemy persista/lea el *valor* del enum (minúscula), no su
    nombre. Así la columna coincide con el contrato de la API y con los
    ``server_default`` de las migraciones (p. ej. ``cash``, ``taxi``)."""
    return [member.value for member in enum_cls]


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
        Enum(
            AuthProvider,
            name="auth_provider",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        default=AuthProvider.LOCAL,
        nullable=False,
    )
    provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole,
            name="user_role",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        default=UserRole.PASSENGER,
        server_default=UserRole.PASSENGER.value,
        nullable=False,
    )
    # Campos de conductor (NULL para pasajeros).
    vehicle_type: Mapped[ServiceType | None] = mapped_column(
        Enum(
            ServiceType,
            name="service_type",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        nullable=True,
    )
    plate: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vehicle_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_online: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
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
        Enum(
            ServiceType,
            name="service_type",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        nullable=False,
    )
    fare: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    payment_method: Mapped[PaymentMethod] = mapped_column(
        Enum(
            PaymentMethod,
            name="payment_method",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        default=PaymentMethod.CASH,
        nullable=False,
    )
    status: Mapped[RideStatus] = mapped_column(
        Enum(
            RideStatus,
            name="ride_status",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        default=RideStatus.SEARCHING,
        nullable=False,
    )
    driver_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    accepted_offer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True
    )
    paused: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class OfferModel(Base):
    __tablename__ = "offers"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ride_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ride_requests.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    eta_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[OfferStatus] = mapped_column(
        Enum(
            OfferStatus,
            name="offer_status",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        default=OfferStatus.PENDING,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RideRatingModel(Base):
    __tablename__ = "ride_ratings"
    __table_args__ = (
        UniqueConstraint("ride_id", "rater_id", name="uq_ride_ratings_ride_rater"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ride_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ride_requests.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    rater_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    ratee_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SavedPlaceModel(Base):
    __tablename__ = "saved_places"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[SavedPlaceCategory] = mapped_column(
        Enum(
            SavedPlaceCategory,
            name="saved_place_category",
            native_enum=False,
            length=20,
            values_callable=_enum_values,
        ),
        nullable=False,
    )

    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str] = mapped_column(String(512), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
