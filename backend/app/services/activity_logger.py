"""
Automatic activity/audit logging.

Hooks SQLAlchemy's flush events on the global Session class so that EVERY ORM
create / update / delete — from any router, service, or the background
scheduler — produces an `activity_logs` row in the same transaction, with a
field-level before→after diff. No per-endpoint instrumentation needed.

How attribution works: `get_current_user` (app/dependencies.py) stamps the
request's DB session with the acting user + request line via `session.info`
(a plain per-session dict, safe across FastAPI's threadpool). Sessions without
a stamp (scheduler jobs, seed scripts) are logged as "system".

Known limitation: bulk `Query.update()` / `Query.delete()` bypass ORM flush
events and are not captured. The codebase mutates via ORM objects, so this
covers effectively everything.

Import this module once (done in app/main.py) to register the listeners.
"""

import logging
from datetime import date, datetime
from decimal import Decimal
from enum import Enum

from sqlalchemy import event, inspect as sa_inspect, select
from sqlalchemy.orm import Session

from app import models as m
from app.models.activity_log import ActivityLog

logger = logging.getLogger(__name__)

_PENDING_KEY = "_audit_pending"

# Class → (module, human-friendly label). Classes not listed here fall back to
# module="other" + tablename; auth/infra tables in _SKIP are never logged.
_REGISTRY = {
    m.Contact: ("contacts", "contact"),
    m.Loan: ("loans", "loan"),
    m.LoanPayment: ("loans", "loan payment"),
    m.LoanCapitalizationEvent: ("loans", "capitalization event"),
    m.Collateral: ("loans", "collateral"),
    m.PropertyDeal: ("properties", "property deal"),
    m.PropertyTransaction: ("properties", "property transaction"),
    m.PropertySimulation: ("properties", "property simulation"),
    m.PropertyAnomaly: ("properties", "property anomaly"),
    m.Partnership: ("partnerships", "partnership"),
    m.PartnershipMember: ("partnerships", "partnership member"),
    m.PartnershipTransaction: ("partnerships", "partnership transaction"),
    m.Expense: ("expenses", "expense"),
    m.Category: ("expenses", "category"),
    m.CategoryLimit: ("expenses", "category limit"),
    m.Beesi: ("beesi", "beesi"),
    m.BeesiInstallment: ("beesi", "beesi installment"),
    m.BeesiWithdrawal: ("beesi", "beesi withdrawal"),
    m.CashAccount: ("accounts", "account"),
    m.AccountTransaction: ("accounts", "account transaction"),
    m.MoneyObligation: ("obligations", "obligation"),
    m.ObligationSettlement: ("obligations", "obligation settlement"),
    m.RecurringTransaction: ("forecast", "recurring transaction"),
    m.ForecastOverride: ("forecast", "forecast override"),
    m.UnencumberedAsset: ("assets", "asset (legacy)"),
    m.Asset: ("assets", "asset"),
    m.User: ("auth", "user"),
}

# SitePlot / PlotBuyer live inside property_deal.py but aren't re-exported in
# models/__init__ under those names in every version — register defensively.
for _name, _entry in (("SitePlot", ("properties", "site plot")),
                      ("PlotBuyer", ("properties", "plot buyer"))):
    _cls = getattr(m, _name, None)
    if _cls is None:
        try:
            from app.models import property_deal as _pd
            _cls = getattr(_pd, _name, None)
        except ImportError:
            _cls = None
    if _cls is not None:
        _REGISTRY[_cls] = _entry

# Never logged: the log itself (recursion), token blacklist (noise, hashes),
# ML learning rows (system noise, not user actions).
_SKIP = (ActivityLog, m.RefreshTokenBlacklist, m.CategoryLearning, m.OutboxEvent)

# Fields never recorded in snapshots/diffs.
_EXCLUDED_FIELDS = {"password_hash", "token_hash", "created_at", "updated_at"}

# Ordered candidates for a record's human label / headline amount.
_NAME_FIELDS = ("name", "title", "full_name", "username", "reason", "plot_number",
                "category", "description", "notes")
_AMOUNT_FIELDS = ("amount", "principal_amount", "monthly_installment", "installment_amount",
                  "monthly_amount", "total_amount", "expected_amount", "settled_amount",
                  "purchase_price", "total_purchase_price", "current_value", "opening_balance")


def _serialize(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _entity_name(obj):
    for field in _NAME_FIELDS:
        val = getattr(obj, field, None)
        if val and isinstance(val, str):
            return val[:255] if len(val) <= 255 else val[:252] + "..."
    return None


def _headline_amount(obj):
    for field in _AMOUNT_FIELDS:
        val = getattr(obj, field, None)
        if val is not None:
            try:
                return Decimal(str(val))
            except Exception:
                continue
    return None


def _snapshot(obj):
    """All scalar column values (create/delete payloads)."""
    snap = {}
    for attr in sa_inspect(obj).mapper.column_attrs:
        if attr.key in _EXCLUDED_FIELDS:
            continue
        snap[attr.key] = _serialize(getattr(obj, attr.key, None))
    return snap


def _committed_row(session, state):
    """The record as it currently exists in the DB (pre-flush), keyed by attr name."""
    if state.identity is None:
        return None
    mapper = state.mapper
    conds = [col == val for col, val in zip(mapper.primary_key, state.identity)]
    row = session.connection().execute(select(mapper.local_table).where(*conds)).mappings().first()
    if row is None:
        return None
    return {attr.key: row.get(attr.columns[0].name) for attr in mapper.column_attrs}


def _diff(session, obj):
    """Changed columns as {field: {"old": .., "new": ..}}."""
    changes = {}
    state = sa_inspect(obj)
    committed = None
    for attr in state.mapper.column_attrs:
        if attr.key in _EXCLUDED_FIELDS:
            continue
        hist = state.attrs[attr.key].history
        if not hist.has_changes():
            continue
        new = _serialize(hist.added[0]) if hist.added else None
        if hist.deleted:
            old = _serialize(hist.deleted[0])
        else:
            # Attribute was overwritten while expired (post-commit) — history
            # doesn't hold the old value, so read it from the DB row directly.
            if committed is None:
                committed = _committed_row(session, state) or {}
            old = _serialize(committed.get(attr.key))
        if old != new:
            changes[attr.key] = {"old": old, "new": new}
    return changes


def _fmt_amount(amount):
    try:
        return f"₹{float(amount):,.2f}"
    except Exception:
        return str(amount)


def _build_row(session, action, obj, changes):
    module, label = _REGISTRY.get(type(obj), ("other", type(obj).__tablename__ if hasattr(type(obj), "__tablename__") else type(obj).__name__))

    state = sa_inspect(obj)
    entity_id = state.identity[0] if state.identity and len(state.identity) == 1 else getattr(obj, "id", None)
    name = _entity_name(obj)
    amount = _headline_amount(obj)

    # Soft delete / void expressed as an update → reclassify for readability
    if action == "update" and changes:
        if changes.get("is_deleted", {}).get("new") is True:
            action = "delete"
        elif changes.get("is_voided", {}).get("new") is True:
            action = "void"

    ref = f"{label} '{name}'" if name else f"{label} #{entity_id}" if entity_id else label
    if action == "create":
        description = f"Created {ref}"
    elif action == "delete":
        description = f"Deleted {ref}"
    elif action == "void":
        description = f"Voided {ref}"
    else:
        fields = list(changes.keys()) if changes else []
        shown = ", ".join(fields[:4]) + ("…" if len(fields) > 4 else "")
        description = f"Updated {ref}" + (f" ({shown})" if shown else "")
    if amount is not None:
        description += f" — {_fmt_amount(amount)}"

    info = session.info
    # When a platform admin edits a user's data via the support view (edit
    # mode), make that unmistakable in the account owner's own log so it's
    # never confused with their own action.
    if info.get("admin_context_mode") == "edit":
        description += f" · by support admin '{info.get('audit_username') or 'admin'}'"

    return {
        # Rows are written via a Core insert (after_flush), which bypasses the
        # ORM tenant stamping in app/tenancy.py — set the tenant explicitly.
        "owner_id": info.get("tenant_id") or info.get("audit_user_id"),
        "user_id": info.get("audit_user_id"),
        "username": info.get("audit_username") or "system",
        "action": action,
        "module": module,
        "entity_type": getattr(type(obj), "__tablename__", type(obj).__name__),
        "entity_id": entity_id,
        "entity_name": name,
        "description": description,
        "changes": changes,
        "amount": amount,
        "account_id": getattr(obj, "account_id", None),
        "contact_id": getattr(obj, "contact_id", None),
        "loan_id": getattr(obj, "loan_id", None) or (entity_id if isinstance(obj, m.Loan) else None),
        "request_info": info.get("audit_request"),
    }


@event.listens_for(Session, "before_flush")
def _audit_before_flush(session, flush_context, instances):
    pending = session.info.setdefault(_PENDING_KEY, [])
    try:
        for obj in session.new:
            if not isinstance(obj, _SKIP):
                pending.append(("create", obj, None))
        for obj in session.dirty:
            if isinstance(obj, _SKIP) or not session.is_modified(obj, include_collections=False):
                continue
            changes = _diff(session, obj)
            if changes:
                pending.append(("update", obj, changes))
        for obj in session.deleted:
            if not isinstance(obj, _SKIP):
                pending.append(("delete", obj, _snapshot(obj)))
    except Exception:
        # Auditing must never break the actual business transaction
        logger.exception("activity_logger: failed to capture flush changes")


@event.listens_for(Session, "after_flush")
def _audit_after_flush(session, flush_context):
    pending = session.info.pop(_PENDING_KEY, None)
    if not pending:
        return
    try:
        rows = []
        for action, obj, changes in pending:
            if action == "create" and changes is None:
                changes = _snapshot(obj)  # PKs/defaults now assigned
            rows.append(_build_row(session, action, obj, changes))
        if rows:
            session.execute(ActivityLog.__table__.insert(), rows)
    except Exception:
        logger.exception("activity_logger: failed to write activity_logs rows")


@event.listens_for(Session, "after_soft_rollback")
def _audit_clear_on_rollback(session, previous_transaction):
    # A failed flush leaves captured entries behind; drop them so the next
    # flush in a reused session doesn't double-log.
    session.info.pop(_PENDING_KEY, None)


def log_auth_event(db, user, action, request=None):
    """Explicit auth events (login/logout) — these don't touch ORM rows."""
    try:
        db.add(ActivityLog(
            owner_id=user.tenant_owner_id or user.id,
            user_id=user.id,
            username=user.username,
            action=action,
            module="auth",
            entity_type="users",
            entity_id=user.id,
            entity_name=user.username,
            description=f"User '{user.username}' logged {'in' if action == 'login' else 'out'}",
            request_info=f"{request.method} {request.url.path}" if request is not None else None,
        ))
        db.commit()
    except Exception:
        logger.exception("activity_logger: failed to record auth event")
        db.rollback()
