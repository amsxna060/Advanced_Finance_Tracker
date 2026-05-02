"""025 add forecast_overrides table"""

from alembic import op
import sqlalchemy as sa

revision = "025_forecast_overrides"
down_revision = "024_property_anomalies"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "forecast_overrides",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("item_id", sa.String(160), nullable=False),
        sa.Column("period_key", sa.String(7), nullable=False),
        sa.Column("included", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("amount_override", sa.Numeric(15, 2), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("fulfilled_amount", sa.Numeric(15, 2), nullable=True),
        sa.Column("fulfilled_at", sa.Date, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "item_id", "period_key", name="uq_forecast_override"),
    )
    op.create_index(
        "ix_forecast_overrides_user_period",
        "forecast_overrides",
        ["user_id", "period_key"],
    )
    op.create_index(
        "ix_forecast_overrides_item",
        "forecast_overrides",
        ["item_id"],
    )


def downgrade():
    op.drop_index("ix_forecast_overrides_item")
    op.drop_index("ix_forecast_overrides_user_period")
    op.drop_table("forecast_overrides")
