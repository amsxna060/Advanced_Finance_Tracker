"""Revalue gold holdings from the live rate — assets and loan collateral.

Two entry points:
  - revalue_tenant_gold(db): the CURRENT tenant's gold (used by a user-facing
    "refresh gold" endpoint). Relies on the session tenant filter.
  - revalue_all_gold(db): every tenant's gold (the scheduled job). Bypasses
    the tenant filter and stamps each row's own owner.

An asset counts as auto-valued gold when asset_type='gold' with a quantity
and gold_carat. Collateral counts when collateral_type='gold' with weight +
carat and NOT gold_use_manual_rate. Both update *_value and *_fetched_at.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.collateral import Collateral
from app.modules_pkg.assets.models import Asset
from app.services.gold_price import calculate_gold_value, fetch_live_gold_rate_per_gram_inr

logger = logging.getLogger(__name__)


def _d(v) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _apply(rate: Decimal, assets, collaterals) -> int:
    now = datetime.now(timezone.utc)
    updated = 0
    for a in assets:
        if not (a.quantity and a.gold_carat):
            continue
        a.current_value = calculate_gold_value(a.gold_carat, _d(a.quantity), rate)
        a.auto_valuation = True
        a.value_updated_at = now
        updated += 1
    for c in collaterals:
        if c.gold_use_manual_rate or not (c.gold_weight_grams and c.gold_carat):
            continue
        val = calculate_gold_value(c.gold_carat, _d(c.gold_weight_grams), rate)
        c.gold_calculated_rate = val
        c.estimated_value = val
        c.gold_rate_fetched_at = now
        updated += 1
    return updated


async def revalue_tenant_gold(db: Session) -> dict:
    """Revalue the current session tenant's gold. Returns a small report."""
    rate = await fetch_live_gold_rate_per_gram_inr()
    if rate is None:
        return {"ok": False, "reason": "rate_unavailable"}
    assets = db.query(Asset).filter(Asset.asset_type == "gold", Asset.is_deleted == False).all()
    collaterals = db.query(Collateral).filter(Collateral.collateral_type == "gold").all()
    updated = _apply(rate, assets, collaterals)
    db.commit()
    return {"ok": True, "rate_per_gram_24k": float(rate), "updated": updated}


async def revalue_all_gold(db: Session) -> dict:
    """Scheduled job: revalue every tenant's gold from one rate fetch."""
    rate = await fetch_live_gold_rate_per_gram_inr()
    if rate is None:
        logger.warning("gold revaluation skipped — rate unavailable")
        return {"ok": False, "reason": "rate_unavailable"}
    assets = (
        db.query(Asset).execution_options(skip_tenant_filter=True)
        .filter(Asset.asset_type == "gold", Asset.is_deleted == False).all()
    )
    collaterals = (
        db.query(Collateral).execution_options(skip_tenant_filter=True)
        .filter(Collateral.collateral_type == "gold").all()
    )
    updated = _apply(rate, assets, collaterals)
    db.commit()
    logger.info("Gold revaluation: %d holding(s) at ₹%s/gram", updated, rate)
    return {"ok": True, "rate_per_gram_24k": float(rate), "updated": updated}
