"""Admin endpoints for one-time data migration operations."""

import logging
from fastapi import APIRouter, Depends
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
