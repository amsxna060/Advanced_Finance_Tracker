from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class PropertyDeal(Base):
    __tablename__ = "property_deals"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    location = Column(Text)
    property_type = Column(String(50))  # plot | site | flat | commercial | agricultural
    total_area_sqft = Column(Numeric(12, 2))

    # Deal type
    deal_type = Column(String(20), default="middleman")  # middleman | purchase_and_hold

    # People
    seller_contact_id = Column(Integer, ForeignKey("contacts.id"))
    buyer_contact_id = Column(Integer, ForeignKey("contacts.id"))

    # Pricing (for middleman deals)
    seller_rate_per_sqft = Column(Numeric(12, 2))
    buyer_rate_per_sqft = Column(Numeric(12, 2))
    total_seller_value = Column(Numeric(15, 2))
    total_buyer_value = Column(Numeric(15, 2))

    # Advance/token to seller
    advance_paid = Column(Numeric(15, 2), default=0)
    advance_date = Column(Date)

    # Timeline
    deal_locked_date = Column(Date)
    expected_registry_date = Column(Date)
    actual_registry_date = Column(Date)

    # Profit tracking
    broker_name = Column(String(255))
    broker_commission = Column(Numeric(15, 2), default=0)
    other_expenses = Column(Numeric(15, 2), default=0)
    gross_profit = Column(Numeric(15, 2))
    net_profit = Column(Numeric(15, 2))

    # For purchase_and_hold type
    purchase_price = Column(Numeric(15, 2))
    holding_cost = Column(Numeric(15, 2), default=0)
    sale_price = Column(Numeric(15, 2))
    sale_date = Column(Date)

    # Plot dimension fields (only relevant for plot type)
    side_left_ft = Column(Numeric(10, 2))
    side_right_ft = Column(Numeric(10, 2))
    side_top_ft = Column(Numeric(10, 2))
    side_bottom_ft = Column(Numeric(10, 2))

    # Site-type investment fields
    my_investment = Column(Numeric(15, 2), default=0)
    my_share_percentage = Column(Numeric(6, 3))
    total_profit_received = Column(Numeric(15, 2))
    site_deal_start_date = Column(Date)
    site_deal_end_date = Column(Date)

    # Status pipeline
    status = Column(String(30), default="negotiating")
    # negotiating | advance_given | buyer_found | registry_done | settled | cancelled

    notes = Column(Text)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(Integer, ForeignKey("users.id"))

    seller = relationship("Contact", foreign_keys=[seller_contact_id])
    buyer = relationship("Contact", foreign_keys=[buyer_contact_id])
    creator = relationship("User", foreign_keys=[created_by])
    transactions = relationship("PropertyTransaction", back_populates="property_deal")


class PropertyTransaction(Base):
    __tablename__ = "property_transactions"

    id = Column(Integer, primary_key=True, index=True)
    property_deal_id = Column(Integer, ForeignKey("property_deals.id"), nullable=False)
    txn_type = Column(String(50), nullable=False)
    # advance_to_seller | payment_to_seller | received_from_buyer
    # commission_paid | expense | refund | sale_proceeds | other
    amount = Column(Numeric(15, 2), nullable=False)
    txn_date = Column(Date, nullable=False)
    payment_mode = Column(String(30))
    description = Column(Text)
    account_id = Column(Integer, ForeignKey("cash_accounts.id"))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    property_deal = relationship("PropertyDeal", back_populates="transactions")
    creator = relationship("User", foreign_keys=[created_by])
    account = relationship("CashAccount", foreign_keys=[account_id])
