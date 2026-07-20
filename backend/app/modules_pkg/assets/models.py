"""Asset — anything the user owns outright and wants on their balance sheet.

Supersedes the old `unencumbered_assets` table (rows copied by migration
048, originals soft-deleted). Richer than its predecessor: quantity/unit
for weighables, carat for gold, and FD/RD terms for maturity projection.
"""
from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text,
)
from sqlalchemy.sql import func

from app.database import Base
from app.models.mixins import TenantMixin

ASSET_TYPES = (
    "gold",
    "silver",
    "vehicle",
    "real_estate",
    "stock",
    "mutual_fund",
    "fixed_deposit",
    "recurring_deposit",
    "equipment",
    "business",
    "other",
)

COMPOUNDING_OPTIONS = ("monthly", "quarterly", "half_yearly", "yearly")


class Asset(Base, TenantMixin):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    asset_type = Column(String(30), nullable=False, default="other", index=True)

    # Weighable / countable holdings (gold grams, share units, ...)
    quantity = Column(Numeric(15, 3), nullable=True)
    unit = Column(String(20), nullable=True)          # grams | units | sqft | ...
    gold_carat = Column(Integer, nullable=True)       # 18 | 22 | 24

    purchase_price = Column(Numeric(15, 2), nullable=True)
    purchase_date = Column(Date, nullable=True)

    # What the asset is worth today. Manually maintained, except gold where
    # /refresh-value recomputes it from the live rate (auto_valuation=True).
    current_value = Column(Numeric(15, 2), nullable=False)
    auto_valuation = Column(Boolean, nullable=False, default=False)
    value_updated_at = Column(DateTime(timezone=True), nullable=True)

    # Deposit terms (fixed_deposit / recurring_deposit)
    interest_rate = Column(Numeric(6, 3), nullable=True)       # % p.a.
    monthly_installment = Column(Numeric(15, 2), nullable=True)  # RD only
    start_date = Column(Date, nullable=True)
    maturity_date = Column(Date, nullable=True)
    compounding = Column(String(15), nullable=True, default="quarterly")

    notes = Column(Text, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
