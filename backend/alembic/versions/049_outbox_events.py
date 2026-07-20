"""E8 — transactional outbox table.

Revision ID: 049_outbox_events
Revises: 048_assets_module
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "049_outbox_events"
down_revision = "048_assets_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outbox_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("owner_id", sa.Integer()),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text()),
    )
    op.create_index("ix_outbox_events_event_type", "outbox_events", ["event_type"])
    op.create_index("ix_outbox_events_owner_id", "outbox_events", ["owner_id"])
    op.create_index("ix_outbox_events_processed_at", "outbox_events", ["processed_at"])


def downgrade() -> None:
    op.drop_table("outbox_events")
