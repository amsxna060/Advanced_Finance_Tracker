"""
Beesi (BC / Chit Fund) models.

A Beesi is a rotating savings group (ROSCA):
- N members each contribute base_installment every month
- Each month, one member claims the pot by bidding a discount
- The discount is split equally as a "dividend" and reduces everyone's installment
- My actual payment for the month = base_installment - dividend_received
- If I claim the pot I receive: pot_size - discount_I_offered
- Profit/loss at the end = total_received_as_lumpsum - total_installments_paid
"""

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Beesi(Base):
    __tablename__ = "beesis"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)           # e.g.  "Ramesh BC 2024"
    description = Column(Text)

    # Core parameters
    pot_size = Column(Numeric(15, 2), nullable=False)     # Total pot (e.g. 2,00,000)
    member_count = Column(Integer, nullable=False)         # Number of members (e.g. 20)
    tenure_months = Column(Integer, nullable=False)        # Total months (usually == member_count)
    base_installment = Column(Numeric(15, 2), nullable=False)  # My monthly base (e.g. 10,000)

    start_date = Column(Date, nullable=False)
    status = Column(String(20), default="active")          # active | completed | cancelled
    notes = Column(Text)

    is_deleted = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    installments = relationship("BeesiInstallment", back_populates="beesi", order_by="BeesiInstallment.month_number")
    withdrawals = relationship("BeesiWithdrawal", back_populates="beesi", order_by="BeesiWithdrawal.month_number")


class BeesiInstallment(Base):
    """One monthly payment record for a Beesi."""
    __tablename__ = "beesi_installments"

    id = Column(Integer, primary_key=True, index=True)
    beesi_id = Column(Integer, ForeignKey("beesis.id"), nullable=False)

    month_number = Column(Integer, nullable=False)         # 1-based (Month 1, 2, … N)
    payment_date = Column(Date, nullable=False)
    base_amount = Column(Numeric(15, 2), nullable=False)   # Base installment before dividend
    dividend_received = Column(Numeric(15, 2), default=0)  # Dividend from this month's bid
    actual_paid = Column(Numeric(15, 2), nullable=False)   # = base_amount - dividend_received
    notes = Column(Text)

    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    beesi = relationship("Beesi", back_populates="installments")
    creator = relationship("User", foreign_keys=[created_by])


class BeesiWithdrawal(Base):
    """Record for when I (or a month is logged as) claimed the pot."""
    __tablename__ = "beesi_withdrawals"

    id = Column(Integer, primary_key=True, index=True)
    beesi_id = Column(Integer, ForeignKey("beesis.id"), nullable=False)

    month_number = Column(Integer, nullable=False)         # In which month did I claim
    withdrawal_date = Column(Date, nullable=False)
    gross_amount = Column(Numeric(15, 2), nullable=False)  # = pot_size (face value)
    discount_offered = Column(Numeric(15, 2), default=0)   # How much I bid to win
    net_received = Column(Numeric(15, 2), nullable=False)  # gross - discount

    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    beesi = relationship("Beesi", back_populates="withdrawals")
    creator = relationship("User", foreign_keys=[created_by])
