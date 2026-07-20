import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_write_access
from app.models.expense import Expense
from app.models.user import User
from app.schemas.expense import ExpenseCreate, ExpenseOut, ExpenseUpdate
from app.services.auto_ledger import auto_ledger, reverse_all_ledger
from app.models.cash_account import AccountTransaction
from decimal import Decimal, InvalidOperation

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


# C-DI-3: Validate that linked_id points to an existing record in the correct table.
# Since linked_id is a polymorphic association (no DB-level FK), we enforce referential
# integrity at the application layer to prevent orphaned expense rows.
_LINKED_TYPE_MODELS: dict = {}  # populated lazily to avoid circular imports


def _get_linked_type_model(linked_type: str):
    if not _LINKED_TYPE_MODELS:
        from app.models.loan import Loan
        from app.models.property_deal import PropertyDeal
        from app.models.partnership import Partnership
        _LINKED_TYPE_MODELS["loan"] = Loan
        _LINKED_TYPE_MODELS["property"] = PropertyDeal
        _LINKED_TYPE_MODELS["partnership"] = Partnership
    return _LINKED_TYPE_MODELS.get(linked_type)


def _validate_linked_id(linked_type: Optional[str], linked_id: Optional[int], db: Session) -> None:
    """Raise HTTP 422 if linked_type + linked_id doesn't resolve to an existing DB row."""
    if not linked_type or not linked_id:
        return
    model = _get_linked_type_model(linked_type)
    if model is None:
        return  # "general" or unknown types have no FK to check
    exists = db.query(model.id).filter(model.id == linked_id).first()
    if not exists:
        raise HTTPException(
            status_code=422,
            detail=f"linked_id {linked_id} does not exist in table for linked_type '{linked_type}'",
        )


def _get_expense_or_404(expense_id: int, db: Session) -> Expense:
    expense = db.query(Expense).filter(Expense.id == expense_id, Expense.is_deleted == False).first()  # noqa: E712
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.get("")
def get_expenses(
    category: Optional[str] = None,
    sub_category: Optional[str] = None,
    linked_type: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    paginated: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Expense)
    # C-DI-2: exclude soft-deleted expenses
    query = query.filter(Expense.is_deleted == False)  # noqa: E712

    if category:
        query = query.filter(Expense.category == category)
    if sub_category is not None:
        # "Other" is the synthetic label for expenses with NULL sub_category
        if sub_category == "Other":
            query = query.filter(Expense.sub_category == None)  # noqa: E711
        else:
            query = query.filter(Expense.sub_category == sub_category)
    if linked_type:
        query = query.filter(Expense.linked_type == linked_type)
    if from_date:
        query = query.filter(Expense.expense_date >= from_date)
    if to_date:
        query = query.filter(Expense.expense_date <= to_date)
    if search and search.strip():
        # F2: server-side search — the list is paginated, so client-side
        # filtering only ever saw the current page. Matches text fields;
        # a numeric term also matches the exact amount.
        term = search.strip()
        sf = f"%{term}%"
        conditions = [
            Expense.description.ilike(sf),
            Expense.category.ilike(sf),
            Expense.sub_category.ilike(sf),
            Expense.payment_mode.ilike(sf),
        ]
        try:
            amount_val = Decimal(term.replace(",", ""))
            if amount_val >= 0:
                conditions.append(Expense.amount == amount_val)
        except InvalidOperation:
            pass
        query = query.filter(or_(*conditions))

    ordered = query.order_by(Expense.expense_date.desc(), Expense.id.desc())

    if paginated:
        total = query.count()
        items = ordered.offset(skip).limit(limit).all()
        return {"items": items, "total": total, "skip": skip, "limit": limit}

    return ordered.offset(skip).limit(limit).all()


@router.get("/analytics/summary")
def expense_analytics(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from collections import defaultdict
    from app.models.cash_account import CashAccount

    query = db.query(Expense)
    # C-DI-2: exclude soft-deleted expenses from analytics
    query = query.filter(Expense.is_deleted == False)  # noqa: E712
    if from_date:
        query = query.filter(Expense.expense_date >= from_date)
    if to_date:
        query = query.filter(Expense.expense_date <= to_date)

    expenses = query.order_by(Expense.expense_date.asc()).all()

    by_category = defaultdict(lambda: {"total": Decimal("0"), "count": 0})
    by_sub_category = defaultdict(lambda: defaultdict(lambda: {"total": Decimal("0"), "count": 0}))
    by_month = defaultdict(lambda: {"total": Decimal("0"), "count": 0})
    by_mode = defaultdict(lambda: {"total": Decimal("0"), "count": 0})
    by_linked = defaultdict(lambda: {"total": Decimal("0"), "count": 0})
    by_account = defaultdict(lambda: {"total": Decimal("0"), "count": 0, "name": ""})
    by_day: dict = defaultdict(lambda: {"total": Decimal("0"), "count": 0})
    by_week: dict = defaultdict(lambda: {"total": Decimal("0"), "count": 0, "from_date": None, "to_date": None})
    grand_total = Decimal("0")

    accounts = {a.id: a.name for a in db.query(CashAccount).all()}

    for exp in expenses:
        amount = Decimal(str(exp.amount or 0))
        grand_total += amount

        cat = exp.category or "Uncategorized"
        by_category[cat]["total"] += amount
        by_category[cat]["count"] += 1

        sub = exp.sub_category or "Other"
        by_sub_category[cat][sub]["total"] += amount
        by_sub_category[cat][sub]["count"] += 1

        month_key = exp.expense_date.strftime("%Y-%m")
        by_month[month_key]["total"] += amount
        by_month[month_key]["count"] += 1

        mode = exp.payment_mode or "unknown"
        by_mode[mode]["total"] += amount
        by_mode[mode]["count"] += 1

        linked = exp.linked_type or "general"
        by_linked[linked]["total"] += amount
        by_linked[linked]["count"] += 1

        if exp.account_id:
            by_account[exp.account_id]["total"] += amount
            by_account[exp.account_id]["count"] += 1
            by_account[exp.account_id]["name"] = accounts.get(exp.account_id, f"Account #{exp.account_id}")

        # Daily tracking
        day_key = exp.expense_date.isoformat()
        by_day[day_key]["total"] += amount
        by_day[day_key]["count"] += 1

        # Weekly tracking (ISO week)
        iso_year, iso_week, _ = exp.expense_date.isocalendar()
        week_key = f"{iso_year}-W{iso_week:02d}"
        by_week[week_key]["total"] += amount
        by_week[week_key]["count"] += 1
        if by_week[week_key]["from_date"] is None or exp.expense_date < by_week[week_key]["from_date"]:
            by_week[week_key]["from_date"] = exp.expense_date
        if by_week[week_key]["to_date"] is None or exp.expense_date > by_week[week_key]["to_date"]:
            by_week[week_key]["to_date"] = exp.expense_date

    categories = sorted(
        [{"category": k, "total": v["total"], "count": v["count"]} for k, v in by_category.items()],
        key=lambda x: x["total"], reverse=True,
    )
    # Build sub_categories per category (sorted by total desc)
    sub_categories = {
        cat: sorted(
            [{"sub_category": sub, "total": v["total"], "count": v["count"]}
             for sub, v in subs.items()],
            key=lambda x: x["total"], reverse=True,
        )
        for cat, subs in by_sub_category.items()
    }
    monthly = [{"month": k, "total": v["total"], "count": v["count"]} for k, v in sorted(by_month.items())]
    modes = sorted(
        [{"mode": k, "total": v["total"], "count": v["count"]} for k, v in by_mode.items()],
        key=lambda x: x["total"], reverse=True,
    )
    linked_types = sorted(
        [{"type": k, "total": v["total"], "count": v["count"]} for k, v in by_linked.items()],
        key=lambda x: x["total"], reverse=True,
    )
    account_breakdown = sorted(
        [{"account_id": k, "name": v["name"], "total": v["total"], "count": v["count"]} for k, v in by_account.items()],
        key=lambda x: x["total"], reverse=True,
    )

    # Daily breakdown: sorted by total desc, return all
    daily_list = sorted(
        [{"date": k, "total": v["total"], "count": v["count"]} for k, v in by_day.items()],
        key=lambda x: x["total"], reverse=True,
    )
    peak_day = daily_list[0] if daily_list else None

    # Weekly breakdown
    def _week_label(key: str, from_dt, to_dt) -> str:
        if from_dt and to_dt:
            return f"{from_dt.strftime('%d %b')} – {to_dt.strftime('%d %b %Y')}"
        return key

    weekly_list = sorted(
        [
            {
                "week": k,
                "label": _week_label(k, v["from_date"], v["to_date"]),
                "from_date": v["from_date"].isoformat() if v["from_date"] else None,
                "to_date": v["to_date"].isoformat() if v["to_date"] else None,
                "total": v["total"],
                "count": v["count"],
            }
            for k, v in by_week.items()
        ],
        key=lambda x: x["total"], reverse=True,
    )
    peak_week = weekly_list[0] if weekly_list else None

    return {
        "grand_total": grand_total,
        "expense_count": len(expenses),
        "categories": categories,
        "sub_categories": sub_categories,
        "monthly": monthly,
        "payment_modes": modes,
        "linked_types": linked_types,
        "accounts": account_breakdown,
        "daily": daily_list[:30],
        "weekly": weekly_list,
        "peak_day": peak_day,
        "peak_week": peak_week,
    }


@router.post("/suggest-category")
def suggest_expense_category(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    AI-powered category + sub-category suggestion.
    Priority: 1) Learned user mappings  2) Keyword rules  3) Gemini AI
    """
    from app.services.expense_categorizer import suggest_category, suggest_subcategory
    from app.services.learning import suggest_from_learnings

    description = payload.get("description", "")

    # 1. Check learned mappings first (fastest, personalized)
    # H-DI-13: pass current_user.id to scope suggestions to this user's learnings.
    # Wrapped in try/except so a DB error (e.g. missing user_id column if migration
    # 037 is pending, or any transient connection issue) degrades gracefully to the
    # keyword-rules fallback instead of returning 500 and breaking the button entirely.
    try:
        learned = suggest_from_learnings(db, description, user_id=current_user.id)
    except Exception:
        learned = None
    if learned:
        return {
            "suggested_category": learned[0],
            "suggested_subcategory": learned[1],
            "source": "learned",
        }

    # 2. Keyword rules
    suggested_category = suggest_category(description)
    suggested_subcategory = suggest_subcategory(suggested_category, description) if suggested_category else None
    if suggested_category:
        return {
            "suggested_category": suggested_category,
            "suggested_subcategory": suggested_subcategory,
            "source": "rules",
        }

    # 3. Gemini AI fallback — only when keyword rules find nothing
    try:
        from app.config import settings
        if settings.GEMINI_API_KEY:
            from google import genai as _genai
            _client = _genai.Client(api_key=settings.GEMINI_API_KEY)

            # Build the definitive category + subcategory list
            # Merge hardcoded rules with any user-created DB categories
            from app.services.expense_categorizer import CATEGORY_RULES, SUBCATEGORY_RULES
            from app.models.category import Category as CategoryModel
            db_parent_cats = {
                c.name for c in db.query(CategoryModel)
                .filter(CategoryModel.is_active == True, CategoryModel.parent_id == None)
                .all()
            }
            all_cats = sorted(set(list(CATEGORY_RULES.keys()) + list(db_parent_cats)))
            # Build subcategory map: include DB children for each category
            db_children = {}
            for c in db.query(CategoryModel).filter(CategoryModel.is_active == True, CategoryModel.parent_id != None).all():
                parent = db.query(CategoryModel).filter(CategoryModel.id == c.parent_id).first()
                if parent:
                    db_children.setdefault(parent.name, set()).add(c.name)

            # H-INT-5: sanitize category names before interpolating into prompt
            # to prevent a crafted category name from escaping the prompt context
            def _safe_name(n: str) -> str:
                return "".join(ch for ch in n if ch.isalnum() or ch in " &/()-_.,")

            safe_all_cats = [_safe_name(c) for c in all_cats]
            sub_map_lines = "\n".join(
                f"  {_safe_name(cat)}: {', '.join(sorted(_safe_name(s) for s in set(list(SUBCATEGORY_RULES.get(cat, {}).keys()) + list(db_children.get(cat, [])))))}"
                for cat in all_cats
            )
            # sanitize the user-supplied description: strip control chars
            safe_description = description.replace("\\", "").replace("\"", "'")[:500]
            prompt = (
                f"You are a financial expense categorizer for an Indian household finance tracker.\n"
                f"Given the expense description below, pick the BEST matching category and sub-category "
                f"from the provided lists. Reply in JSON only: "
                f'{{\"category\": \"<name>\", \"sub_category\": \"<name or null>\"}}\n\n'
                f"AVAILABLE CATEGORIES: {', '.join(safe_all_cats)}\n\n"
                f"SUBCATEGORIES PER CATEGORY:\n{sub_map_lines}\n\n"
                f"EXPENSE DESCRIPTION: \"{safe_description}\"\n\n"
                f"Rules:\n"
                f"- category MUST be exactly one of the available categories\n"
                f"- sub_category must be from that category's list or null if no good match\n"
                f"- Reply with ONLY the JSON, no explanation"
            )
            # Use GEMINI_MODEL from settings so the model name is overridable via
            # env var without a code deploy.  Default is "gemini-2.0-flash" (stable).
            response = _client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )
            raw = (response.text or "").strip()
            # Strip markdown code fences if present (model sometimes wraps JSON)
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            import json as _json
            parsed = _json.loads(raw.strip())
            ai_cat = parsed.get("category") or None
            ai_sub = parsed.get("sub_category") or None
            # Validate category is in allowed list (prevent hallucination)
            if ai_cat and ai_cat in all_cats:
                return {
                    "suggested_category": ai_cat,
                    "suggested_subcategory": ai_sub,
                    "source": "gemini",
                }
            # Category returned by Gemini didn't match any known category
            if ai_cat:
                logger.warning(
                    "Gemini returned unknown category %r (not in allowed list). "
                    "description=%r model=%s",
                    ai_cat, description[:80], settings.GEMINI_MODEL,
                )
    except Exception as _gemini_err:
        # Log the actual error so it's visible in server logs — this is the
        # primary diagnostic for "why is Gemini not working?" questions.
        logger.warning(
            "Gemini category suggestion failed: %s — "
            "check GEMINI_API_KEY and GEMINI_MODEL (%s) in your .env",
            _gemini_err, settings.GEMINI_MODEL,
        )

    return {
        "suggested_category": None,
        "suggested_subcategory": None,
        "source": "none",
    }


@router.post("", response_model=ExpenseOut)
def create_expense(
    expense_data: ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    # C-DI-3: verify the polymorphic linked_id resolves to a real record
    _validate_linked_id(expense_data.linked_type, expense_data.linked_id, db)
    expense = Expense(**expense_data.model_dump(), created_by=current_user.id)

    # Auto-categorize if no category provided
    if not expense.category and expense.description:
        from app.services.expense_categorizer import suggest_category, suggest_subcategory
        expense.category = suggest_category(expense.description)
        if not expense.sub_category and expense.category:
            expense.sub_category = suggest_subcategory(expense.category, expense.description)
    elif expense.category and not expense.sub_category and expense.description:
        from app.services.expense_categorizer import suggest_subcategory
        expense.sub_category = suggest_subcategory(expense.category, expense.description)

    db.add(expense)
    db.flush()

    # E8: domain event, committed atomically with the expense. The
    # category-limit alert handler consumes it (see app/events.py).
    from app.events import emit_event
    emit_event(db, "expense.created", {
        "expense_id": expense.id,
        "category": expense.category,
        "amount": float(expense.amount),
        "expense_date": expense.expense_date.isoformat(),
    })

    # Auto-ledger: debit account for expense
    if expense.account_id:
        auto_ledger(
            db=db,
            account_id=expense.account_id,
            txn_type="debit",
            amount=Decimal(str(expense.amount)),
            txn_date=expense.expense_date,
            linked_type="expense",
            linked_id=expense.id,
            description=f"Expense: {expense.category or 'misc'} — {expense.description or ''}".strip(),
            payment_mode=expense.payment_mode,
            created_by=current_user.id,
            source_type="expense",
            source_id=expense.id,
        )

    db.commit()
    db.refresh(expense)

    # E8: deliver the committed event (inline without Redis, worker with)
    from app.events import flush_events
    flush_events(db)

    # Learn from this save for future suggestions.
    # Wrapped in try/except: the expense is already committed above, so a learning
    # failure (UniqueConstraint race, schema mismatch, etc.) must not surface as a
    # 500 that makes the caller think the expense wasn't saved.
    if expense.description and expense.category:
        from app.services.learning import save_learning
        try:
            save_learning(db, expense.description, expense.category, expense.sub_category, user_id=current_user.id)
            db.commit()
        except Exception:
            db.rollback()

    return expense


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: int,
    expense_data: ExpenseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    expense = _get_expense_or_404(expense_id, db)
    # C-DI-3: verify polymorphic linked_id if either field is being updated
    update_data = expense_data.model_dump(exclude_unset=True)
    linked_type = update_data.get("linked_type", expense.linked_type)
    linked_id = update_data.get("linked_id", expense.linked_id)
    _validate_linked_id(linked_type, linked_id, db)
    old_account_id = expense.account_id
    old_amount = Decimal(str(expense.amount)) if expense.amount else Decimal("0")
    old_date = expense.expense_date
    for field, value in update_data.items():
        setattr(expense, field, value)

    # If amount, date, or account changed, update the ledger entry.
    # Also handles the case where the expense had NO account before and one is
    # being attached now (old_account_id is None) — previously no entry was created.
    new_amount = Decimal(str(expense.amount)) if expense.amount else Decimal("0")
    if (old_account_id or expense.account_id) and (
            old_amount != new_amount
            or old_date != expense.expense_date
            or old_account_id != expense.account_id):
        # Remove old ledger entry
        reverse_all_ledger(db, "expense", expense.id)
        # Create new one if account is set
        if expense.account_id:
            auto_ledger(
                db=db,
                account_id=expense.account_id,
                txn_type="debit",
                amount=new_amount,
                txn_date=expense.expense_date,
                linked_type="expense",
                linked_id=expense.id,
                description=f"Expense: {expense.category or 'misc'} — {expense.description or ''}".strip(),
                payment_mode=expense.payment_mode,
                created_by=current_user.id,
                source_type="expense",
                source_id=expense.id,
            )

    db.commit()
    db.refresh(expense)

    # Learn from this update for future suggestions (same resilience pattern as create).
    if expense.description and expense.category:
        from app.services.learning import save_learning
        try:
            save_learning(db, expense.description, expense.category, expense.sub_category, user_id=current_user.id)
            db.commit()
        except Exception:
            db.rollback()

    return expense


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    expense = _get_expense_or_404(expense_id, db)
    # Reverse linked ledger entry
    reverse_all_ledger(db, "expense", expense.id)
    # C-DI-2: soft-delete to preserve audit history
    expense.is_deleted = True
    db.commit()
    return {"message": "Expense deleted successfully"}
