"""Convert orphaned plot-buyer/plot status 'payment_done' to 'fully_paid'.

F4: a prior rename changed the code to write 'fully_paid' but never migrated
existing rows, so 3 live buyers still carried 'payment_done' — they were not
counted as sold on PropertyDetail and rendered as an unknown badge.

Revision ID: 044_payment_done_rename
Revises: 043_obligation_close_loss
Create Date: 2026-07-02
"""
from alembic import op

revision = "044_payment_done_rename"
down_revision = "043_obligation_close_loss"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE plot_buyers SET status = 'fully_paid' WHERE status = 'payment_done'")
    op.execute("UPDATE site_plots SET status = 'fully_paid' WHERE status = 'payment_done'")


def downgrade() -> None:
    # Not reversible per-row (the original label is gone); leave data as-is.
    pass
