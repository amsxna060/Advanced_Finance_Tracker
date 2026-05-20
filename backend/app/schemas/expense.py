from pydantic import BaseModel, AnyHttpUrl, field_validator, Field
from typing import Optional
from datetime import date, datetime
from decimal import Decimal

# H-VAL-4: reject dates outside reasonable range
_MIN_DATE = date(1990, 1, 1)
_MAX_DATE = date(2100, 12, 31)


class ExpenseCreate(BaseModel):
    category: Optional[str] = Field(default=None, max_length=100)
    sub_category: Optional[str] = Field(default=None, max_length=100)
    amount: Decimal = Field(..., gt=0)
    expense_date: date
    linked_type: Optional[str] = Field(default=None, max_length=50)
    linked_id: Optional[int] = None
    description: Optional[str] = Field(default=None, max_length=500)
    payment_mode: Optional[str] = Field(default=None, max_length=50)
    # C-VAL-1: restrict to http/https URLs to prevent javascript: XSS injection
    receipt_url: Optional[str] = None
    account_id: Optional[int] = None
    is_recurring: Optional[bool] = False
    recurring_till: Optional[date] = None

    @field_validator("receipt_url")
    @classmethod
    def validate_receipt_url(cls, v):
        if v is None:
            return v
        if not v.startswith(("http://", "https://")):
            raise ValueError("receipt_url must start with http:// or https://")
        return v

    @field_validator("expense_date", mode="before")
    @classmethod
    def validate_expense_date(cls, v):
        d = v if isinstance(v, date) else (date.fromisoformat(v) if v else v)
        if d is not None and not (_MIN_DATE <= d <= _MAX_DATE):
            raise ValueError(f"expense_date {d} is outside allowed range 1990-01-01 to 2100-12-31")
        return d


class ExpenseUpdate(BaseModel):
    category: Optional[str] = Field(default=None, max_length=100)
    sub_category: Optional[str] = Field(default=None, max_length=100)
    amount: Optional[Decimal] = None
    expense_date: Optional[date] = None
    linked_type: Optional[str] = Field(default=None, max_length=50)
    linked_id: Optional[int] = None
    description: Optional[str] = Field(default=None, max_length=500)
    payment_mode: Optional[str] = Field(default=None, max_length=50)
    # C-VAL-1: restrict to http/https URLs
    receipt_url: Optional[str] = None
    # H-DI-12: account_id was missing from ExpenseUpdate, making it impossible to change
    account_id: Optional[int] = None
    is_recurring: Optional[bool] = None
    recurring_till: Optional[date] = None

    @field_validator("receipt_url")
    @classmethod
    def validate_receipt_url(cls, v):
        if v is None:
            return v
        if not v.startswith(("http://", "https://")):
            raise ValueError("receipt_url must start with http:// or https://")
        return v


class ExpenseOut(BaseModel):
    id: int
    category: Optional[str]
    sub_category: Optional[str] = None
    amount: Decimal
    expense_date: date
    linked_type: Optional[str]
    linked_id: Optional[int]
    description: Optional[str]
    payment_mode: Optional[str]
    receipt_url: Optional[str]
    account_id: Optional[int] = None
    is_recurring: Optional[bool] = False
    recurring_till: Optional[date] = None
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
