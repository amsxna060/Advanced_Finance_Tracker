"""
Cash / Bank Account models for tracking liquidity and money movements.

Tracks:
- Named accounts (Cash in Hand, HDFC Savings, SBI Current, Paytm Wallet, etc.)
- Debit/Credit transactions per account, optionally linked to loans, properties,
  partnerships, Beesis, or expenses
- Running balance computed from opening_balance + all transactions
"""

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class CashAccount(Base):
    __tablename__ = "cash_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)             # e.g. "Cash in Hand", "HDFC #4567"
    account_type = Column(String(30), nullable=False)      # cash | savings | current | wallet | fixed_deposit | credit_card
    bank_name = Column(String(255))
    account_number = Column(String(100))
    opening_balance = Column(Numeric(15, 2), default=0)    # Balance when account was first added
    credit_limit = Column(Numeric(15, 2), nullable=True)   # Credit card limit (only for credit_card type)
    billing_cycle_date = Column(Integer, nullable=True)     # Day of month (1-31) for credit card billing cycle
    notes = Column(Text)

    is_deleted = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])
    transactions = relationship("AccountTransaction", back_populates="account", order_by="AccountTransaction.txn_date.desc()")


class AccountTransaction(Base):
    """
    A debit or credit entry against a CashAccount.
    Can optionally be linked to a loan, property deal, partnership, beesi, or expense.
    """
    __tablename__ = "account_transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("cash_accounts.id"), nullable=False)

    txn_type = Column(String(10), nullable=False)          # credit | debit
    amount = Column(Numeric(15, 2), nullable=False)
    txn_date = Column(Date, nullable=False)
    description = Column(Text)

    # Optional source/destination linkage
    linked_type = Column(String(30))                       # loan | property | partnership | beesi | expense | manual
    linked_id = Column(Integer)                            # FK-less (works across all modules)
    contact_id = Column(Integer, ForeignKey("contacts.id"))  # Who is on the other side of this txn

    reference_number = Column(String(100))
    payment_mode = Column(String(30))                      # cash | upi | bank_transfer | cheque | neft | rtgs

    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("CashAccount", back_populates="transactions")
    creator = relationship("User", foreign_keys=[created_by])
