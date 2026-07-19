"""Assets business logic + the module's PUBLIC INTERFACE.

`assets_summary(db)` is the only thing other modules (dashboard, analytics /
net worth) may call. It takes just a Session — tenant scoping comes from the
session's tenant context (app/tenancy.py), so the interface needs no user
argument and returns plain dicts, never ORM objects. When assets becomes a
standalone service this function body turns into an HTTP call.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules_pkg.assets.models import Asset

_COMPOUNDS_PER_YEAR = {"monthly": 12, "quarterly": 4, "half_yearly": 2, "yearly": 1}


def _d(v) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


# ---------------------------------------------------------------------------
# Deposit projections
# ---------------------------------------------------------------------------

def fd_maturity_value(principal: Decimal, annual_rate_pct: Decimal,
                      start: date, maturity: date,
                      compounding: str = "quarterly") -> Decimal:
    """Compound-interest FD projection: A = P * (1 + r/n)^(n*t)."""
    n = _COMPOUNDS_PER_YEAR.get(compounding, 4)
    t_years = Decimal((maturity - start).days) / Decimal(365)
    if t_years <= 0:
        return principal
    rate = _d(annual_rate_pct) / Decimal(100)
    amount = _d(principal) * (
        (Decimal(1) + rate / n) ** int(n * t_years)
    )
    return amount.quantize(Decimal("0.01"))


def rd_maturity_value(monthly_installment: Decimal, annual_rate_pct: Decimal,
                      start: date, maturity: date) -> Decimal:
    """RD projection with monthly compounding:
    M = R * [((1+i)^n - 1) / i] * (1+i), i = r/12, n = months."""
    months = max(0, (maturity.year - start.year) * 12 + (maturity.month - start.month))
    if months == 0:
        return Decimal("0")
    i = _d(annual_rate_pct) / Decimal(100) / Decimal(12)
    r = _d(monthly_installment)
    if i == 0:
        return (r * months).quantize(Decimal("0.01"))
    factor = ((Decimal(1) + i) ** months - Decimal(1)) / i * (Decimal(1) + i)
    return (r * factor).quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# Serialization enrichment (computed fields on AssetOut)
# ---------------------------------------------------------------------------

def enrich(asset: Asset) -> dict:
    """Computed extras for one asset: deposit projection + purchase gain."""
    out = {}
    if asset.asset_type in ("fixed_deposit", "recurring_deposit") and \
            asset.interest_rate is not None and asset.start_date and asset.maturity_date:
        if asset.asset_type == "fixed_deposit":
            base = _d(asset.purchase_price) or _d(asset.current_value)
            out["projected_maturity_value"] = fd_maturity_value(
                base, asset.interest_rate, asset.start_date, asset.maturity_date,
                asset.compounding or "quarterly",
            )
        elif asset.monthly_installment is not None:
            out["projected_maturity_value"] = rd_maturity_value(
                asset.monthly_installment, asset.interest_rate,
                asset.start_date, asset.maturity_date,
            )
        out["days_to_maturity"] = (asset.maturity_date - date.today()).days

    if asset.purchase_price and _d(asset.purchase_price) > 0:
        gain = _d(asset.current_value) - _d(asset.purchase_price)
        out["gain"] = gain.quantize(Decimal("0.01"))
        out["gain_pct"] = (gain / _d(asset.purchase_price) * 100).quantize(Decimal("0.01"))
    return out


# ---------------------------------------------------------------------------
# Gold valuation
# ---------------------------------------------------------------------------

async def refresh_gold_value(asset: Asset) -> bool:
    """Recompute current_value of a gold asset from the live rate.
    Returns False when the rate is unavailable or the asset lacks
    quantity/carat — caller decides how to report that."""
    from app.services.gold_price import calculate_gold_value, fetch_live_gold_rate_per_gram_inr

    if asset.asset_type != "gold" or not asset.quantity or not asset.gold_carat:
        return False
    rate = await fetch_live_gold_rate_per_gram_inr()
    if rate is None:
        return False
    asset.current_value = calculate_gold_value(asset.gold_carat, _d(asset.quantity), rate)
    asset.auto_valuation = True
    asset.value_updated_at = datetime.now(timezone.utc)
    return True


# ---------------------------------------------------------------------------
# PUBLIC INTERFACE for other modules
# ---------------------------------------------------------------------------

def assets_summary(db: Session) -> dict:
    """Aggregate view for net worth / dashboards.

    Tenant scoping is implicit (session tenant context). Returns plain data:
      {"total": Decimal, "count": int,
       "by_type": {type: {"total": Decimal, "count": int}},
       "items": [{"id", "name", "asset_type", "current_value"}, ...]}
    """
    rows = (
        db.query(Asset)
        .filter(Asset.is_deleted == False)
        .order_by(Asset.current_value.desc())
        .all()
    )
    by_type: dict = {}
    total = Decimal("0")
    items = []
    for a in rows:
        val = _d(a.current_value)
        total += val
        bucket = by_type.setdefault(a.asset_type, {"total": Decimal("0"), "count": 0})
        bucket["total"] += val
        bucket["count"] += 1
        items.append({
            "id": a.id, "name": a.name,
            "asset_type": a.asset_type, "current_value": float(val),
        })
    return {"total": total, "count": len(rows), "by_type": by_type, "items": items}
