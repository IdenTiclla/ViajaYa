"""Modelos ORM (tablas). Se mapean a/desde las entidades del dominio."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.entities import (
    AuthProvider,
    OfferStatus,
    PaymentMethod,
    RideStatus,
    SavedPlaceCategory,
    ServiceType,
    UserRole,
    VehicleType,
)
from app.infrastructure.db.base import Base


def _enum_values(enum_cls: type) -> list[str]:
    """Hace que SQLAlchemy persista/lea el *valor* del enum (minúscula), no su
    nombre. Así la columna coincide con el contrato de la API y con los
    ``server_default`` de las migraciones (p. ej. ``cash``, ``taxi``)."""
    return [member.value for member in enum_cls]


_ACTIVE_RIDE_STATUS_PREDICATE = text(
    "status IN ('searching', 'accepted', 'arriving', 'in_progress')"
)
_ACTIVE_DRIVER_RIDE_STATUS_PREDICATE = text(
    "driver_id IS NOT NULL AND status IN ('accepted', 'arriving', 'in_progress')"
)
_OPEN_POOL_PREDICATE = text("status = 'searching' AND paused = false")
_OUTBOX_PENDING_PREDICATE = text("published_at IS NULL AND sequence = 0")
_OUTBOX_UNPUBLISHED_PREDICATE = text("published_at IS NULL")
_OUTBOX_PAYLOAD_TYPE = JSON().with_variant(JSONB(), "postgresql")


class UserModel(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "rating IS NULL OR (rating >= 1 AND rating <= 5)",
            name="ck_users_rating_range",
        ),
    )

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
    # Campo fisico del conductor (taxi/moto). Sigue siendo VARCHAR(20), por lo que
    # separarlo de ServiceType no requiere transformar los valores persistidos.
    vehicle_type: Mapped[VehicleType | None] = mapped_column(
        Enum(
            VehicleType,
            name="vehicle_type",
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
    __table_args__ = (
        Index(
            "uq_ride_requests_active_rider",
            "rider_id",
            unique=True,
            postgresql_where=_ACTIVE_RIDE_STATUS_PREDICATE,
            sqlite_where=_ACTIVE_RIDE_STATUS_PREDICATE,
        ),
        Index(
            "uq_ride_requests_active_driver",
            "driver_id",
            unique=True,
            postgresql_where=_ACTIVE_DRIVER_RIDE_STATUS_PREDICATE,
            sqlite_where=_ACTIVE_DRIVER_RIDE_STATUS_PREDICATE,
        ),
        Index(
            "ix_ride_requests_open_pool_cursor",
            "service_type",
            text("created_at DESC"),
            text("id DESC"),
            postgresql_where=_OPEN_POOL_PREDICATE,
            sqlite_where=_OPEN_POOL_PREDICATE,
        ),
        Index(
            "ix_ride_requests_rider_status_cursor",
            "rider_id",
            "status",
            text("created_at DESC"),
            text("id DESC"),
        ),
        Index(
            "ix_ride_requests_driver_status_cursor",
            "driver_id",
            "status",
            text("created_at DESC"),
            text("id DESC"),
        ),
        CheckConstraint(
            "fare > 0 AND lower(CAST(fare AS TEXT)) "
            "NOT IN ('nan', 'infinity', '-infinity')",
            name="ck_ride_requests_fare_positive",
        ),
        CheckConstraint(
            "pool_version >= 1",
            name="ck_ride_requests_pool_version_positive",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    rider_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
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
        nullable=True,
    )
    accepted_offer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            "offers.id",
            name="fk_ride_requests_accepted_offer_id_offers",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    paused: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    pool_version: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DriverRideDismissalModel(Base):
    """Versión de una solicitud que un conductor decidió no volver a ver."""

    __tablename__ = "driver_ride_dismissals"
    __table_args__ = (
        UniqueConstraint("driver_id", "ride_id", name="uq_driver_ride_dismissals_driver_ride"),
        CheckConstraint(
            "pool_version >= 1",
            name="ck_driver_ride_dismissals_pool_version_positive",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ride_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ride_requests.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    pool_version: Mapped[int] = mapped_column(Integer, nullable=False)
    dismissed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class OfferModel(Base):
    __tablename__ = "offers"
    __table_args__ = (
        Index(
            "ix_offers_ride_status_cursor",
            "ride_id",
            "status",
            text("created_at DESC"),
            text("id DESC"),
        ),
        Index(
            "ix_offers_driver_status_cursor",
            "driver_id",
            "status",
            text("created_at DESC"),
            text("id DESC"),
        ),
        CheckConstraint(
            "price > 0 AND lower(CAST(price AS TEXT)) "
            "NOT IN ('nan', 'infinity', '-infinity')",
            name="ck_offers_price_positive",
        ),
        CheckConstraint(
            "eta_min IS NULL OR (eta_min >= 0 AND eta_min <= 240)",
            name="ck_offers_eta_min_range",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ride_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ride_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
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
    # Columna legada de 0010: se conserva para no destruir datos historicos,
    # pero ya no participa en el dominio desde que 0011 elimino ese estado.
    rider_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RideRatingModel(Base):
    __tablename__ = "ride_ratings"
    __table_args__ = (
        UniqueConstraint("ride_id", "rater_id", name="uq_ride_ratings_ride_rater"),
        CheckConstraint(
            "score >= 1 AND score <= 5",
            name="ck_ride_ratings_score_range",
        ),
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


class RideRatingSkipModel(Base):
    __tablename__ = "ride_rating_skips"
    __table_args__ = (
        UniqueConstraint("ride_id", "rater_id", name="uq_ride_rating_skips_ride_rater"),
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
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
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


class RealtimeAggregateVersionModel(Base):
    """Contador transaccional de versión para cada agregado del tiempo real."""

    __tablename__ = "realtime_aggregate_versions"
    __table_args__ = (
        CheckConstraint(
            "version >= 0",
            name="ck_realtime_aggregate_versions_version_nonnegative",
        ),
    )

    aggregate_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    aggregate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True
    )
    version: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RealtimeStreamVersionModel(Base):
    """Contador transaccional de secuencia para cada topic del tiempo real."""

    __tablename__ = "realtime_stream_versions"
    __table_args__ = (
        CheckConstraint(
            "version >= 0",
            name="ck_realtime_stream_versions_version_nonnegative",
        ),
    )

    topic: Mapped[str] = mapped_column(String(255), primary_key=True)
    version: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RealtimeOutboxModel(Base):
    """Evento durable pendiente de publicación por el dispatcher."""

    __tablename__ = "realtime_outbox"
    __table_args__ = (
        UniqueConstraint(
            "batch_id",
            "sequence",
            name="uq_realtime_outbox_batch_sequence",
        ),
        UniqueConstraint(
            "aggregate_type",
            "aggregate_id",
            "aggregate_version",
            name="uq_realtime_outbox_aggregate_version",
        ),
        UniqueConstraint(
            "topic",
            "stream_version",
            name="uq_realtime_outbox_topic_stream_version",
        ),
        CheckConstraint(
            "sequence >= 0",
            name="ck_realtime_outbox_sequence_nonnegative",
        ),
        CheckConstraint(
            "aggregate_version >= 1",
            name="ck_realtime_outbox_aggregate_version_positive",
        ),
        CheckConstraint(
            "stream_version >= 1",
            name="ck_realtime_outbox_stream_version_positive",
        ),
        CheckConstraint(
            "attempts >= 0",
            name="ck_realtime_outbox_attempts_nonnegative",
        ),
        Index(
            "ix_realtime_outbox_pending",
            "next_attempt_at",
            "created_at",
            "id",
            postgresql_where=_OUTBOX_PENDING_PREDICATE,
            sqlite_where=_OUTBOX_PENDING_PREDICATE,
        ),
        Index(
            "ix_realtime_outbox_pending_stream",
            "topic",
            "stream_version",
            postgresql_where=_OUTBOX_UNPUBLISHED_PREDICATE,
            sqlite_where=_OUTBOX_UNPUBLISHED_PREDICATE,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    sequence: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    stream_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    aggregate_type: Mapped[str] = mapped_column(String(32), nullable=False)
    aggregate_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    aggregate_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(
        _OUTBOX_PAYLOAD_TYPE, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
