from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class PartnershipCreate(BaseModel):
    title: str
    linked_property_deal_id: Optional[int] = None
    total_deal_value: Optional[Decimal] = None
    our_investment: Decimal = Decimal("0")
    our_share_percentage: Optional[Decimal] = None
    total_received: Decimal = Decimal("0")
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    notes: Optional[str] = None


class PartnershipUpdate(BaseModel):
    title: Optional[str] = None
    linked_property_deal_id: Optional[int] = None
    total_deal_value: Optional[Decimal] = None
    our_investment: Optional[Decimal] = None
    our_share_percentage: Optional[Decimal] = None
    total_received: Optional[Decimal] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    actual_end_date: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class PartnershipOut(BaseModel):
    id: int
    title: str
    linked_property_deal_id: Optional[int]
    total_deal_value: Optional[Decimal]
    our_investment: Decimal
    our_share_percentage: Optional[Decimal]
    total_received: Decimal
    start_date: Optional[date]
    expected_end_date: Optional[date]
    actual_end_date: Optional[date]
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


class PartnershipMemberCreate(BaseModel):
    contact_id: Optional[int] = None
    is_self: bool = False
    share_percentage: Decimal
    advance_contributed: Decimal = Decimal("0")
    total_received: Decimal = Decimal("0")
    notes: Optional[str] = None


class PartnershipMemberOut(BaseModel):
    id: int
    partnership_id: int
    contact_id: Optional[int]
    is_self: bool
    share_percentage: Decimal
    advance_contributed: Decimal
    total_received: Decimal
    notes: Optional[str]

    class Config:
        from_attributes = True


class PartnershipTransactionCreate(BaseModel):
    member_id: Optional[int] = None
    txn_type: str
    amount: Decimal
    txn_date: date
    payment_mode: Optional[str] = None
    description: Optional[str] = None


class PartnershipTransactionOut(BaseModel):
    id: int
    partnership_id: int
    member_id: Optional[int]
    txn_type: str
    amount: Decimal
    txn_date: date
    payment_mode: Optional[str]
    description: Optional[str]
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class PartnershipSettleRequest(BaseModel):
    total_received: Optional[Decimal] = None
    actual_end_date: Optional[date] = None
    notes: Optional[str] = None
