"""
Categories router — hierarchical expense categories.

Endpoints:
  GET  /api/categories          – list all categories (flat or tree)
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.category import Category
from app.models.user import User

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("")
def list_categories(
    tree: bool = Query(False, description="Return nested tree structure"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cats = db.query(Category).filter(Category.is_active == True).order_by(Category.sort_order).all()

    if not tree:
        return [
            {
                "id": c.id,
                "name": c.name,
                "parent_id": c.parent_id,
                "icon": c.icon,
                "sort_order": c.sort_order,
            }
            for c in cats
        ]

    # Build tree
    by_id = {}
    roots = []
    for c in cats:
        node = {
            "id": c.id,
            "name": c.name,
            "icon": c.icon,
            "sort_order": c.sort_order,
            "children": [],
        }
        by_id[c.id] = node

    for c in cats:
        node = by_id[c.id]
        if c.parent_id and c.parent_id in by_id:
            by_id[c.parent_id]["children"].append(node)
        elif not c.parent_id:
            roots.append(node)

    return roots


@router.post("")
def create_category(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new category (parent_id=None) or sub-category (parent_id=<id>).
    Returns the existing record if the same name+parent already exists.
    """
    name = (payload.get("name") or "").strip()
    parent_id = payload.get("parent_id") or None
    icon = (payload.get("icon") or "💰").strip()

    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    # Return existing to prevent duplicates
    existing = (
        db.query(Category)
        .filter(Category.name == name, Category.parent_id == parent_id, Category.is_active == True)
        .first()
    )
    if existing:
        return {
            "id": existing.id, "name": existing.name,
            "parent_id": existing.parent_id, "icon": existing.icon,
            "already_existed": True,
        }

    cat = Category(name=name, parent_id=parent_id, icon=icon, is_active=True, sort_order=999)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return {
        "id": cat.id, "name": cat.name,
        "parent_id": cat.parent_id, "icon": cat.icon,
        "already_existed": False,
    }
