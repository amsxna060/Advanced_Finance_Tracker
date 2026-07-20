"""Entitlements + signup: users.enabled_modules and users.email_verified.

FB-3.1/FB-3.3 (docs/saas-migration/BACKLOG.md).

enabled_modules stays NULL for existing users = all modules (grandfathered).
email_verified is backfilled TRUE for every pre-signup account — they were
provisioned by the admin, not self-registered.

Revision ID: 047_modules_email_verified
Revises: 046_tenant_owner_id
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "047_modules_email_verified"
down_revision = "046_tenant_owner_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("enabled_modules", sa.JSON(), nullable=True))
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE users SET email_verified = true")


def downgrade() -> None:
    op.drop_column("users", "email_verified")
    op.drop_column("users", "enabled_modules")
