"""
Category Limits router — monthly spending targets per expense category.

Endpoints:
  GET    /api/category-limits                    – list all limits
  POST   /api/category-limits                    – create or update a limit
  DELETE /api/category-limits/{category}          – remove a limit
  GET    /api/category-limits/budget-vs-actual    – compare limits vs actual spend
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.category_limit import CategoryLimit
from app.models.expense import Expense
from app.models.user import User

router = APIRouter(prefix="/api/category-limits", tags=["category-limits"])


@router.get("")
def list_category_limits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limits = db.query(CategoryLimit).order_by(CategoryLimit.category).all()
    return [
        {
            "id": cl.id,
            "category": cl.category,
            "monthly_limit": Decimal(str(cl.monthly_limit)),
        }
        for cl in limits
    ]


@router.post("")
def upsert_category_limit(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    category = (payload.get("category") or "").strip()
    monthly_limit = payload.get("monthly_limit")

    if not category:
        raise HTTPException(status_code=422, detail="category is required")
    if monthly_limit is None or Decimal(str(monthly_limit)) <= 0:
        raise HTTPException(status_code=422, detail="monthly_limit must be > 0")

    existing = db.query(CategoryLimit).filter(CategoryLimit.category == category).first()
    if existing:
        existing.monthly_limit = Decimal(str(monthly_limit))
        db.commit()
        db.refresh(existing)
        return {"id": existing.id, "category": existing.category, "monthly_limit": Decimal(str(existing.monthly_limit))}

    cl = CategoryLimit(
        category=category,
        monthly_limit=Decimal(str(monthly_limit)),
        created_by=current_user.id,
    )
    db.add(cl)
    db.commit()
    db.refresh(cl)
    return {"id": cl.id, "category": cl.category, "monthly_limit": Decimal(str(cl.monthly_limit))}


@router.delete("/{category}")
def delete_category_limit(
    category: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cl = db.query(CategoryLimit).filter(CategoryLimit.category == category).first()
    if not cl:
        raise HTTPException(status_code=404, detail="Category limit not found")
    db.delete(cl)
    db.commit()
    return {"message": f"Limit for '{category}' deleted"}


@router.get("/budget-vs-actual")
def budget_vs_actual(
    month: Optional[str] = Query(None, description="YYYY-MM format, defaults to current month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if month:
        year, mon = int(month.split("-")[0]), int(month.split("-")[1])
    else:
        today = date.today()
        year, mon = today.year, today.month

    from_date = date(year, mon, 1)
    if mon == 12:
        to_date = date(year + 1, 1, 1)
    else:
        to_date = date(year, mon + 1, 1)

    limits = db.query(CategoryLimit).all()
    limit_map = {cl.category: Decimal(str(cl.monthly_limit)) for cl in limits}

    expenses = (
        db.query(Expense)
        .filter(Expense.expense_date >= from_date, Expense.expense_date < to_date)
        .all()
    )

    actual_map: dict[str, Decimal] = {}
    for exp in expenses:
        cat = exp.category or "Uncategorized"
        actual_map[cat] = actual_map.get(cat, Decimal("0")) + Decimal(str(exp.amount or 0))

    total_budget = sum(limit_map.values())
    total_actual = sum(actual_map.values())

    categories = []
    all_cats = set(list(limit_map.keys()) + list(actual_map.keys()))
    for cat in sorted(all_cats):
        budget = limit_map.get(cat, Decimal("0"))
        actual = actual_map.get(cat, Decimal("0"))
        categories.append({
            "category": cat,
            "budget": budget,
            "actual": actual,
            "remaining": budget - actual if budget > 0 else None,
            "pct_used": float(actual / budget * 100) if budget > 0 else None,
        })

    return {
        "month": f"{year}-{mon:02d}",
        "total_budget": total_budget,
        "total_actual": total_actual,
        "pct_used": float(total_actual / total_budget * 100) if total_budget > 0 else None,
        "categories": categories,
    }
