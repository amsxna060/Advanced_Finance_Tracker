from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import date, datetime
from decimal import Decimal


class ForecastOverrideUpsert(BaseModel):
    """Upsert (set/update) toggle + amount override for an item in a period."""
    item_id: str
    period_key: Optional[str] = None  # default = current month server-side
    included: Optional[bool] = None
    amount_override: Optional[Decimal] = None
    notes: Optional[str] = None


class ForecastFulfillIn(BaseModel):
    """Mark an item as fulfilled in a period."""
    item_id: str
    period_key: Optional[str] = None
    fulfilled_amount: Decimal
    fulfilled_at: Optional[date] = None
    notes: Optional[str] = None


class ForecastClearIn(BaseModel):
    """Remove an override (resets the item to engine defaults for that period)."""
    item_id: str
    period_key: Optional[str] = None


class ForecastOverrideOut(BaseModel):
    id: int
    item_id: str
    period_key: str
    included: bool
    amount_override: Optional[Decimal] = None
    status: str
    fulfilled_amount: Optional[Decimal] = None
    fulfilled_at: Optional[date] = None
    notes: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True
