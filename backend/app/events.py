"""E8 (trimmed) — in-app domain events via the transactional outbox.

Usage in a router:

    emit_event(db, "expense.created", {...})   # BEFORE db.commit() — the
    db.commit()                                # event commits with the change
    flush_events(db)                           # AFTER commit — deliver

Delivery:
  - eager mode (no REDIS_URL): flush_events drains pending events inline on
    the same session. Synchronous, but the event row still exists first, so
    a crash mid-handler leaves a pending row the next flush retries.
  - broker mode: flush_events enqueues app.tasks.dispatch_outbox for
    immediate pickup; the beat schedule re-runs it every minute as the
    safety net for events enqueued around a crash.

Handlers are idempotent and scope queries by event.owner_id explicitly —
worker sessions have no tenant context, so nothing implicit protects them.
Failures are recorded per event (attempts, last_error); after MAX_ATTEMPTS
the event is parked (a poor man's DLQ — visible via simple SQL).
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models.outbox_event import OutboxEvent

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


def emit_event(db: Session, event_type: str, payload: dict,
               owner_id: int | None = None) -> OutboxEvent:
    """Record a domain event in the caller's transaction (call before commit).
    owner_id defaults to the session tenant; pass it explicitly on paths
    without a tenant context (e.g. signup)."""
    row = OutboxEvent(
        event_type=event_type,
        owner_id=owner_id if owner_id is not None else db.info.get("tenant_id"),
        payload=payload,
        attempts=0,
    )
    db.add(row)
    db.flush()
    return row


def flush_events(db: Session) -> None:
    """Trigger delivery. Call AFTER the transaction that emitted committed."""
    if settings.REDIS_URL:
        from app.tasks import dispatch_outbox
        dispatch_outbox.delay()
    else:
        dispatch_pending(db)


def dispatch_pending(db: Session, limit: int = 100) -> int:
    """Deliver pending events to their handlers. Returns how many succeeded."""
    rows = (
        db.query(OutboxEvent)
        .filter(OutboxEvent.processed_at.is_(None),
                OutboxEvent.attempts < MAX_ATTEMPTS)
        .order_by(OutboxEvent.id)
        .limit(limit)
        .all()
    )
    done = 0
    for event in rows:
        try:
            for handler in HANDLERS.get(event.event_type, []):
                handler(db, event)
            event.processed_at = datetime.now(timezone.utc)
            done += 1
        except Exception as exc:
            event.attempts += 1
            event.last_error = str(exc)[:2000]
            logger.warning("outbox: handler failed for event %s (%s), attempt %d: %s",
                           event.id, event.event_type, event.attempts, exc)
        db.commit()
    return done


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def send_welcome_email(db: Session, event: OutboxEvent) -> None:
    from app.tasks import send_email
    p = event.payload
    send_email.delay(
        p["email"],
        "Welcome to FinancerBuddy 🎉",
        f"Hi {p.get('full_name') or p['username']},\n\n"
        "Your FinancerBuddy workspace is ready. Log your first expense, add "
        "your accounts, and everything else builds from there.\n\n"
        "You chose your modules at signup — change them anytime in Settings.\n\n"
        "— FinancerBuddy",
    )


def check_category_limit(db: Session, event: OutboxEvent) -> None:
    """Write an 'alert' activity-log entry when an expense pushes a category
    over its monthly limit. Idempotent: one alert per (category, month)."""
    from app.models.activity_log import ActivityLog
    from app.models.category_limit import CategoryLimit
    from app.models.expense import Expense

    p = event.payload
    owner_id, category = event.owner_id, p.get("category")
    if not (owner_id and category):
        return

    limit_row = (
        db.query(CategoryLimit)
        .execution_options(skip_tenant_filter=True)
        .filter(CategoryLimit.owner_id == owner_id,
                CategoryLimit.category == category)
        .first()
    )
    if limit_row is None:
        return

    expense_date = datetime.fromisoformat(p["expense_date"]).date()
    month_start = expense_date.replace(day=1)
    next_month = (month_start.replace(year=month_start.year + 1, month=1)
                  if month_start.month == 12
                  else month_start.replace(month=month_start.month + 1))
    spent = (
        db.query(func.coalesce(func.sum(Expense.amount), 0))
        .execution_options(skip_tenant_filter=True)
        .filter(Expense.owner_id == owner_id,
                Expense.category == category,
                Expense.expense_date >= month_start,
                Expense.expense_date < next_month)
        .scalar()
    )
    if Decimal(str(spent)) <= Decimal(str(limit_row.monthly_limit)):
        return

    month_key = month_start.strftime("%Y-%m")
    already = (
        db.query(ActivityLog)
        .execution_options(skip_tenant_filter=True)
        .filter(ActivityLog.owner_id == owner_id,
                ActivityLog.action == "alert",
                ActivityLog.module == "expenses",
                ActivityLog.entity_name == f"{category}:{month_key}")
        .first()
    )
    if already:
        return  # idempotency: at-least-once delivery must not duplicate alerts

    db.add(ActivityLog(
        owner_id=owner_id,
        username="system",
        action="alert",
        module="expenses",
        entity_type="category_limits",
        entity_id=limit_row.id,
        entity_name=f"{category}:{month_key}",
        description=(f"Monthly limit exceeded for '{category}': spent "
                     f"₹{float(spent):,.2f} of ₹{float(limit_row.monthly_limit):,.2f} in {month_key}"),
        amount=Decimal(str(spent)),
    ))


HANDLERS: dict[str, list] = {
    "user.signed_up": [send_welcome_email],
    "expense.created": [check_category_limit],
}
