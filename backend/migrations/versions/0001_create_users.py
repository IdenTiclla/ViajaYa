"""create users table

Revision ID: 0001_create_users
Revises:
Create Date: 2026-05-29

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "0001_create_users"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=True),
        sa.Column(
            "auth_provider",
            sa.String(length=20),
            server_default="local",
            nullable=False,
        ),
        sa.Column("provider_id", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_provider_id", "users", ["provider_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_provider_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
