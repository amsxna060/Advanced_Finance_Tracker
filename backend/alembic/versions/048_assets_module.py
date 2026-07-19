"""Assets module: create `assets` and absorb `unencumbered_assets` rows.

FB-4.1 (docs/saas-migration/BACKLOG.md). Old rows are copied into `assets`
(title->name, category->asset_type, estimated_value->current_value,
date_acquired->purchase_date) preserving owner/audit columns and their
is_deleted flags, then ALL originals are soft-deleted so net-worth sums
never double count. The legacy table and API stay readable for rollback.

Revision ID: 048_assets_module
Revises: 047_modules_email_verified
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "048_assets_module"
down_revision = "047_modules_email_verified"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("asset_type", sa.String(30), nullable=False, server_default="other"),
        sa.Column("quantity", sa.Numeric(15, 3)),
        sa.Column("unit", sa.String(20)),
        sa.Column("gold_carat", sa.Integer()),
        sa.Column("purchase_price", sa.Numeric(15, 2)),
        sa.Column("purchase_date", sa.Date()),
        sa.Column("current_value", sa.Numeric(15, 2), nullable=False),
        sa.Column("auto_valuation", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("value_updated_at", sa.DateTime(timezone=True)),
        sa.Column("interest_rate", sa.Numeric(6, 3)),
        sa.Column("monthly_installment", sa.Numeric(15, 2)),
        sa.Column("start_date", sa.Date()),
        sa.Column("maturity_date", sa.Date()),
        sa.Column("compounding", sa.String(15)),
        sa.Column("notes", sa.Text()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_assets_owner_id", "assets", ["owner_id"])
    op.create_index("ix_assets_asset_type", "assets", ["asset_type"])

    # Absorb legacy rows (categories map 1:1 — both lists share the names)
    op.execute("""
        INSERT INTO assets (owner_id, name, asset_type, current_value,
                            purchase_date, notes, is_deleted, created_by,
                            created_at, updated_at)
        SELECT owner_id, title, category, estimated_value,
               date_acquired, notes, is_deleted, created_by,
               created_at, updated_at
        FROM unencumbered_assets
    """)
    # Soft-delete originals so nothing sums them again
    op.execute("UPDATE unencumbered_assets SET is_deleted = true")


def downgrade() -> None:
    # Restore legacy rows' visibility, then drop the new table. Only rows
    # whose copy in `assets` is still live come back — rows that were already
    # deleted before the migration stay deleted. (Rows created directly in
    # `assets` after the upgrade are lost on downgrade — accepted.)
    op.execute("""
        UPDATE unencumbered_assets ua SET is_deleted = false
        WHERE EXISTS (
            SELECT 1 FROM assets a
            WHERE a.owner_id = ua.owner_id
              AND a.name = ua.title
              AND a.is_deleted = false
        )
    """)
    op.drop_index("ix_assets_asset_type", table_name="assets")
    op.drop_index("ix_assets_owner_id", table_name="assets")
    op.drop_table("assets")
