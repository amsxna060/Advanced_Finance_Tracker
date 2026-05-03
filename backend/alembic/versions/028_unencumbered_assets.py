"""028 add unencumbered_assets table"""

from alembic import op
from sqlalchemy import text

revision = "028_unencumbered_assets"
down_revision = "027_account_txn_soft_delete"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS unencumbered_assets (
            id              SERIAL PRIMARY KEY,
            title           VARCHAR(255) NOT NULL,
            category        VARCHAR(50)  NOT NULL DEFAULT 'other',
            estimated_value NUMERIC(15, 2) NOT NULL,
            date_acquired   DATE,
            notes           TEXT,
            is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
            created_by      INTEGER NOT NULL REFERENCES users(id),
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_unencumbered_assets_created_by "
        "ON unencumbered_assets (created_by)"
    ))


def downgrade():
    op.execute(text("DROP INDEX IF EXISTS ix_unencumbered_assets_created_by"))
    op.execute(text("DROP TABLE IF EXISTS unencumbered_assets"))
