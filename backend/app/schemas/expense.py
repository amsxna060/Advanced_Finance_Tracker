from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class ExpenseCreate(BaseModel):
    category: Optional[str] = None
    amount: Decimal
    expense_date: date
    linked_type: Optional[str] = None
    linked_id: Optional[int] = None
    description: Optional[str] = None
    payment_mode: Optional[str] = None
    receipt_url: Optional[str] = None
    account_id: Optional[int] = None


class ExpenseUpdate(BaseModel):
    category: Optional[str] = None
    amount: Optional[Decimal] = None
    expense_date: Optional[date] = None
    linked_type: Optional[str] = None
    linked_id: Optional[int] = None
    description: Optional[str] = None
    payment_mode: Optional[str] = None
    receipt_url: Optional[str] = None


class ExpenseOut(BaseModel):
    id: int
    category: Optional[str]
    amount: Decimal
    expense_date: date
    linked_type: Optional[str]
    linked_id: Optional[int]
    description: Optional[str]
    payment_mode: Optional[str]
    receipt_url: Optional[str]
    account_id: Optional[int] = None
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
