from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, Date, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class Loan(Base):
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Classification
    loan_direction = Column(String(10), nullable=False)  # given | taken
    loan_type = Column(String(20), nullable=False)  # interest_only | emi | short_term

    # Core amounts
    principal_amount = Column(Numeric(15, 2), nullable=False)
    disbursed_date = Column(Date, nullable=False)

    # Interest configuration
    interest_rate = Column(Numeric(6, 3))  # % per MONTH
    interest_start_date = Column(Date)
    interest_free_till = Column(Date)  # short_term: no interest until this date
    post_due_interest_rate = Column(Numeric(6, 3))  # short_term: rate after interest_free_till

    # EMI configuration
    emi_amount = Column(Numeric(15, 2))
    tenure_months = Column(Integer)
    emi_day_of_month = Column(Integer)

    # Interest capitalization
    capitalization_enabled = Column(Boolean, default=False)
    capitalization_after_months = Column(Integer)
    last_capitalization_date = Column(Date)

    # For loans taken from institutions
    institution_name = Column(String(255))
    institution_loan_id = Column(String(100))

    # Status
    status = Column(String(20), default="active")  # active | closed | defaulted | on_hold
    expected_end_date = Column(Date)
    actual_end_date = Column(Date)

    notes = Column(Text)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    contact = relationship("Contact", foreign_keys=[contact_id])
    creator = relationship("User", foreign_keys=[created_by])
    payments = relationship("LoanPayment", back_populates="loan", order_by="LoanPayment.payment_date")
    capitalization_events = relationship("LoanCapitalizationEvent", back_populates="loan", order_by="LoanCapitalizationEvent.event_date")
    collaterals = relationship("Collateral", back_populates="loan")


class LoanPayment(Base):
    __tablename__ = "loan_payments"

    id = Column(Integer, primary_key=True, index=True)
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False)
    payment_date = Column(Date, nullable=False)
    amount_paid = Column(Numeric(15, 2), nullable=False)

    # Auto-calculated allocation breakdown
    allocated_to_overdue_interest = Column(Numeric(15, 2), default=0)
    allocated_to_current_interest = Column(Numeric(15, 2), default=0)
    allocated_to_principal = Column(Numeric(15, 2), default=0)

    payment_mode = Column(String(30))  # cash | upi | bank_transfer | cheque
    collected_by = Column(String(100))
    reference_number = Column(String(100))
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    loan = relationship("Loan", back_populates="payments")
    creator = relationship("User", foreign_keys=[created_by])


class LoanCapitalizationEvent(Base):
    __tablename__ = "loan_capitalization_events"

    id = Column(Integer, primary_key=True, index=True)
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False)
    event_date = Column(Date, nullable=False)
    outstanding_interest_before = Column(Numeric(15, 2), nullable=False)
    principal_before = Column(Numeric(15, 2), nullable=False)
    new_principal = Column(Numeric(15, 2), nullable=False)
    interest_rate_after = Column(Numeric(6, 3))
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    loan = relationship("Loan", back_populates="capitalization_events")
    creator = relationship("User", foreign_keys=[created_by])
