"""C-DI-2: add is_deleted and updated_at to expenses table

Revision ID: 038_expense_soft_delete
Revises: 037_category_learnings_user_id
Create Date: 2025-01-01 00:00:02.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "038_expense_soft_delete"
down_revision = "037_category_learnings_user_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()")
    op.execute("CREATE INDEX IF NOT EXISTS ix_expenses_is_deleted ON expenses (is_deleted)")


def downgrade() -> None:
    op.drop_index("ix_expenses_is_deleted", table_name="expenses")
    op.drop_column("expenses", "updated_at")
    op.drop_column("expenses", "is_deleted")
