"""Add category_learnings table for AI learning from user saves

Revision ID: 013_category_learnings
Revises: 012_expense_sub_category
Create Date: 2026-04-10
"""
from alembic import op
import sqlalchemy as sa

revision = '013_category_learnings'
down_revision = '012_expense_sub_category'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'category_learnings',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('description_normalized', sa.String(500), unique=True, index=True, nullable=False),
        sa.Column('category', sa.String(100), nullable=False),
        sa.Column('sub_category', sa.String(100), nullable=True),
        sa.Column('match_count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('category_learnings')
