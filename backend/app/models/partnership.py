from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Partnership(Base):
    __tablename__ = "partnerships"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    linked_property_deal_id = Column(Integer, ForeignKey("property_deals.id"))

    total_deal_value = Column(Numeric(15, 2))
    our_investment = Column(Numeric(15, 2), default=0)
    our_share_percentage = Column(Numeric(6, 3))

    total_received = Column(Numeric(15, 2), default=0)

    start_date = Column(Date)
    expected_end_date = Column(Date)
    actual_end_date = Column(Date)

    status = Column(String(30), default="active")  # active | settled | cancelled

    notes = Column(Text)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(Integer, ForeignKey("users.id"))

    linked_deal = relationship("PropertyDeal", foreign_keys=[linked_property_deal_id])
    creator = relationship("User", foreign_keys=[created_by])
    members = relationship("PartnershipMember", back_populates="partnership")
    transactions = relationship("PartnershipTransaction", back_populates="partnership")


class PartnershipMember(Base):
    __tablename__ = "partnership_members"

    id = Column(Integer, primary_key=True, index=True)
    partnership_id = Column(Integer, ForeignKey("partnerships.id"), nullable=False)
    contact_id = Column(Integer, ForeignKey("contacts.id"))  # NULL if is_self = TRUE
    is_self = Column(Boolean, default=False)
    share_percentage = Column(Numeric(6, 3), nullable=False)
    advance_contributed = Column(Numeric(15, 2), default=0)
    total_received = Column(Numeric(15, 2), default=0)
    notes = Column(Text)

    partnership = relationship("Partnership", back_populates="members")
    contact = relationship("Contact", foreign_keys=[contact_id])


class PartnershipTransaction(Base):
    __tablename__ = "partnership_transactions"

    id = Column(Integer, primary_key=True, index=True)
    partnership_id = Column(Integer, ForeignKey("partnerships.id"), nullable=False)
    member_id = Column(Integer, ForeignKey("partnership_members.id"))
    txn_type = Column(String(30), nullable=False)
    # invested | received | expense | profit_distributed
    amount = Column(Numeric(15, 2), nullable=False)
    txn_date = Column(Date, nullable=False)
    payment_mode = Column(String(30))
    description = Column(Text)
    account_id = Column(Integer, ForeignKey("cash_accounts.id"))
    received_by_member_id = Column(Integer, ForeignKey("partnership_members.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    partnership = relationship("Partnership", back_populates="transactions")
    member = relationship("PartnershipMember", foreign_keys=[member_id])
    received_by = relationship("PartnershipMember", foreign_keys=[received_by_member_id])
    creator = relationship("User", foreign_keys=[created_by])
    account = relationship("CashAccount", foreign_keys=[account_id])
