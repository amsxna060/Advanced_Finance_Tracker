from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules_pkg.assets.models import ASSET_TYPES, COMPOUNDING_OPTIONS


class AssetBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    asset_type: str = "other"
    quantity: Optional[Decimal] = Field(default=None, gt=0)
    unit: Optional[str] = Field(default=None, max_length=20)
    gold_carat: Optional[int] = None
    purchase_price: Optional[Decimal] = Field(default=None, ge=0)
    purchase_date: Optional[date] = None
    current_value: Decimal = Field(gt=0)
    interest_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    monthly_installment: Optional[Decimal] = Field(default=None, gt=0)
    start_date: Optional[date] = None
    maturity_date: Optional[date] = None
    compounding: Optional[str] = "quarterly"
    notes: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("asset_type")
    @classmethod
    def valid_type(cls, v):
        if v not in ASSET_TYPES:
            raise ValueError(f"asset_type must be one of: {', '.join(ASSET_TYPES)}")
        return v

    @field_validator("gold_carat")
    @classmethod
    def valid_carat(cls, v):
        if v is not None and v not in (18, 22, 24):
            raise ValueError("gold_carat must be 18, 22 or 24")
        return v

    @field_validator("compounding")
    @classmethod
    def valid_compounding(cls, v):
        if v is not None and v not in COMPOUNDING_OPTIONS:
            raise ValueError(f"compounding must be one of: {', '.join(COMPOUNDING_OPTIONS)}")
        return v

    @model_validator(mode="after")
    def deposit_terms_consistent(self):
        if self.asset_type == "recurring_deposit" and self.monthly_installment is None:
            raise ValueError("recurring_deposit requires monthly_installment")
        if self.maturity_date and self.start_date and self.maturity_date <= self.start_date:
            raise ValueError("maturity_date must be after start_date")
        return self


class AssetCreate(AssetBase):
    pass


class AssetUpdate(BaseModel):
    # Partial update: every field optional; validated with the same rules.
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    asset_type: Optional[str] = None
    quantity: Optional[Decimal] = Field(default=None, gt=0)
    unit: Optional[str] = Field(default=None, max_length=20)
    gold_carat: Optional[int] = None
    purchase_price: Optional[Decimal] = Field(default=None, ge=0)
    purchase_date: Optional[date] = None
    current_value: Optional[Decimal] = Field(default=None, gt=0)
    interest_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    monthly_installment: Optional[Decimal] = Field(default=None, gt=0)
    start_date: Optional[date] = None
    maturity_date: Optional[date] = None
    compounding: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=2000)

    _valid_type = field_validator("asset_type")(AssetBase.valid_type.__func__)
    _valid_carat = field_validator("gold_carat")(AssetBase.valid_carat.__func__)
    _valid_compounding = field_validator("compounding")(AssetBase.valid_compounding.__func__)


class AssetOut(BaseModel):
    id: int
    name: str
    asset_type: str
    quantity: Optional[Decimal]
    unit: Optional[str]
    gold_carat: Optional[int]
    purchase_price: Optional[Decimal]
    purchase_date: Optional[date]
    current_value: Decimal
    auto_valuation: bool
    value_updated_at: Optional[datetime]
    interest_rate: Optional[Decimal]
    monthly_installment: Optional[Decimal]
    start_date: Optional[date]
    maturity_date: Optional[date]
    compounding: Optional[str]
    notes: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    # Computed (service.enrich): deposit projection & gain
    projected_maturity_value: Optional[Decimal] = None
    days_to_maturity: Optional[int] = None
    gain: Optional[Decimal] = None
    gain_pct: Optional[Decimal] = None

    class Config:
        from_attributes = True
