"""033 add property_simulations table

Revision ID: 033_property_simulations
Revises: 032_penalty_paid_on_payments
Create Date: 2026-05-05
"""
from alembic import op

revision = "033_property_simulations"
down_revision = "032_penalty_paid_on_payments"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS property_simulations (
            id          SERIAL PRIMARY KEY,
            property_deal_id INTEGER NOT NULL REFERENCES property_deals(id) ON DELETE CASCADE,
            name        VARCHAR(255) NOT NULL,
            payload     TEXT NOT NULL,
            created_by  INTEGER REFERENCES users(id),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_property_simulations_deal
            ON property_simulations (property_deal_id);
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS property_simulations;")
