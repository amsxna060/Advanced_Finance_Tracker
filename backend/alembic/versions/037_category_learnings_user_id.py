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
    # Use raw SQL for ADD COLUMN and CREATE INDEX so the migration is fully
    # idempotent. op.add_column / op.create_index raise errors when the column
    # or index already exists (e.g. after a mid-migration container restart where
    # ADD COLUMN committed but the Alembic version row didn't). IF NOT EXISTS
    # makes a re-run a safe no-op.
    op.execute(
        "ALTER TABLE category_learnings "
        "ADD COLUMN IF NOT EXISTS user_id INTEGER"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_category_learnings_user_id "
        "ON category_learnings (user_id)"
    )

    # Drop the old global unique constraint on description_normalized alone
    # since the same description can now exist once per user.
    op.execute(
        "ALTER TABLE category_learnings "
        "DROP CONSTRAINT IF EXISTS category_learnings_description_normalized_key"
    )
    # Also drop the per-user constraint if it already exists (idempotent re-run)
    op.execute(
        "ALTER TABLE category_learnings "
        "DROP CONSTRAINT IF EXISTS uq_category_learnings_user_desc"
    )
    # Add a per-user unique constraint (NULL user_id = legacy global row;
    # PostgreSQL treats two NULLs as distinct so those rows don't conflict).
    op.execute(
        "ALTER TABLE category_learnings "
        "ADD CONSTRAINT uq_category_learnings_user_desc "
        "UNIQUE (user_id, description_normalized)"
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
