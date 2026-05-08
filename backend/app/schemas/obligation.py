from pydantic import BaseModel, Field
from typing import Literal, Optional, List
from datetime import date, datetime
from decimal import Decimal


class ObligationCreate(BaseModel):
    # M-VAL-8: constrain obligation_type to known values at schema level
    obligation_type: Literal["receivable", "payable"]
    contact_id: int
    amount: Decimal = Field(..., gt=0)
    reason: Optional[str] = Field(default=None, max_length=500)
    linked_type: Optional[str] = None
    linked_id: Optional[int] = None
    due_date: Optional[date] = None
    account_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class ObligationUpdate(BaseModel):
    amount: Optional[Decimal] = None
    reason: Optional[str] = None
    due_date: Optional[date] = None
    notes: Optional[str] = None
    status: Optional[str] = None


class ObligationOut(BaseModel):
    id: int
    obligation_type: str
    contact_id: Optional[int] = None
    amount: Decimal
    amount_settled: Decimal
    reason: Optional[str]
    linked_type: Optional[str]
    linked_id: Optional[int]
    due_date: Optional[date]
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SettlementCreate(BaseModel):
    amount: Decimal
    settlement_date: date
    payment_mode: Optional[str] = None
    account_id: Optional[int] = None
    notes: Optional[str] = None


class SettlementOut(BaseModel):
    id: int
    obligation_id: int
    amount: Decimal
    settlement_date: date
    payment_mode: Optional[str]
    account_id: Optional[int]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
