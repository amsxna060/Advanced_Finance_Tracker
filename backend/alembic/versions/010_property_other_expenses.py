"""Add other_expenses to property_deals

Revision ID: 010_property_other_expenses
Revises: 009_nullable_obligation_contact
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "010_property_other_expenses"
down_revision = "009_nullable_obligation_contact"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "property_deals",
        sa.Column("other_expenses", sa.Numeric(15, 2), nullable=True, server_default="0"),
    )


def downgrade():
    op.drop_column("property_deals", "other_expenses")
