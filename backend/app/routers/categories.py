"""
Categories router — hierarchical expense categories.

Endpoints:
  GET  /api/categories          – list all categories (flat or tree)
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
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
