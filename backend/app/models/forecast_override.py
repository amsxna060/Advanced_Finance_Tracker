"""
ForecastOverride — per-user, per-item, per-period adjustment to the
forecast engine's calculated cash-flow items.

Scoped by `period_key` (YYYY-MM of the *viewing* period) so that
overrides made in May naturally stop applying in June — the engine
regenerates items each load and unmatched periods fall back to defaults.
That gives "auto-rollover to next month" for free without mutating any
underlying loan / obligation / beesi record.

`status` is informational ("fulfilled" / "skipped"). It does NOT post
to the loan ledger; the user must still record an actual payment to
move the underlying record to a paid state.
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric,
    UniqueConstraint, Index,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.mixins import TenantMixin


class ForecastOverride(Base, TenantMixin):
    __tablename__ = "forecast_overrides"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    item_id = Column(String(160), nullable=False)
    period_key = Column(String(7), nullable=False)  # YYYY-MM

    included = Column(Boolean, nullable=False, default=True)
    amount_override = Column(Numeric(15, 2), nullable=True)

    # pending | fulfilled | skipped
    status = Column(String(20), nullable=False, default="pending")
    fulfilled_amount = Column(Numeric(15, 2), nullable=True)
    fulfilled_at = Column(Date, nullable=True)

    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("user_id", "item_id", "period_key", name="uq_forecast_override"),
        Index("ix_forecast_overrides_user_period", "user_id", "period_key"),
        Index("ix_forecast_overrides_item", "item_id"),
    )
