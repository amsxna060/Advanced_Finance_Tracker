"""
Activity-log read API.

Rows are produced automatically by app/services/activity_logger.py; this
router only reads them. Contact/account names are resolved at read time via
outer joins so the log table stays lean and names stay current.
"""

from datetime import date, datetime, time, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, cast, String, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ActivityLog, CashAccount, Contact, User

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"])


@router.get("")
def list_activity_logs(
    search: Optional[str] = Query(None, description="Free text: names, description, amounts, usernames"),
    module: Optional[str] = Query(None, description="loans | accounts | obligations | ..."),
    action: Optional[str] = Query(None, description="create | update | delete | void | login | logout"),
    entity_type: Optional[str] = None,
    account_id: Optional[int] = None,
    contact_id: Optional[int] = None,
    user_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sort: str = Query("newest", pattern="^(newest|oldest)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = (
        db.query(
            ActivityLog,
            Contact.name.label("contact_name"),
            CashAccount.name.label("account_name"),
        )
        .outerjoin(Contact, Contact.id == ActivityLog.contact_id)
        .outerjoin(CashAccount, CashAccount.id == ActivityLog.account_id)
    )

    if module:
        q = q.filter(ActivityLog.module == module)
    if action:
        q = q.filter(ActivityLog.action == action)
    if entity_type:
        q = q.filter(ActivityLog.entity_type == entity_type)
    if account_id:
        q = q.filter(ActivityLog.account_id == account_id)
    if contact_id:
        q = q.filter(ActivityLog.contact_id == contact_id)
    if user_id:
        q = q.filter(ActivityLog.user_id == user_id)
    if date_from:
        q = q.filter(ActivityLog.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        q = q.filter(ActivityLog.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))

    if search and search.strip():
        term = f"%{search.strip()}%"
        clauses = [
            ActivityLog.entity_name.ilike(term),
            ActivityLog.description.ilike(term),
            ActivityLog.entity_type.ilike(term),
            ActivityLog.module.ilike(term),
            ActivityLog.username.ilike(term),
            ActivityLog.request_info.ilike(term),
            Contact.name.ilike(term),
            CashAccount.name.ilike(term),
            # Search inside the change diff too (credit/debit, old values, field names…)
            cast(ActivityLog.changes, String).ilike(term),
        ]
        # Numeric search → also match the headline amount exactly
        try:
            clauses.append(ActivityLog.amount == float(search.strip().replace(",", "")))
        except ValueError:
            pass
        q = q.filter(or_(*clauses))

    total = q.with_entities(func.count(ActivityLog.id)).order_by(None).scalar() or 0

    order = ActivityLog.created_at.asc() if sort == "oldest" else ActivityLog.created_at.desc()
    rows = (
        q.order_by(order, ActivityLog.id.asc() if sort == "oldest" else ActivityLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = []
    for log, contact_name, account_name in rows:
        items.append({
            "id": log.id,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "user_id": log.user_id,
            "username": log.username,
            "action": log.action,
            "module": log.module,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "entity_name": log.entity_name,
            "description": log.description,
            "changes": log.changes,
            "amount": float(log.amount) if log.amount is not None else None,
            "account_id": log.account_id,
            "account_name": account_name,
            "contact_id": log.contact_id,
            "contact_name": contact_name,
            "loan_id": log.loan_id,
            "request_info": log.request_info,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
    }


@router.get("/filters")
def activity_log_filters(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Distinct values actually present in the log, for the filter dropdowns."""
    modules = [r[0] for r in db.query(ActivityLog.module).distinct().order_by(ActivityLog.module)]
    actions = [r[0] for r in db.query(ActivityLog.action).distinct().order_by(ActivityLog.action)]
    entity_types = [r[0] for r in db.query(ActivityLog.entity_type).distinct().order_by(ActivityLog.entity_type)]
    users = [
        {"user_id": r[0], "username": r[1]}
        for r in db.query(ActivityLog.user_id, ActivityLog.username).distinct()
        if r[0] is not None
    ]
    return {"modules": modules, "actions": actions, "entity_types": entity_types, "users": users}
