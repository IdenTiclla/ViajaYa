"""Remove email/password access: drop password hashes and the legacy-auth flag.

Every account now signs in through a verified phone (optionally linked to a
social identity), so ``hashed_password`` and ``legacy_auth_disabled`` no longer
have a reader. Accounts without a verified phone cannot sign in after this
migration; the environment owner accepted that before production.

Revision ID: 0026_drop_password_access
Revises: 0025_managed_accounts
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026_drop_password_access"
down_revision = "0025_managed_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("users", "hashed_password")
    op.drop_column("users", "legacy_auth_disabled")


def downgrade() -> None:
    # Hashes are gone for good: restored columns come back empty, never guessed.
    op.add_column(
        "users",
        sa.Column(
            "legacy_auth_disabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column("users", sa.Column("hashed_password", sa.String(length=255), nullable=True))
