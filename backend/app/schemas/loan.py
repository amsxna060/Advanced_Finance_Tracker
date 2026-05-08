from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal
from datetime import date, datetime
from decimal import Decimal

# H-VAL-4: sanity bounds for date fields
_MIN_DATE = date(1990, 1, 1)
_MAX_DATE = date(2100, 12, 31)


def _validate_date_range(v: Optional[date]) -> Optional[date]:
    if v is not None and not (_MIN_DATE <= v <= _MAX_DATE):
        raise ValueError(f"Date {v} is outside allowed range 1990-01-01 to 2100-12-31")
    return v


class ContactBrief(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    city: Optional[str] = None

    class Config:
        from_attributes = True


class LoanCreate(BaseModel):
    contact_id: int
    # H-FIN-20: constrain to known enum values to prevent silent direction/type bugs
    loan_direction: Literal["given", "taken"]
    loan_type: Literal["emi", "interest_only", "short_term"]
    # H-FIN-19: principal must be positive
    principal_amount: Decimal = Field(..., gt=0)
    disbursed_date: date
    # H-FIN-18: rate must be non-negative
    interest_rate: Optional[Decimal] = Field(default=None, ge=0, le=999)
    interest_start_date: Optional[date] = None
    interest_free_till: Optional[date] = None
    post_due_interest_rate: Optional[Decimal] = Field(default=None, ge=0, le=999)
    emi_amount: Optional[Decimal] = Field(default=None, gt=0)
    tenure_months: Optional[int] = Field(default=None, ge=1, le=600)
    emi_day_of_month: Optional[int] = Field(default=None, ge=1, le=28)
    penalty_per_day: Optional[Decimal] = Field(default=None, ge=0)
    capitalization_enabled: bool = False
    capitalization_after_months: Optional[int] = Field(default=None, ge=1)
    institution_name: Optional[str] = Field(default=None, max_length=255)
    institution_loan_id: Optional[str] = Field(default=None, max_length=255)
    expected_end_date: Optional[date] = None
    account_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=2000)
    interest_calc_method: str = 'commercial'  # 'commercial' | 'banking_365'

    # H-VAL-4: reject dates outside 1990-2100
    @field_validator("disbursed_date", "interest_start_date", "interest_free_till", "expected_end_date", mode="before")
    @classmethod
    def validate_dates(cls, v):
        return _validate_date_range(v if isinstance(v, date) else (date.fromisoformat(v) if v else v))


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
    penalty_per_day: Optional[Decimal] = None
    capitalization_enabled: Optional[bool] = None
    capitalization_after_months: Optional[int] = None
    institution_name: Optional[str] = Field(default=None, max_length=255)
    institution_loan_id: Optional[str] = Field(default=None, max_length=255)
    status: Optional[str] = None
    expected_end_date: Optional[date] = None
    actual_end_date: Optional[date] = None
    account_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=2000)
    interest_calc_method: Optional[str] = None  # 'commercial' | 'banking_365'


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
    penalty_per_day: Optional[Decimal] = None
    capitalization_enabled: bool
    capitalization_after_months: Optional[int]
    last_capitalization_date: Optional[date]
    institution_name: Optional[str]
    institution_loan_id: Optional[str]
    status: str
    expected_end_date: Optional[date]
    actual_end_date: Optional[date]
    account_id: Optional[int] = None
    write_off_amount: Optional[Decimal] = None
    notes: Optional[str]
    interest_calc_method: str = 'commercial'
    is_deleted: Optional[bool] = None
    created_at: datetime
    updated_at: datetime
    contact: Optional[ContactBrief] = None

    class Config:
        from_attributes = True


class LoanPaymentCreate(BaseModel):
    payment_date: date
    # C-FIN-4: payment amount must be positive
    amount_paid: Decimal = Field(..., gt=0)
    # C-FIN-4: penalty must be non-negative
    penalty_paid: Optional[Decimal] = Field(default=Decimal("0"), ge=0)
    payment_mode: Optional[str] = Field(default=None, max_length=100)
    collected_by: Optional[str] = Field(default=None, max_length=255)
    reference_number: Optional[str] = Field(default=None, max_length=255)
    account_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class LoanPaymentOut(BaseModel):
    id: int
    loan_id: int
    payment_date: date
    amount_paid: Decimal
    penalty_paid: Optional[Decimal] = Decimal("0")
    allocated_to_overdue_interest: Decimal
    allocated_to_current_interest: Decimal
    allocated_to_principal: Decimal
    payment_mode: Optional[str]
    collected_by: Optional[str]
    reference_number: Optional[str]
    account_id: Optional[int] = None
    notes: Optional[str]
    is_voided: bool = False
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
