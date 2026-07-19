"""
Unencumbered (standalone) assets — fully-owned items not linked to any loan,
property deal, or partnership. Examples: a flat paid in full, gold holdings,
vehicles, business equity, or any other personal wealth.
"""
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.mixins import TenantMixin


UNENCUMBERED_CATEGORIES = (
    "real_estate",
    "gold",
    "vehicle",
    "equipment",
    "business",
    "fixed_deposit",
    "other",
)


class UnencumberedAsset(Base, TenantMixin):
    __tablename__ = "unencumbered_assets"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False, default="other")
    estimated_value = Column(Numeric(15, 2), nullable=False)
    date_acquired = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)

    is_deleted = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])
