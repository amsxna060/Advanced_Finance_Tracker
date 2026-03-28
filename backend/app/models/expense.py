from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(100))  # travel | legal | registration | office | commission | misc
    amount = Column(Numeric(15, 2), nullable=False)
    expense_date = Column(Date, nullable=False)
    linked_type = Column(String(30))  # loan | property | partnership | general
    linked_id = Column(Integer)
    description = Column(Text)
    payment_mode = Column(String(30))
    receipt_url = Column(Text)
    account_id = Column(Integer, ForeignKey("cash_accounts.id"))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    creator = relationship("User", foreign_keys=[created_by])
    account = relationship("CashAccount", foreign_keys=[account_id])
