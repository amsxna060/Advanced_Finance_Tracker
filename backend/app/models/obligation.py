"""
Money obligation model — tracks receivables and payables.

Who owes money to whom, why, and whether it's settled.
Linked to contacts, properties, partnerships, or standalone.
"""
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class MoneyObligation(Base):
    __tablename__ = "money_obligations"

    id = Column(Integer, primary_key=True, index=True)

    # receivable = someone owes me, payable = I owe someone
    obligation_type = Column(String(20), nullable=False)  # receivable | payable

    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=True)

    amount = Column(Numeric(15, 2), nullable=False)
    amount_settled = Column(Numeric(15, 2), default=0)

    reason = Column(Text)  # Why does this obligation exist?

    # Optional linkage to source deal
    linked_type = Column(String(30))  # property | partnership | loan | other
    linked_id = Column(Integer)

    due_date = Column(Date)
    status = Column(String(20), default="pending")  # pending | partial | settled

    notes = Column(Text)
    is_deleted = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    contact = relationship("Contact", foreign_keys=[contact_id])
    creator = relationship("User", foreign_keys=[created_by])
    settlements = relationship("ObligationSettlement", back_populates="obligation")


class ObligationSettlement(Base):
    __tablename__ = "obligation_settlements"

    id = Column(Integer, primary_key=True, index=True)
    obligation_id = Column(Integer, ForeignKey("money_obligations.id"), nullable=False)

    amount = Column(Numeric(15, 2), nullable=False)
    settlement_date = Column(Date, nullable=False)
    payment_mode = Column(String(30))
    account_id = Column(Integer, ForeignKey("cash_accounts.id"))
    notes = Column(Text)

    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    obligation = relationship("MoneyObligation", back_populates="settlements")
    account = relationship("CashAccount", foreign_keys=[account_id])
