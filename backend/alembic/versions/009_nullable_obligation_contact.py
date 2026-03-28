"""Make money_obligations.contact_id nullable for self-share entries

Revision ID: 009_nullable_obligation_contact
Revises: 008_partnership_received_by
Create Date: 2026-03-28
"""
from alembic import op

revision = "009_nullable_obligation_contact"
down_revision = "008_partnership_received_by"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("money_obligations", "contact_id", nullable=True)


def downgrade():
    op.alter_column("money_obligations", "contact_id", nullable=False)
