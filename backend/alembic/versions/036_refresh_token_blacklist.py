"""C-AUTH-2: add refresh_token_blacklist table for logout token revocation

Revision ID: 036_refresh_token_blacklist
Revises: 035_soft_delete_transactions
Create Date: 2025-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "036_refresh_token_blacklist"
down_revision = "035_soft_delete_transactions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "refresh_token_blacklist",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_rtb_token_hash", "refresh_token_blacklist", ["token_hash"], unique=True)
    op.create_index("ix_rtb_user_id", "refresh_token_blacklist", ["user_id"])
    op.create_index("ix_rtb_expires_at", "refresh_token_blacklist", ["expires_at"])


def downgrade() -> None:
    op.drop_table("refresh_token_blacklist")
