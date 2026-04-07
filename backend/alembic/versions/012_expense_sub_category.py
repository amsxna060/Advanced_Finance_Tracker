"""Add sub_category column to expenses

Revision ID: 012_expense_sub_category
Revises: 011_nsew_roads_site_plots
Create Date: 2026-04-05
"""
from alembic import op
import sqlalchemy as sa

revision = '012_expense_sub_category'
down_revision = '011_nsew_roads_site_plots'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('expenses', sa.Column('sub_category', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('expenses', 'sub_category')
