"""
/api/forecast — entity-grouped cash-flow projection with persisted overrides.

Endpoints
---------
GET  /api/forecast?timeframe=30d            → 15d|30d|60d|90d preset
GET  /api/forecast?days=35                  → custom day count
GET  /api/forecast?from_date=&to_date=      → custom date range
GET  /api/forecast?to_month_end=true        → window ends on last day of current month

POST /api/forecast/overrides                → upsert (included / amount_override)
POST /api/forecast/overrides/fulfill        → mark item fulfilled in current period
POST /api/forecast/overrides/clear          → remove an override
GET  /api/forecast/overrides                → list overrides for current period
"""
from datetime import date, timedelta
from calendar import monthrange
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.forecast_override import ForecastOverride
from app.schemas.forecast import (
    ForecastOverrideUpsert,
    ForecastFulfillIn,
    ForecastClearIn,
    ForecastOverrideOut,
)
from app.services.forecast_engine import build_forecast, current_period_key

router = APIRouter(prefix="/api/forecast", tags=["forecast"])

_PRESETS = {"15d": 15, "30d": 30, "60d": 60, "90d": 90}


def _resolve_window(
    timeframe: Optional[str],
    days: Optional[int],
    from_date: Optional[str],
    to_date: Optional[str],
    to_month_end: bool,
) -> tuple[date, date]:
    """Resolve [from_date, to_date] from any combination of inputs."""
    today = date.today()

    # Explicit date range wins
    if from_date or to_date:
        try:
            f = date.fromisoformat(from_date) if from_date else today
            t = date.fromisoformat(to_date) if to_date else None
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
        if t is None:
            t = f + timedelta(days=30)
        if t < f:
            raise HTTPException(status_code=400, detail="to_date must be on/after from_date")
        return f, t

    # Month-end shortcut
    if to_month_end:
        last_day = monthrange(today.year, today.month)[1]
        return today, date(today.year, today.month, last_day)

    # Custom day count
    if days is not None:
        if days < 1 or days > 365 * 2:
            raise HTTPException(status_code=400, detail="days must be between 1 and 730")
        return today, today + timedelta(days=days)

    # Preset
    n = _PRESETS.get((timeframe or "30d").lower(), 30)
    return today, today + timedelta(days=n)


@router.get("")
def get_forecast(
    timeframe: Optional[str] = Query(None, description="15d|30d|60d|90d"),
    days: Optional[int] = Query(None, description="Custom day count"),
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_month_end: bool = Query(False),
    account_ids: Optional[List[int]] = Query(None, description="Filter to specific account IDs"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f, t = _resolve_window(timeframe, days, from_date, to_date, to_month_end)
    return build_forecast(db, current_user.id, f, t, account_ids=account_ids or None)


# ─────────────────────────────────────────────────────────────────────────────
# Override endpoints
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_period_key(supplied: Optional[str]) -> str:
    if supplied and len(supplied) == 7 and supplied[4] == "-":
        return supplied
    return current_period_key()


def _get_or_create_override(
    db: Session, user_id: int, item_id: str, period_key: str,
) -> ForecastOverride:
    # H-CONC-3: Use PostgreSQL INSERT ... ON CONFLICT DO NOTHING to avoid
    # a read-then-write race that can create duplicate rows.
    # Raw SQL bypasses the automatic tenant stamping (app/tenancy.py), so
    # owner_id must be set explicitly here.
    db.execute(
        text(
            "INSERT INTO forecast_overrides (user_id, item_id, period_key, included, status, owner_id) "
            "VALUES (:uid, :iid, :pk, true, 'pending', :owner) "
            "ON CONFLICT (user_id, item_id, period_key) DO NOTHING"
        ),
        {"uid": user_id, "iid": item_id, "pk": period_key,
         "owner": db.info.get("tenant_id") or user_id},
    )
    ov = (
        db.query(ForecastOverride)
        .filter(
            ForecastOverride.user_id == user_id,
            ForecastOverride.item_id == item_id,
            ForecastOverride.period_key == period_key,
        )
        .first()
    )
    if ov is None:
        # Fallback: should not reach here after the upsert, but guard anyway
        ov = ForecastOverride(
            user_id=user_id,
            item_id=item_id,
            period_key=period_key,
            included=True,
            status="pending",
        )
        db.add(ov)
    return ov


@router.post("/overrides", response_model=ForecastOverrideOut)
def upsert_override(
    body: ForecastOverrideUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_key = _resolve_period_key(body.period_key)
    ov = _get_or_create_override(db, current_user.id, body.item_id, period_key)

    if body.included is not None:
        ov.included = body.included
        # toggling off without explicit fulfilled → mark skipped, on → reset to pending
        if body.included is False and ov.status not in ("fulfilled",):
            ov.status = "skipped"
        elif body.included is True and ov.status == "skipped":
            ov.status = "pending"
    if body.amount_override is not None:
        ov.amount_override = body.amount_override
    if body.notes is not None:
        ov.notes = body.notes

    db.commit()
    db.refresh(ov)
    return ov


@router.post("/overrides/fulfill", response_model=ForecastOverrideOut)
def fulfill_override(
    body: ForecastFulfillIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_key = _resolve_period_key(body.period_key)
    ov = _get_or_create_override(db, current_user.id, body.item_id, period_key)
    ov.status = "fulfilled"
    ov.fulfilled_amount = body.fulfilled_amount
    ov.fulfilled_at = body.fulfilled_at or date.today()
    if body.notes is not None:
        ov.notes = body.notes
    ov.included = True  # fulfilled implies it counted (under fulfilled bucket)
    db.commit()
    db.refresh(ov)
    return ov


@router.post("/overrides/clear")
def clear_override(
    body: ForecastClearIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_key = _resolve_period_key(body.period_key)
    deleted = (
        db.query(ForecastOverride)
        .filter(
            ForecastOverride.user_id == current_user.id,
            ForecastOverride.item_id == body.item_id,
            ForecastOverride.period_key == period_key,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


@router.get("/overrides", response_model=List[ForecastOverrideOut])
def list_overrides(
    period_key: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pk = _resolve_period_key(period_key)
    return (
        db.query(ForecastOverride)
        .filter(ForecastOverride.user_id == current_user.id, ForecastOverride.period_key == pk)
        .order_by(ForecastOverride.updated_at.desc())
        .all()
    )
