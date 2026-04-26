from sqlalchemy import Column, Integer, String, Numeric, DateTime, Boolean, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class CategoryLimit(Base):
    """Monthly spending target per expense category, with optional rollover."""
    __tablename__ = "category_limits"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(100), nullable=False, unique=True)
    monthly_limit = Column(Numeric(15, 2), nullable=False)
    rollover_enabled = Column(Boolean, default=False, nullable=False, server_default="false")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])
