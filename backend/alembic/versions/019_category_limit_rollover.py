"""Add rollover_enabled to category_limits

Revision ID: 019_category_limit_rollover
Revises: 018_is_legacy_flag
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa

revision = "019_category_limit_rollover"
down_revision = "018_is_legacy_flag"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "category_limits",
        sa.Column(
            "rollover_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade():
    op.drop_column("category_limits", "rollover_enabled")
