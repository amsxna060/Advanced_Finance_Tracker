"""H-DI-13: add user_id to category_learnings for per-user scoping

Revision ID: 037_category_learnings_user_id
Revises: 036_refresh_token_blacklist
Create Date: 2025-01-01 00:00:01.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "037_category_learnings_user_id"
down_revision = "036_refresh_token_blacklist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add user_id column (nullable to preserve existing rows as global/legacy)
    op.add_column(
        "category_learnings",
        sa.Column("user_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_category_learnings_user_id", "category_learnings", ["user_id"])

    # Drop the old global unique constraint on description_normalized alone
    # since the same description can now exist once per user.
    # Use raw SQL with IF EXISTS so re-running on a DB that already dropped it
    # (or never had it) doesn't fail.
    op.execute(
        "ALTER TABLE category_learnings "
        "DROP CONSTRAINT IF EXISTS category_learnings_description_normalized_key"
    )
    # Also drop the per-user constraint if it already exists (idempotent re-run)
    op.execute(
        "ALTER TABLE category_learnings "
        "DROP CONSTRAINT IF EXISTS uq_category_learnings_user_desc"
    )
    # Add a per-user unique constraint
    op.create_unique_constraint(
        "uq_category_learnings_user_desc",
        "category_learnings",
        ["user_id", "description_normalized"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_category_learnings_user_desc", "category_learnings", type_="unique")
    op.drop_index("ix_category_learnings_user_id", table_name="category_learnings")
    op.drop_column("category_learnings", "user_id")
    op.create_unique_constraint(
        "category_learnings_description_normalized_key",
        "category_learnings",
        ["description_normalized"],
    )
