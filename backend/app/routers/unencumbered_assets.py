"""
Unencumbered Assets CRUD — standalone owned assets not linked to any loan or deal.

  GET    /api/unencumbered-assets          – list all (non-deleted)
  POST   /api/unencumbered-assets          – create
  PUT    /api/unencumbered-assets/{id}     – update
  DELETE /api/unencumbered-assets/{id}     – soft delete
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.unencumbered_asset import UnencumberedAsset
from app.models.user import User

router = APIRouter(prefix="/api/unencumbered-assets", tags=["unencumbered-assets"])

VALID_CATEGORIES = {
    "real_estate", "gold", "vehicle", "equipment",
    "business", "fixed_deposit", "other",
}


def _d(v) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _serialize(a: UnencumberedAsset) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "category": a.category,
        "estimated_value": float(_d(a.estimated_value)),
        "date_acquired": a.date_acquired.isoformat() if a.date_acquired else None,
        "notes": a.notes,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


@router.get("", response_model=list)
def list_assets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = (
        db.query(UnencumberedAsset)
        .filter(UnencumberedAsset.is_deleted == False)
        .order_by(UnencumberedAsset.estimated_value.desc())
        .all()
    )
    return [_serialize(a) for a in items]


@router.post("", response_model=dict)
def create_asset(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not payload.get("title"):
        raise HTTPException(status_code=422, detail="title is required")
    if not payload.get("estimated_value"):
        raise HTTPException(status_code=422, detail="estimated_value is required")

    category = payload.get("category", "other")
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Invalid category. Use one of: {', '.join(sorted(VALID_CATEGORIES))}")

    acquired = None
    if payload.get("date_acquired"):
        try:
            acquired = date.fromisoformat(payload["date_acquired"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date_acquired format, expected YYYY-MM-DD")

    asset = UnencumberedAsset(
        title=payload["title"],
        category=category,
        estimated_value=_d(payload["estimated_value"]),
        date_acquired=acquired,
        notes=payload.get("notes"),
        created_by=current_user.id,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _serialize(asset)


@router.put("/{asset_id}", response_model=dict)
def update_asset(
    asset_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(UnencumberedAsset).filter(
        UnencumberedAsset.id == asset_id,
        UnencumberedAsset.is_deleted == False,
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    if "title" in payload:
        asset.title = payload["title"]
    if "category" in payload:
        cat = payload["category"]
        if cat not in VALID_CATEGORIES:
            raise HTTPException(status_code=422, detail=f"Invalid category.")
        asset.category = cat
    if "estimated_value" in payload:
        asset.estimated_value = _d(payload["estimated_value"])
    if "date_acquired" in payload:
        if payload["date_acquired"]:
            try:
                asset.date_acquired = date.fromisoformat(payload["date_acquired"])
            except ValueError:
                raise HTTPException(status_code=422, detail="Invalid date_acquired format")
        else:
            asset.date_acquired = None
    if "notes" in payload:
        asset.notes = payload["notes"]

    db.commit()
    db.refresh(asset)
    return _serialize(asset)


@router.delete("/{asset_id}", response_model=dict)
def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(UnencumberedAsset).filter(
        UnencumberedAsset.id == asset_id,
        UnencumberedAsset.is_deleted == False,
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.is_deleted = True
    db.commit()
    return {"message": "Asset deleted", "id": asset_id}
