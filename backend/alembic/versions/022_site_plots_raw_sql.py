"""Fix site_plots missing columns using raw SQL ADD COLUMN IF NOT EXISTS

Migration 021 used SQLAlchemy inspect() which can fail silently under
PgBouncer/Supabase transaction-mode pooling. This migration uses raw
PostgreSQL DDL (ADD COLUMN IF NOT EXISTS) which is 100% reliable.

Revision ID: 022_site_plots_raw_sql
Revises: 021_site_plots_missing_columns
Create Date: 2026-04-30
"""
from alembic import op

revision = "022_site_plots_raw_sql"
down_revision = "021_site_plots_missing_columns"
branch_labels = None
depends_on = None


def upgrade():
    # Use raw SQL with IF NOT EXISTS — works reliably regardless of connection pooler
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS plot_number VARCHAR(50)")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS side_north_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS side_south_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS side_east_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS side_west_ft NUMERIC(10,3)")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'available'")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS buyer_contact_id INTEGER REFERENCES contacts(id)")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS advance_received NUMERIC(15,2) DEFAULT 0")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS total_paid NUMERIC(15,2) DEFAULT 0")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS registry_date DATE")
    op.execute("ALTER TABLE site_plots ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN DEFAULT false")


def downgrade():
    pass  # safe no-op: don't drop data-bearing columns
