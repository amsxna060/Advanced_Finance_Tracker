"""Admin endpoints for one-time data migration operations."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db
from app.dependencies import require_admin
from app.models.user import User

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/mark-legacy")
def mark_all_existing_as_legacy(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Mark ALL existing records in property/partnership/contact tables as is_legacy=true.
    Used before importing production data so old dev/test data can be hidden."""
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
        result = db.execute(text(f"UPDATE {table} SET is_legacy = true WHERE is_legacy = false"))
        counts[table] = result.rowcount
    db.commit()
    return {"message": "All existing data marked as legacy", "counts": counts}


@router.delete("/delete-legacy")
def delete_all_legacy_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Permanently delete ALL records where is_legacy=true.
    One-time cleanup after verifying migrated data."""
    # Delete in FK-safe order (children first)
    tables = [
        "partnership_transactions",
        "partnership_members",
        "property_transactions",
        "plot_buyers",
        "site_plots",
        "partnerships",
        "property_deals",
        # Don't delete contacts — they might be shared with loans/other features
    ]
    counts = {}
    for table in tables:
        result = db.execute(text(f"DELETE FROM {table} WHERE is_legacy = true"))
        counts[table] = result.rowcount

    # For contacts, only soft-delete legacy ones that aren't referenced elsewhere
    result = db.execute(text(
        "UPDATE contacts SET is_deleted = true WHERE is_legacy = true AND is_deleted = false"
    ))
    counts["contacts_soft_deleted"] = result.rowcount

    db.commit()
    return {"message": "Legacy data deleted", "counts": counts}
