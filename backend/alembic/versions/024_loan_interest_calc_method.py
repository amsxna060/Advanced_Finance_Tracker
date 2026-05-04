"""Add interest_calc_method to loans table

Revision ID: 024_loan_interest_calc_method
Revises: 023_all_tables_raw_sql
Create Date: 2026-05-04
"""
from alembic import op

revision = "024_loan_interest_calc_method"
down_revision = "023_all_tables_raw_sql"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE loans ADD COLUMN IF NOT EXISTS "
        "interest_calc_method VARCHAR(20) NOT NULL DEFAULT 'commercial'"
    )


def downgrade():
    op.execute("ALTER TABLE loans DROP COLUMN IF EXISTS interest_calc_method")
