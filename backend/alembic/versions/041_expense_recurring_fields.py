"""Add is_recurring and recurring_till to expenses

Revision ID: 041_expense_recurring
Revises: 040_paid_to_seller
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa

revision = "041_expense_recurring"
down_revision = "040_paid_to_seller"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "expenses",
        sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "expenses",
        sa.Column("recurring_till", sa.Date(), nullable=True),
    )


def downgrade():
    op.drop_column("expenses", "recurring_till")
    op.drop_column("expenses", "is_recurring")
