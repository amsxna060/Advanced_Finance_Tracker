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
            "rollover_enabled": cl.rollover_enabled,
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
    rollover_enabled = bool(payload.get("rollover_enabled", False))

    if not category:
        raise HTTPException(status_code=422, detail="category is required")
    if monthly_limit is None or Decimal(str(monthly_limit)) <= 0:
        raise HTTPException(status_code=422, detail="monthly_limit must be > 0")

    existing = db.query(CategoryLimit).filter(CategoryLimit.category == category).first()
    if existing:
        existing.monthly_limit = Decimal(str(monthly_limit))
        existing.rollover_enabled = rollover_enabled
        db.commit()
        db.refresh(existing)
        return {"id": existing.id, "category": existing.category, "monthly_limit": Decimal(str(existing.monthly_limit)), "rollover_enabled": existing.rollover_enabled}

    cl = CategoryLimit(
        category=category,
        monthly_limit=Decimal(str(monthly_limit)),
        rollover_enabled=rollover_enabled,
        created_by=current_user.id,
    )
    db.add(cl)
    db.commit()
    db.refresh(cl)
    return {"id": cl.id, "category": cl.category, "monthly_limit": Decimal(str(cl.monthly_limit)), "rollover_enabled": cl.rollover_enabled}


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


@router.get("/rollover-preview")
def rollover_preview(
    month: Optional[str] = Query(None, description="Target month YYYY-MM (defaults to next month)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    For each category with rollover_enabled=True, computes the effective budget
    for the target month by carrying over unspent surplus from the previous month.
    Overspend is NOT carried forward (rollover only adds surplus, never penalty).
    """
    today = date.today()
    if month:
        t_year, t_mon = int(month.split("-")[0]), int(month.split("-")[1])
    else:
        # Default: next month
        if today.month == 12:
            t_year, t_mon = today.year + 1, 1
        else:
            t_year, t_mon = today.year, today.month + 1

    # Previous month
    if t_mon == 1:
        p_year, p_mon = t_year - 1, 12
    else:
        p_year, p_mon = t_year, t_mon - 1

    p_from = date(p_year, p_mon, 1)
    if p_mon == 12:
        p_to = date(p_year + 1, 1, 1)
    else:
        p_to = date(p_year, p_mon + 1, 1)

    limits = db.query(CategoryLimit).filter(CategoryLimit.rollover_enabled == True).all()
    if not limits:
        return {"month": f"{t_year}-{t_mon:02d}", "rollover_items": []}

    # Get actual spend per category in previous month
    prev_expenses = (
        db.query(Expense)
        .filter(Expense.expense_date >= p_from, Expense.expense_date < p_to)
        .all()
    )
    prev_actual: dict[str, Decimal] = {}
    for exp in prev_expenses:
        cat = exp.category or "Uncategorized"
        prev_actual[cat] = prev_actual.get(cat, Decimal("0")) + Decimal(str(exp.amount or 0))

    rollover_items = []
    for cl in limits:
        base_budget = Decimal(str(cl.monthly_limit))
        prev_spent = prev_actual.get(cl.category, Decimal("0"))
        surplus = max(base_budget - prev_spent, Decimal("0"))
        effective = base_budget + surplus
        rollover_items.append({
            "category": cl.category,
            "base_budget": float(base_budget),
            "prev_month_spent": float(prev_spent),
            "surplus_carried": float(surplus),
            "effective_budget": float(effective),
        })

    return {
        "month": f"{t_year}-{t_mon:02d}",
        "prev_month": f"{p_year}-{p_mon:02d}",
        "rollover_items": rollover_items,
    }
