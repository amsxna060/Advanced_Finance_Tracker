from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date
from decimal import Decimal


class CollateralCreate(BaseModel):
    loan_id: int
    collateral_type: str
    description: Optional[str] = None
    estimated_value: Optional[Decimal] = None
    warning_threshold_pct: Decimal = Decimal("75.0")
    gold_carat: Optional[int] = None
    gold_weight_grams: Optional[Decimal] = None
    gold_manual_rate: Optional[Decimal] = None
    gold_use_manual_rate: bool = False
    photo_url: Optional[str] = None
    notes: Optional[str] = None


class CollateralUpdate(BaseModel):
    collateral_type: Optional[str] = None
    description: Optional[str] = None
    estimated_value: Optional[Decimal] = None
    warning_threshold_pct: Optional[Decimal] = None
    gold_carat: Optional[int] = None
    gold_weight_grams: Optional[Decimal] = None
    gold_manual_rate: Optional[Decimal] = None
    gold_use_manual_rate: Optional[bool] = None
    photo_url: Optional[str] = None
    notes: Optional[str] = None


class CollateralOut(BaseModel):
    id: int
    loan_id: int
    collateral_type: str
    description: Optional[str]
    estimated_value: Optional[Decimal]
    warning_threshold_pct: Decimal
    gold_carat: Optional[int]
    gold_weight_grams: Optional[Decimal]
    gold_calculated_rate: Optional[Decimal]
    gold_manual_rate: Optional[Decimal]
    gold_use_manual_rate: bool
    gold_rate_fetched_at: Optional[datetime]
    photo_url: Optional[str]
    photo_uploaded_at: Optional[datetime]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class GoldRateResponse(BaseModel):
    price_per_gram: Optional[Decimal]
    calculated_value: Optional[Decimal]
    manual_value: Optional[Decimal]
    use_manual: bool
    fetched_at: Optional[datetime]
