import enum
from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, ForeignKey, Numeric, Enum as SAEnum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class RecurringType(str, enum.Enum):
    inflow = "inflow"
    outflow = "outflow"


class RecurringFrequency(str, enum.Enum):
    weekly = "weekly"
    monthly = "monthly"
    yearly = "yearly"


class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    title = Column(String(255), nullable=False)
    type = Column(SAEnum(RecurringType, name="recurring_type_enum"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    frequency = Column(SAEnum(RecurringFrequency, name="recurring_frequency_enum"), nullable=False)
    next_due_date = Column(Date, nullable=False)
    account_id = Column(Integer, ForeignKey("cash_accounts.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])
    account = relationship("CashAccount", foreign_keys=[account_id])
