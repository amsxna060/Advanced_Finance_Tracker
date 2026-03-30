"""
Cash / Bank Account router.

Endpoints:
  GET    /api/accounts                          – list all accounts with current balance
  POST   /api/accounts                          – create account
  GET    /api/accounts/{id}                     – detail with ledger + running balance
  PUT    /api/accounts/{id}                     – update
  DELETE /api/accounts/{id}                     – soft delete
  POST   /api/accounts/{id}/transactions        – record debit/credit
  GET    /api/accounts/{id}/transactions        – list transactions
  DELETE /api/accounts/transactions/{txn_id}    – delete transaction
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.cash_account import AccountTransaction, CashAccount
from app.models.user import User

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _d(v) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _current_balance(account: CashAccount) -> Decimal:
    balance = _d(account.opening_balance)
    for txn in account.transactions:
        if txn.txn_type == "credit":
            balance += _d(txn.amount)
        else:
            balance -= _d(txn.amount)
    return balance


def _account_dict(account: CashAccount, include_transactions: bool = False) -> dict:
    result = {
        "id": account.id,
        "name": account.name,
        "account_type": account.account_type,
        "bank_name": account.bank_name,
        "account_number": account.account_number,
        "opening_balance": _d(account.opening_balance),
        "current_balance": _current_balance(account),
        "notes": account.notes,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }
    if include_transactions:
        result["transactions"] = [_txn_dict(t) for t in account.transactions]
    return result


def _txn_dict(txn: AccountTransaction) -> dict:
    return {
        "id": txn.id,
        "account_id": txn.account_id,
        "txn_type": txn.txn_type,
        "amount": _d(txn.amount),
        "txn_date": txn.txn_date.isoformat() if txn.txn_date else None,
        "description": txn.description,
        "linked_type": txn.linked_type,
        "linked_id": txn.linked_id,
        "reference_number": txn.reference_number,
        "payment_mode": txn.payment_mode,
        "created_at": txn.created_at.isoformat() if txn.created_at else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ACCOUNTS
# ─────────────────────────────────────────────────────────────────────────────


@router.get("", response_model=list)
def list_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    accounts = db.query(CashAccount).filter(CashAccount.is_deleted == False).order_by(CashAccount.name).all()
    return [_account_dict(a) for a in accounts]


@router.post("", response_model=dict)
def create_account(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not payload.get("name"):
        raise HTTPException(status_code=422, detail="Account name is required")
    if not payload.get("account_type"):
        raise HTTPException(status_code=422, detail="account_type is required")

    account = CashAccount(
        name=payload["name"],
        account_type=payload["account_type"],
        bank_name=payload.get("bank_name"),
        account_number=payload.get("account_number"),
        opening_balance=Decimal(str(payload.get("opening_balance", 0))),
        notes=payload.get("notes"),
        created_by=current_user.id,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return _account_dict(account)


@router.get("/{account_id}", response_model=dict)
def get_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.query(CashAccount).filter(
        CashAccount.id == account_id, CashAccount.is_deleted == False
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return _account_dict(account, include_transactions=True)


@router.put("/{account_id}", response_model=dict)
def update_account(
    account_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    account = db.query(CashAccount).filter(
        CashAccount.id == account_id, CashAccount.is_deleted == False
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    for field in ["name", "account_type", "bank_name", "account_number", "notes"]:
        if field in payload:
            setattr(account, field, payload[field])
    if "opening_balance" in payload:
        account.opening_balance = Decimal(str(payload["opening_balance"]))

    db.commit()
    db.refresh(account)
    return _account_dict(account)


@router.delete("/{account_id}", response_model=dict)
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    account = db.query(CashAccount).filter(
        CashAccount.id == account_id, CashAccount.is_deleted == False
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    # Delete all transactions for this account to prevent orphaned ledger entries
    db.query(AccountTransaction).filter(
        AccountTransaction.account_id == account_id,
    ).delete(synchronize_session=False)
    account.is_deleted = True
    db.commit()
    return {"message": "Account deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# TRANSACTIONS
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/{account_id}/transactions", response_model=list)
def list_transactions(
    account_id: int,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.query(CashAccount).filter(
        CashAccount.id == account_id, CashAccount.is_deleted == False
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    txns = (
        db.query(AccountTransaction)
        .filter(AccountTransaction.account_id == account_id)
        .order_by(AccountTransaction.txn_date.desc())
        .limit(limit)
        .all()
    )
    return [_txn_dict(t) for t in txns]


@router.post("/{account_id}/transactions", response_model=dict)
def add_transaction(
    account_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.query(CashAccount).filter(
        CashAccount.id == account_id, CashAccount.is_deleted == False
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    for field in ["txn_type", "amount", "txn_date"]:
        if field not in payload:
            raise HTTPException(status_code=422, detail=f"Missing required field: {field}")

    if payload["txn_type"] not in ("credit", "debit"):
        raise HTTPException(status_code=422, detail="txn_type must be 'credit' or 'debit'")

    txn = AccountTransaction(
        account_id=account_id,
        txn_type=payload["txn_type"],
        amount=Decimal(str(payload["amount"])),
        txn_date=date.fromisoformat(payload["txn_date"]),
        description=payload.get("description"),
        linked_type=payload.get("linked_type"),
        linked_id=payload.get("linked_id"),
        reference_number=payload.get("reference_number"),
        payment_mode=payload.get("payment_mode"),
        created_by=current_user.id,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return _txn_dict(txn)


@router.delete("/transactions/{txn_id}", response_model=dict)
def delete_transaction(
    txn_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    txn = db.query(AccountTransaction).filter(AccountTransaction.id == txn_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(txn)
    db.commit()
    return {"message": "Transaction deleted"}
