from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class ContactBrief(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    city: Optional[str] = None

    class Config:
        from_attributes = True


class LoanCreate(BaseModel):
    contact_id: int
    loan_direction: str
    loan_type: str
    principal_amount: Decimal
    disbursed_date: date
    interest_rate: Optional[Decimal] = None
    interest_start_date: Optional[date] = None
    interest_free_till: Optional[date] = None
    post_due_interest_rate: Optional[Decimal] = None
    emi_amount: Optional[Decimal] = None
    tenure_months: Optional[int] = None
    emi_day_of_month: Optional[int] = None
    capitalization_enabled: bool = False
    capitalization_after_months: Optional[int] = None
    institution_name: Optional[str] = None
    institution_loan_id: Optional[str] = None
    expected_end_date: Optional[date] = None
    account_id: Optional[int] = None
    notes: Optional[str] = None


class LoanUpdate(BaseModel):
    contact_id: Optional[int] = None
    loan_direction: Optional[str] = None
    loan_type: Optional[str] = None
    principal_amount: Optional[Decimal] = None
    disbursed_date: Optional[date] = None
    interest_rate: Optional[Decimal] = None
    interest_start_date: Optional[date] = None
    interest_free_till: Optional[date] = None
    post_due_interest_rate: Optional[Decimal] = None
    emi_amount: Optional[Decimal] = None
    tenure_months: Optional[int] = None
    emi_day_of_month: Optional[int] = None
    capitalization_enabled: Optional[bool] = None
    capitalization_after_months: Optional[int] = None
    institution_name: Optional[str] = None
    institution_loan_id: Optional[str] = None
    status: Optional[str] = None
    expected_end_date: Optional[date] = None
    actual_end_date: Optional[date] = None
    account_id: Optional[int] = None
    notes: Optional[str] = None


class LoanOut(BaseModel):
    id: int
    contact_id: int
    created_by: int
    loan_direction: str
    loan_type: str
    principal_amount: Decimal
    disbursed_date: date
    interest_rate: Optional[Decimal]
    interest_start_date: Optional[date]
    interest_free_till: Optional[date]
    post_due_interest_rate: Optional[Decimal]
    emi_amount: Optional[Decimal]
    tenure_months: Optional[int]
    emi_day_of_month: Optional[int]
    capitalization_enabled: bool
    capitalization_after_months: Optional[int]
    last_capitalization_date: Optional[date]
    institution_name: Optional[str]
    institution_loan_id: Optional[str]
    status: str
    expected_end_date: Optional[date]
    actual_end_date: Optional[date]
    account_id: Optional[int] = None
    notes: Optional[str]
    is_deleted: Optional[bool] = None
    created_at: datetime
    updated_at: datetime
    contact: Optional[ContactBrief] = None

    class Config:
        from_attributes = True


class LoanPaymentCreate(BaseModel):
    payment_date: date
    amount_paid: Decimal
    principal_repayment: Optional[Decimal] = None  # explicit principal reduction for interest_only loans
    auto_split: bool = False  # when True, interest first then remainder to principal
    payment_mode: Optional[str] = None
    collected_by: Optional[str] = None
    reference_number: Optional[str] = None
    account_id: Optional[int] = None
    notes: Optional[str] = None


class LoanPaymentOut(BaseModel):
    id: int
    loan_id: int
    payment_date: date
    amount_paid: Decimal
    allocated_to_overdue_interest: Decimal
    allocated_to_current_interest: Decimal
    allocated_to_principal: Decimal
    payment_mode: Optional[str]
    collected_by: Optional[str]
    reference_number: Optional[str]
    account_id: Optional[int] = None
    notes: Optional[str]
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class OutstandingResponse(BaseModel):
    principal_outstanding: Decimal
    interest_outstanding: Decimal
    total_outstanding: Decimal
    as_of_date: date


class PaymentPreviewResponse(BaseModel):
    amount: Decimal
    allocated_to_overdue_interest: Decimal
    allocated_to_current_interest: Decimal
    allocated_to_principal: Decimal
    unallocated: Decimal


class CapitalizeRequest(BaseModel):
    event_date: date
    interest_rate_after: Optional[Decimal] = None
    notes: Optional[str] = None
