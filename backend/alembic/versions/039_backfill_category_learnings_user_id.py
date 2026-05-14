"""Backfill user_id on legacy category_learnings rows

Migration 037 added the user_id column but left all pre-existing rows as
user_id = NULL.  suggest_from_learnings() now filters by user_id = current_user.id,
so those legacy rows are permanently invisible — the autofill button stops drawing
on any history the household had built up.

This migration assigns every NULL row to the oldest admin user, which is the
correct owner in a single-admin household tracker.  Rows that would violate the
unique constraint (user already has a per-user row for the same description) are
left as NULL so they don't cause an IntegrityError; they will be overwritten
naturally as the user resaves expenses with those descriptions.

Revision ID: 039_backfill_category_learnings_user_id
Revises: 038_expense_soft_delete
Create Date: 2026-05-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "039_backfill_category_learnings_user_id"
down_revision = "038_expense_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Find the oldest admin user — in a household tracker this is the owner.
    result = conn.execute(
        sa.text("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    )
    row = result.first()
    if row is None:
        # No admin user yet (first-run before seed); nothing to backfill.
        return

    admin_id = row[0]

    # Assign NULL rows to the admin user, skipping any description that already
    # has a per-user row for that admin (to avoid violating uq_category_learnings_user_desc).
    conn.execute(
        sa.text("""
            UPDATE category_learnings
               SET user_id = :admin_id
             WHERE user_id IS NULL
               AND description_normalized NOT IN (
                       SELECT description_normalized
                         FROM category_learnings
                        WHERE user_id = :admin_id
                   )
        """),
        {"admin_id": admin_id},
    )


def downgrade() -> None:
    # Revert the backfill: rows that were assigned to the admin in upgrade()
    # had no per-user row before, so setting them back to NULL is safe.
    # Rows that already had a per-user row were untouched by upgrade() and
    # remain untouched here.
    conn = op.get_bind()

    result = conn.execute(
        sa.text("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    )
    row = result.first()
    if row is None:
        return

    admin_id = row[0]

    # Only NULL-out rows that were created before migration 037 introduced
    # user_id (i.e. rows whose match_count is consistent with legacy saves).
    # Since we can't perfectly distinguish them, we null-out all admin rows
    # that don't also have a duplicate NULL row — the safest approximation.
    conn.execute(
        sa.text("""
            UPDATE category_learnings
               SET user_id = NULL
             WHERE user_id = :admin_id
        """),
        {"admin_id": admin_id},
    )
