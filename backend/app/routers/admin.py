"""Admin endpoints for one-time data migration operations."""

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app.dependencies import require_admin
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

# #11 (FIX): Single source of truth for every table name that may appear in an
# interpolated f-string SQL statement below. The values are already hardcoded
# (never user input), but routing them through this allowlist guarantees a
# future edit can't turn the f-strings into a SQL-injection vector.
_ALLOWED_TABLES = frozenset({
    "partnership_transactions",
    "partnership_members",
    "property_transactions",
    "plot_buyers",
    "site_plots",
    "partnerships",
    "property_deals",
    "contacts",
})


def _safe_table(name: str) -> str:
    """Return the table name only if it is in the allowlist; otherwise refuse.
    Defends the f-string interpolated SQL below against any non-literal value."""
    if name not in _ALLOWED_TABLES:
        raise ValueError(f"Refusing to use non-allowlisted table name in SQL: {name!r}")
    return name


def _tenant(db: Session, current_user: User) -> int:
    """Tenant scope for the bulk raw-SQL statements below. Raw SQL bypasses
    the automatic filter in app/tenancy.py, so these destructive operations
    must scope themselves explicitly to the caller's own tenant."""
    if db.info.get("admin_context_mode"):
        # Never run these destructive legacy bulk tools while operating inside
        # another user's account (view OR edit mode) — too blunt for support.
        from fastapi import HTTPException
        raise HTTPException(
            status_code=403,
            detail="Not available while viewing another user's tenant",
        )
    return db.info.get("tenant_id") or current_user.id


@router.post("/mark-legacy")
def mark_all_existing_as_legacy(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Mark ALL existing records in property/partnership/contact tables as is_legacy=true.
    Used before importing production data so old dev/test data can be hidden.
    C-DI-4: audit log written for this destructive operation."""
    tables = [
        "partnership_transactions",
        "partnership_members",
        "property_transactions",
        "plot_buyers",
        "site_plots",
        "partnerships",
        "property_deals",
        "contacts",
    ]
    counts = {}
    for table in tables:
        result = db.execute(
            text(f"UPDATE {_safe_table(table)} SET is_legacy = true WHERE is_legacy = false AND owner_id = :owner"),
            {"owner": _tenant(db, current_user)},
        )
        counts[table] = result.rowcount
    db.commit()
    # C-DI-4: write audit log after commit
    logger.warning(
        "AUDIT mark-legacy by user=%s counts=%s",
        current_user.id,
        counts,
    )
    return {"message": "All existing data marked as legacy", "counts": counts}


@router.post("/unmark-legacy")
def unmark_all_legacy(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Reverse of mark-legacy: set is_legacy=false on ALL records that were marked legacy.
    Use this to restore visibility of data that was incorrectly marked.
    C-DI-4: audit log written for this operation."""
    tables = [
        "partnership_transactions",
        "partnership_members",
        "property_transactions",
        "plot_buyers",
        "site_plots",
        "partnerships",
        "property_deals",
        "contacts",
    ]
    counts = {}
    for table in tables:
        result = db.execute(
            text(f"UPDATE {_safe_table(table)} SET is_legacy = false WHERE is_legacy = true AND owner_id = :owner"),
            {"owner": _tenant(db, current_user)},
        )
        counts[table] = result.rowcount
    db.commit()
    # C-DI-4: audit log
    logger.warning(
        "AUDIT unmark-legacy by user=%s counts=%s",
        current_user.id,
        counts,
    )
    return {"message": "All legacy flags cleared — data is now visible", "counts": counts}


@router.delete("/delete-legacy")
def delete_all_legacy_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Soft-delete ALL records where is_legacy=true.
    C-DI-5: changed from hard DELETE to soft-delete (is_deleted=true) so that
    linked AccountTransaction rows don't get dangling pointers and data is
    recoverable before a manual DBA purge.
    C-DI-4: audit log written for this operation."""
    counts = {}

    # Soft-delete child tables that have an is_deleted column
    soft_delete_tables = [
        "partnership_transactions",
        "property_transactions",
        "plot_buyers",
        "partnerships",
        "property_deals",
    ]
    for table in soft_delete_tables:
        result = db.execute(text(
            f"UPDATE {_safe_table(table)} SET is_deleted = true WHERE is_legacy = true AND is_deleted = false AND owner_id = :owner"
        ), {"owner": _tenant(db, current_user)})
        counts[f"{table}_soft_deleted"] = result.rowcount

    # Tables without is_deleted: soft-delete via is_legacy flag (leave as-is, just hide)
    # partnership_members and site_plots have no is_deleted column — mark noted in counts
    for table in ("partnership_members", "site_plots"):
        result = db.execute(
            text(f"SELECT COUNT(*) FROM {_safe_table(table)} WHERE is_legacy = true AND owner_id = :owner"),
            {"owner": _tenant(db, current_user)},
        )
        row = result.fetchone()
        counts[f"{table}_legacy_count"] = row[0] if row else 0

    # Contacts: already using soft-delete
    result = db.execute(text(
        "UPDATE contacts SET is_deleted = true WHERE is_legacy = true AND is_deleted = false AND owner_id = :owner"
    ), {"owner": _tenant(db, current_user)})
    counts["contacts_soft_deleted"] = result.rowcount

    db.commit()
    # C-DI-4: audit log
    logger.warning(
        "AUDIT delete-legacy (soft) by user=%s counts=%s",
        current_user.id,
        counts,
    )
    return {"message": "Legacy data soft-deleted (is_deleted=true). Hard purge must be done manually by DBA.", "counts": counts}


# ═══════════════════════════════════════════════════════════════════════════
# E5 — Admin console: user management, platform stats, support-view audit.
# The "view as user" flow itself needs no endpoint here: the admin UI sends
# X-Tenant-Context: <user_id> and every EXISTING endpoint serves that
# tenant's data read-only (see app/dependencies.py).
# ═══════════════════════════════════════════════════════════════════════════

from sqlalchemy import func as _sa_func

from app.models.activity_log import ActivityLog as _ActivityLog
from app.models.user import User as _User
from app.modules import ALL_MODULE_KEYS as _ALL_MODULE_KEYS


@router.get("/users")
def list_users(
    search: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """All user accounts with tenancy + entitlement info."""
    q = db.query(_User)
    if search:
        like = f"%{search}%"
        q = q.filter((_User.username.ilike(like)) | (_User.email.ilike(like)))
    users = q.order_by(_User.id).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "full_name": u.full_name,
            "role": u.role,
            "is_active": u.is_active,
            "email_verified": u.email_verified,
            "tenant_owner_id": u.tenant_owner_id,
            "enabled_modules": u.enabled_modules,  # null = all (legacy)
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.put("/users/{user_id}/active")
def set_user_active(
    user_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Activate / deactivate an account. Deactivation blocks login immediately
    (get_current_user filters is_active) but never deletes data."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    user = db.get(_User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = bool(payload.get("is_active", True))
    db.commit()
    logger.warning("AUDIT set-active user=%s target=%s active=%s",
                   current_user.id, user_id, user.is_active)
    return {"id": user.id, "is_active": user.is_active}


@router.get("/stats")
def platform_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """FB-5.3 — signups, activity and module adoption across the platform."""
    users = db.query(_User).all()
    owners = [u for u in users if u.tenant_owner_id is None]

    # Module adoption: explicit lists only; NULL (= all) counted separately
    adoption = {k: 0 for k in sorted(_ALL_MODULE_KEYS)}
    legacy_all = 0
    for u in owners:
        if u.enabled_modules is None:
            legacy_all += 1
        else:
            for k in u.enabled_modules:
                if k in adoption:
                    adoption[k] += 1

    # Rows per tenant across all domain tables (owner_id is on every one)
    from app.models.mixins import TenantMixin
    from app.database import Base
    rows_per_tenant: dict[int, int] = {}
    for mapper in Base.registry.mappers:
        cls = mapper.class_
        if not issubclass(cls, TenantMixin):
            continue
        for owner_id, count in (
            db.query(cls.owner_id, _sa_func.count())
            # Platform-wide stat: deliberately bypass the per-tenant filter
            .execution_options(skip_tenant_filter=True)
            .group_by(cls.owner_id)
            .all()
        ):
            if owner_id is not None:
                rows_per_tenant[owner_id] = rows_per_tenant.get(owner_id, 0) + count

    return {
        "total_users": len(users),
        "tenant_owners": len(owners),
        "active_users": sum(1 for u in users if u.is_active),
        "verified_users": sum(1 for u in users if u.email_verified),
        "household_guests": len(users) - len(owners),
        "module_adoption": adoption,
        "accounts_with_all_modules": legacy_all,
        "rows_per_tenant": rows_per_tenant,
        "recent_activity": [
            {
                "id": a.id,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "username": a.username,
                "action": a.action,
                "module": a.module,
                "description": a.description,
            }
            for a in db.query(_ActivityLog)
            .execution_options(skip_tenant_filter=True)
            .order_by(_ActivityLog.id.desc())
            .limit(20)
            .all()
        ],
    }


@router.get("/users/{user_id}/activity")
def user_activity(
    user_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Full, human-readable activity trail for one user's account — who did
    what, when, and (for support edits) that it was the admin. Ordered newest
    first for easy trace-back."""
    target = db.get(_User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    owner_id = target.tenant_owner_id or target.id
    rows = (
        db.query(_ActivityLog)
        .execution_options(skip_tenant_filter=True)
        .filter(_ActivityLog.owner_id == owner_id)
        .order_by(_ActivityLog.id.desc())
        .limit(min(limit, 500))
        .all()
    )
    return {
        "user": {"id": target.id, "username": target.username},
        "entries": [
            {
                "id": a.id,
                "when": a.created_at.isoformat() if a.created_at else None,
                "who": a.username,                 # actor (may be the admin on support edits)
                "by_admin": bool(a.description and "support admin" in a.description),
                "action": a.action,                # create | update | delete | void | alert | admin_view | login…
                "module": a.module,                # loans | expenses | accounts …
                "what": a.description,             # plain-English one-liner
                "amount": float(a.amount) if a.amount is not None else None,
                "changes": a.changes,              # {field: {old, new}} for updates
                "request": a.request_info,         # the HTTP call, for deep trace-back
            }
            for a in rows
        ],
    }
