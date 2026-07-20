"""Assets CRUD + valuation endpoints.

  GET    /api/assets                  – list (enriched)
  GET    /api/assets/summary          – aggregate (same shape other modules use)
  POST   /api/assets                  – create
  GET    /api/assets/{id}             – detail (enriched)
  PUT    /api/assets/{id}             – partial update
  DELETE /api/assets/{id}             – soft delete
  POST   /api/assets/{id}/refresh-value – gold: recompute from live rate
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_module, require_write_access
from app.models.user import User
from app.modules_pkg.assets.models import Asset
from app.modules_pkg.assets.schemas import AssetCreate, AssetOut, AssetUpdate
from app.modules_pkg.assets.service import assets_summary, enrich, refresh_gold_value

router = APIRouter(prefix="/api/assets", tags=["assets"],
                   dependencies=[Depends(require_module("assets"))])


def _get_or_404(asset_id: int, db: Session) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.is_deleted == False).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _out(asset: Asset) -> AssetOut:
    out = AssetOut.model_validate(asset)
    for key, value in enrich(asset).items():
        setattr(out, key, value)
    return out


@router.get("/gold-rate")
async def gold_rate(current_user: User = Depends(get_current_user)):
    """Current live 24k gold rate (₹/gram) — lets the UI show live wealth."""
    from app.services.gold_price import fetch_live_gold_rate_per_gram_inr
    rate = await fetch_live_gold_rate_per_gram_inr()
    return {"rate_per_gram_24k": float(rate) if rate is not None else None}


@router.post("/refresh-gold")
async def refresh_my_gold(db: Session = Depends(get_db),
                          current_user: User = Depends(require_write_access)):
    """Revalue ALL of the caller's gold — assets and loan collateral — from
    the live rate in one shot."""
    from app.services.gold_revaluation import revalue_tenant_gold
    result = await revalue_tenant_gold(db)
    if not result["ok"]:
        raise HTTPException(status_code=503, detail="Live gold rate unavailable — try again later")
    return result


@router.get("", response_model=List[AssetOut])
def list_assets(db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    rows = (
        db.query(Asset)
        .filter(Asset.is_deleted == False)
        .order_by(Asset.current_value.desc())
        .all()
    )
    return [_out(a) for a in rows]


@router.get("/summary")
def get_summary(db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    s = assets_summary(db)
    return {
        "total": float(s["total"]),
        "count": s["count"],
        "by_type": {k: {"total": float(v["total"]), "count": v["count"]}
                    for k, v in s["by_type"].items()},
        "items": s["items"],
    }


@router.post("", response_model=AssetOut)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db),
                 current_user: User = Depends(require_write_access)):
    asset = Asset(**payload.model_dump(), created_by=current_user.id)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _out(asset)


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user)):
    return _out(_get_or_404(asset_id, db))


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, payload: AssetUpdate,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(require_write_access)):
    asset = _get_or_404(asset_id, db)
    changes = payload.model_dump(exclude_unset=True)
    if "current_value" in changes:
        # A manual value overrides any previous auto valuation
        asset.auto_valuation = False
    for field, value in changes.items():
        setattr(asset, field, value)
    db.commit()
    db.refresh(asset)
    return _out(asset)


@router.delete("/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db),
                 current_user: User = Depends(require_write_access)):
    asset = _get_or_404(asset_id, db)
    asset.is_deleted = True
    db.commit()
    return {"message": "Asset deleted", "id": asset_id}


@router.post("/{asset_id}/refresh-value", response_model=AssetOut)
async def refresh_value(asset_id: int, db: Session = Depends(get_db),
                        current_user: User = Depends(require_write_access)):
    asset = _get_or_404(asset_id, db)
    if asset.asset_type != "gold":
        raise HTTPException(status_code=400,
                            detail="Auto valuation is only available for gold assets")
    if not asset.quantity or not asset.gold_carat:
        raise HTTPException(status_code=400,
                            detail="Set quantity (grams) and gold_carat to use auto valuation")
    ok = await refresh_gold_value(asset)
    if not ok:
        raise HTTPException(status_code=503,
                            detail="Live gold rate unavailable — try again later")
    db.commit()
    db.refresh(asset)
    return _out(asset)
