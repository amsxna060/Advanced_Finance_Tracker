"""Add received_by_member_id to partnership_transactions.

Revision ID: 008_partnership_received_by
Revises: 007_money_obligations
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "008_partnership_received_by"
down_revision = "007_money_obligations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "partnership_transactions",
        sa.Column(
            "received_by_member_id",
            sa.Integer(),
            sa.ForeignKey("partnership_members.id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("partnership_transactions", "received_by_member_id")
