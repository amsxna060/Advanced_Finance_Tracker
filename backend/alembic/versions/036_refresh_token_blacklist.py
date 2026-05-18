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
    op.execute("""
        CREATE TABLE IF NOT EXISTS refresh_token_blacklist (
            id SERIAL PRIMARY KEY,
            token_hash VARCHAR(64) NOT NULL,
            user_id INTEGER NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_rtb_token_hash ON refresh_token_blacklist (token_hash)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_rtb_user_id ON refresh_token_blacklist (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_rtb_expires_at ON refresh_token_blacklist (expires_at)")


def downgrade() -> None:
    op.drop_table("refresh_token_blacklist")
