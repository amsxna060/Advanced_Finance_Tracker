"""030 add penalty_per_day to loans"""

from alembic import op
from sqlalchemy import text

revision = "030_add_penalty_per_day"
down_revision = "029_add_perf_indexes"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(text(
        "ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_per_day NUMERIC(10,2) DEFAULT NULL;"
    ))


def downgrade():
    op.execute(text(
        "ALTER TABLE loans DROP COLUMN IF EXISTS penalty_per_day;"
    ))
