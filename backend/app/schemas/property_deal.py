from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class PropertyDealCreate(BaseModel):
    title: str
    location: Optional[str] = None
    property_type: Optional[str] = None
    total_area_sqft: Optional[Decimal] = None
    deal_type: str = "middleman"
    seller_contact_id: Optional[int] = None
    buyer_contact_id: Optional[int] = None
    seller_rate_per_sqft: Optional[Decimal] = None
    buyer_rate_per_sqft: Optional[Decimal] = None
    total_seller_value: Optional[Decimal] = None
    total_buyer_value: Optional[Decimal] = None
    advance_paid: Decimal = Decimal("0")
    advance_date: Optional[date] = None
    deal_locked_date: Optional[date] = None
    expected_registry_date: Optional[date] = None
    broker_name: Optional[str] = None
    broker_commission: Decimal = Decimal("0")
    gross_profit: Optional[Decimal] = None
    net_profit: Optional[Decimal] = None
    purchase_price: Optional[Decimal] = None
    holding_cost: Decimal = Decimal("0")
    sale_price: Optional[Decimal] = None
    sale_date: Optional[date] = None
    notes: Optional[str] = None


class PropertyDealUpdate(BaseModel):
    title: Optional[str] = None
    location: Optional[str] = None
    property_type: Optional[str] = None
    total_area_sqft: Optional[Decimal] = None
    deal_type: Optional[str] = None
    seller_contact_id: Optional[int] = None
    buyer_contact_id: Optional[int] = None
    seller_rate_per_sqft: Optional[Decimal] = None
    buyer_rate_per_sqft: Optional[Decimal] = None
    total_seller_value: Optional[Decimal] = None
    total_buyer_value: Optional[Decimal] = None
    advance_paid: Optional[Decimal] = None
    advance_date: Optional[date] = None
    deal_locked_date: Optional[date] = None
    expected_registry_date: Optional[date] = None
    actual_registry_date: Optional[date] = None
    broker_name: Optional[str] = None
    broker_commission: Optional[Decimal] = None
    gross_profit: Optional[Decimal] = None
    net_profit: Optional[Decimal] = None
    purchase_price: Optional[Decimal] = None
    holding_cost: Optional[Decimal] = None
    sale_price: Optional[Decimal] = None
    sale_date: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class PropertyDealOut(BaseModel):
    id: int
    title: str
    location: Optional[str]
    property_type: Optional[str]
    total_area_sqft: Optional[Decimal]
    deal_type: str
    seller_contact_id: Optional[int]
    buyer_contact_id: Optional[int]
    seller_rate_per_sqft: Optional[Decimal]
    buyer_rate_per_sqft: Optional[Decimal]
    total_seller_value: Optional[Decimal]
    total_buyer_value: Optional[Decimal]
    advance_paid: Decimal
    advance_date: Optional[date]
    deal_locked_date: Optional[date]
    expected_registry_date: Optional[date]
    actual_registry_date: Optional[date]
    broker_name: Optional[str]
    broker_commission: Decimal
    gross_profit: Optional[Decimal]
    net_profit: Optional[Decimal]
    purchase_price: Optional[Decimal]
    holding_cost: Decimal
    sale_price: Optional[Decimal]
    sale_date: Optional[date]
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


class PropertyTransactionCreate(BaseModel):
    txn_type: str
    amount: Decimal
    txn_date: date
    payment_mode: Optional[str] = None
    description: Optional[str] = None


class PropertyTransactionOut(BaseModel):
    id: int
    property_deal_id: int
    txn_type: str
    amount: Decimal
    txn_date: date
    payment_mode: Optional[str]
    description: Optional[str]
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
