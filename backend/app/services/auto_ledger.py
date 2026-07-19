"""
Shared helper for auto-creating AccountTransaction entries when money moves,
and reversing / cleaning up those entries on update or delete.
"""
from decimal import Decimal
from datetime import date as date_type

from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.models.cash_account import AccountTransaction, CashAccount


def auto_ledger(
    db: Session,
    account_id: int,
    txn_type: str,          # "credit" | "debit"
    amount: Decimal,
    txn_date: date_type,
    linked_type: str,       # loan | property | partnership | beesi | expense | obligation
    linked_id: int,
    description: str,
    payment_mode: str | None = None,
    contact_id: int | None = None,
    created_by: int | None = None,
    source_type: str | None = None,   # exact creator, e.g. "loan_payment"
    source_id: int | None = None,     # id of that record
) -> AccountTransaction:
    """Create an AccountTransaction entry linked to a source module.

    Pass source_type/source_id whenever the entry is created by a specific
    record — reversals then match exactly instead of by (type, amount, date).
    """
    # Tenancy chokepoint: every module posts ledger rows through here, so this
    # single lookup blocks any payload referencing another tenant's account.
    # The query runs under the automatic tenant filter (app/tenancy.py) —
    # other tenants' accounts are simply invisible and resolve to 404.
    account = db.query(CashAccount).filter(CashAccount.id == account_id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    txn = AccountTransaction(
        account_id=account_id,
        txn_type=txn_type,
        amount=amount,
        txn_date=txn_date,
        description=description,
        linked_type=linked_type,
        linked_id=linked_id,
        contact_id=contact_id,
        payment_mode=payment_mode,
        created_by=created_by,
        source_type=source_type,
        source_id=source_id,
    )
    db.add(txn)
    return txn


def reverse_ledger_by_source(db: Session, source_type: str, source_id: int) -> int:
    """Void all live ledger rows created by the given source record.

    Returns the number of rows voided — 0 means the row predates migration 042
    (no source stamp); callers should fall back to their legacy heuristic match.
    """
    rows = db.query(AccountTransaction).filter(
        AccountTransaction.source_type == source_type,
        AccountTransaction.source_id == source_id,
        AccountTransaction.is_voided == False,
    ).all()
    for r in rows:
        r.is_voided = True
    return len(rows)


def reverse_all_ledger(
    db: Session,
    linked_type: str,
    linked_id: int,
) -> int:
    """Soft-delete (void) ALL AccountTransaction entries for a given linked_type + linked_id.

    C-FIN-7/C-FIN-8: Previously used db.delete() which hard-deleted audit trail rows.
    Now sets is_voided=True so reconciliation and audit reports can still see
    the history. Returns the count of rows voided."""
    rows = db.query(AccountTransaction).filter(
        AccountTransaction.linked_type == linked_type,
        AccountTransaction.linked_id == linked_id,
        AccountTransaction.is_voided == False,
    ).all()
    for r in rows:
        r.is_voided = True
    return len(rows)


def reverse_ledger_match(
    db: Session,
    linked_type: str,
    linked_id: int,
    txn_type: str,
    amount: Decimal,
    txn_date: date_type,
) -> int:
    """Delete AccountTransaction entries matching linked_type/id + txn_type + amount + date.
    Useful when multiple entries exist for the same linked entity (e.g. separate installments).
    Returns the count of rows deleted."""
    rows = db.query(AccountTransaction).filter(
        AccountTransaction.linked_type == linked_type,
        AccountTransaction.linked_id == linked_id,
        AccountTransaction.txn_type == txn_type,
        AccountTransaction.amount == amount,
        AccountTransaction.txn_date == txn_date,
    ).all()
    for r in rows:
        db.delete(r)
    return len(rows)
