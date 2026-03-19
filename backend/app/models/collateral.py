from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Collateral(Base):
    __tablename__ = "collaterals"

    id = Column(Integer, primary_key=True, index=True)
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False)
    collateral_type = Column(String(30), nullable=False)  # house | gold | vehicle | land | other
    description = Column(Text)

    # Value tracking
    estimated_value = Column(Numeric(15, 2))
    warning_threshold_pct = Column(Numeric(5, 2), default=75.0)

    # Gold-specific fields
    gold_carat = Column(Integer)  # 18, 22, or 24
    gold_weight_grams = Column(Numeric(8, 3))
    gold_calculated_rate = Column(Numeric(15, 2))
    gold_manual_rate = Column(Numeric(15, 2))
    gold_use_manual_rate = Column(Boolean, default=False)
    gold_rate_fetched_at = Column(DateTime(timezone=True))

    # Photo
    photo_url = Column(Text)
    photo_uploaded_at = Column(DateTime(timezone=True))

    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    loan = relationship("Loan", back_populates="collaterals")
