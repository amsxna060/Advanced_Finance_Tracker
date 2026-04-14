from pydantic import BaseModel
from typing import Optional, Literal
from datetime import date, datetime
from decimal import Decimal


class PropertyDealCreate(BaseModel):
    title: str
    location: Optional[str] = None
    property_type: Optional[Literal["plot", "site"]] = None
    total_area_sqft: Optional[Decimal] = None
    deal_type: str = "middleman"
    seller_contact_id: Optional[int] = None
    seller_rate_per_sqft: Optional[Decimal] = None
    total_seller_value: Optional[Decimal] = None
    negotiating_date: Optional[date] = None
    expected_registry_date: Optional[date] = None
    notes: Optional[str] = None
    # Plot dimension fields (legacy)
    side_left_ft: Optional[Decimal] = None
    side_right_ft: Optional[Decimal] = None
    side_top_ft: Optional[Decimal] = None
    side_bottom_ft: Optional[Decimal] = None
    # NSEW direction fields
    side_north_ft: Optional[Decimal] = None
    side_south_ft: Optional[Decimal] = None
    side_east_ft: Optional[Decimal] = None
    side_west_ft: Optional[Decimal] = None
    # Road info
    road_count: Optional[int] = None
    roads_json: Optional[str] = None
    # Backward compat — accepted but ignored in new flow
    buyer_contact_id: Optional[int] = None
    buyer_rate_per_sqft: Optional[Decimal] = None
    total_buyer_value: Optional[Decimal] = None
    advance_paid: Decimal = Decimal("0")
    advance_date: Optional[date] = None
    deal_locked_date: Optional[date] = None
    broker_name: Optional[str] = None
    broker_commission: Decimal = Decimal("0")
    gross_profit: Optional[Decimal] = None
    net_profit: Optional[Decimal] = None
    purchase_price: Optional[Decimal] = None
    holding_cost: Decimal = Decimal("0")
    sale_price: Optional[Decimal] = None
    sale_date: Optional[date] = None
    my_investment: Optional[Decimal] = None
    my_share_percentage: Optional[Decimal] = None
    total_profit_received: Optional[Decimal] = None
    site_deal_start_date: Optional[date] = None
    site_deal_end_date: Optional[date] = None


class PropertyDealUpdate(BaseModel):
    title: Optional[str] = None
    location: Optional[str] = None
    property_type: Optional[Literal["plot", "site"]] = None
    total_area_sqft: Optional[Decimal] = None
    seller_contact_id: Optional[int] = None
    seller_rate_per_sqft: Optional[Decimal] = None
    total_seller_value: Optional[Decimal] = None
    negotiating_date: Optional[date] = None
    expected_registry_date: Optional[date] = None
    actual_registry_date: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    # Plot dimension fields (legacy)
    side_left_ft: Optional[Decimal] = None
    side_right_ft: Optional[Decimal] = None
    side_top_ft: Optional[Decimal] = None
    side_bottom_ft: Optional[Decimal] = None
    # NSEW direction fields
    side_north_ft: Optional[Decimal] = None
    side_south_ft: Optional[Decimal] = None
    side_east_ft: Optional[Decimal] = None
    side_west_ft: Optional[Decimal] = None
    # Road info
    road_count: Optional[int] = None
    roads_json: Optional[str] = None
    # Backward compat fields
    deal_type: Optional[str] = None
    buyer_contact_id: Optional[int] = None
    buyer_rate_per_sqft: Optional[Decimal] = None
    total_buyer_value: Optional[Decimal] = None
    advance_paid: Optional[Decimal] = None
    advance_date: Optional[date] = None
    deal_locked_date: Optional[date] = None
    broker_name: Optional[str] = None
    broker_commission: Optional[Decimal] = None
    gross_profit: Optional[Decimal] = None
    net_profit: Optional[Decimal] = None
    purchase_price: Optional[Decimal] = None
    holding_cost: Optional[Decimal] = None
    sale_price: Optional[Decimal] = None
    sale_date: Optional[date] = None
    my_investment: Optional[Decimal] = None
    my_share_percentage: Optional[Decimal] = None
    total_profit_received: Optional[Decimal] = None
    site_deal_start_date: Optional[date] = None
    site_deal_end_date: Optional[date] = None


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
    negotiating_date: Optional[date] = None
    deal_locked_date: Optional[date]
    expected_registry_date: Optional[date]
    actual_registry_date: Optional[date]
    broker_name: Optional[str]
    broker_commission: Decimal
    other_expenses: Optional[Decimal] = Decimal("0")
    gross_profit: Optional[Decimal]
    net_profit: Optional[Decimal]
    purchase_price: Optional[Decimal]
    holding_cost: Decimal
    sale_price: Optional[Decimal]
    sale_date: Optional[date]
    status: str
    notes: Optional[str]
    # Plot dimension fields (legacy)
    side_left_ft: Optional[Decimal]
    side_right_ft: Optional[Decimal]
    side_top_ft: Optional[Decimal]
    side_bottom_ft: Optional[Decimal]
    # NSEW direction fields
    side_north_ft: Optional[Decimal] = None
    side_south_ft: Optional[Decimal] = None
    side_east_ft: Optional[Decimal] = None
    side_west_ft: Optional[Decimal] = None
    # Road info
    road_count: Optional[int] = None
    roads_json: Optional[str] = None
    # Site-type investment fields
    my_investment: Optional[Decimal]
    my_share_percentage: Optional[Decimal]
    total_profit_received: Optional[Decimal]
    site_deal_start_date: Optional[date]
    site_deal_end_date: Optional[date]
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
    account_id: Optional[int] = None
    received_by_member_id: Optional[int] = None
    plot_buyer_id: Optional[int] = None


class PropertyTransactionUpdate(BaseModel):
    amount: Optional[Decimal] = None
    txn_date: Optional[date] = None
    account_id: Optional[int] = None
    description: Optional[str] = None
    payment_mode: Optional[str] = None
    received_by_member_id: Optional[int] = None
    plot_buyer_id: Optional[int] = None


class PropertySettleRequest(BaseModel):
    # For PLOT (middleman) settlement
    registry_date: Optional[date] = None
    buyer_rate_per_sqft: Optional[Decimal] = None
    other_expenses: Optional[Decimal] = Decimal("0")

    # For SITE settlement
    total_profit_received: Optional[Decimal] = None
    site_deal_end_date: Optional[date] = None

    # Backward compatibility
    total_buyer_value: Optional[Decimal] = None
    total_seller_value: Optional[Decimal] = None
    actual_registry_date: Optional[date] = None
    broker_commission: Optional[Decimal] = None


class PropertyTransactionOut(BaseModel):
    id: int
    property_deal_id: int
    txn_type: str
    amount: Decimal
    txn_date: date
    payment_mode: Optional[str]
    description: Optional[str]
    account_id: Optional[int] = None
    received_by_member_id: Optional[int] = None
    plot_buyer_id: Optional[int] = None
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class SitePlotCreate(BaseModel):
    plot_number: Optional[str] = None
    area_sqft: Optional[Decimal] = None
    side_north_ft: Optional[Decimal] = None
    side_south_ft: Optional[Decimal] = None
    side_east_ft: Optional[Decimal] = None
    side_west_ft: Optional[Decimal] = None
    sold_price_per_sqft: Optional[Decimal] = None
    calculated_price: Optional[Decimal] = None
    buyer_name: Optional[str] = None
    buyer_contact_id: Optional[int] = None
    status: Optional[str] = None
    advance_received: Optional[Decimal] = None
    total_paid: Optional[Decimal] = None
    registry_date: Optional[date] = None
    notes: Optional[str] = None
    sold_date: Optional[date] = None


class SitePlotOut(BaseModel):
    id: int
    property_deal_id: int
    plot_number: Optional[str]
    area_sqft: Optional[Decimal]
    side_north_ft: Optional[Decimal]
    side_south_ft: Optional[Decimal]
    side_east_ft: Optional[Decimal]
    side_west_ft: Optional[Decimal]
    sold_price_per_sqft: Optional[Decimal]
    calculated_price: Optional[Decimal]
    buyer_name: Optional[str]
    buyer_contact_id: Optional[int] = None
    status: Optional[str] = None
    advance_received: Optional[Decimal] = None
    total_paid: Optional[Decimal] = None
    registry_date: Optional[date] = None
    notes: Optional[str]
    sold_date: Optional[date]
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class PlotBuyerCreate(BaseModel):
    buyer_contact_id: Optional[int] = None
    buyer_name: Optional[str] = None
    area_sqft: Optional[Decimal] = None
    rate_per_sqft: Optional[Decimal] = None
    total_value: Optional[Decimal] = None
    notes: Optional[str] = None
    side_north_ft: Optional[Decimal] = None
    side_south_ft: Optional[Decimal] = None
    side_east_ft: Optional[Decimal] = None
    side_west_ft: Optional[Decimal] = None


class PlotBuyerUpdate(BaseModel):
    buyer_contact_id: Optional[int] = None
    buyer_name: Optional[str] = None
    area_sqft: Optional[Decimal] = None
    rate_per_sqft: Optional[Decimal] = None
    total_value: Optional[Decimal] = None
    advance_received: Optional[Decimal] = None
    total_paid: Optional[Decimal] = None
    registry_date: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    side_north_ft: Optional[Decimal] = None
    side_south_ft: Optional[Decimal] = None
    side_east_ft: Optional[Decimal] = None
    side_west_ft: Optional[Decimal] = None


class PlotBuyerOut(BaseModel):
    id: int
    property_deal_id: int
    buyer_contact_id: Optional[int]
    buyer_name: Optional[str]
    area_sqft: Optional[Decimal]
    rate_per_sqft: Optional[Decimal]
    total_value: Optional[Decimal]
    advance_received: Optional[Decimal]
    total_paid: Optional[Decimal]
    registry_date: Optional[date]
    status: Optional[str]
    notes: Optional[str]
    side_north_ft: Optional[Decimal] = None
    side_south_ft: Optional[Decimal] = None
    side_east_ft: Optional[Decimal] = None
    side_west_ft: Optional[Decimal] = None
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
