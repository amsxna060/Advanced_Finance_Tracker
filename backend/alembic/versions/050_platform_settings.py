"""Runtime-editable platform settings (admin-portal toggles).

Revision ID: 050_platform_settings
Revises: 049_outbox_events
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "050_platform_settings"
down_revision = "049_outbox_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
