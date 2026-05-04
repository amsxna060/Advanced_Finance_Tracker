"""Add penalty_paid to loan_payments

Revision ID: 032_penalty_paid_on_payments
Revises: 031_loan_interest_calc_method
Create Date: 2026-05-04
"""
from alembic import op

revision = "032_penalty_paid_on_payments"
down_revision = "031_loan_interest_calc_method"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE loan_payments ADD COLUMN IF NOT EXISTS penalty_paid NUMERIC(15,2) NOT NULL DEFAULT 0"
    )


def downgrade():
    op.execute("ALTER TABLE loan_payments DROP COLUMN IF EXISTS penalty_paid")
