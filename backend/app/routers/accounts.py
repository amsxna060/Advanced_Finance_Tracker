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
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.dependencies import get_current_user, require_write_access
from app.models.cash_account import AccountTransaction, CashAccount
from app.models.user import User

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _d(v) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _current_balance(account: CashAccount) -> Decimal:
    """
    H-DI-7: For credit cards the balance semantics are inverted — a "debit"
    (spending) increases what you owe (reduces available credit), while a
    "credit" (payment) reduces what you owe (increases available credit).
    We expose balance as "outstanding balance" for credit cards:
      outstanding = sum(debits) - sum(credits)
    For all other account types the usual formula applies:
      balance = opening_balance + sum(credits) - sum(debits)
    """
    is_credit_card = getattr(account, "account_type", "") == "credit_card"
    if is_credit_card:
        # outstanding amount owed on the card
        # opening_balance for a credit card = amount already owed when the
        # account was added (was previously ignored entirely).
        outstanding = _d(account.opening_balance)
        for txn in account.transactions:
            if getattr(txn, "is_voided", False):
                continue
            if txn.txn_type == "debit":
                outstanding += _d(txn.amount)
            else:
                outstanding -= _d(txn.amount)
        return outstanding
    else:
        balance = _d(account.opening_balance)
        for txn in account.transactions:
            if getattr(txn, "is_voided", False):
                continue
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
        "credit_limit": _d(account.credit_limit) if account.credit_limit is not None else None,
        "billing_cycle_date": account.billing_cycle_date,
        "notes": account.notes,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }
    if include_transactions:
        result["transactions"] = [
            _txn_dict(t) for t in account.transactions
            if not getattr(t, "is_voided", False)
        ]
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
        "source_type": getattr(txn, "source_type", None),
        "source_id": getattr(txn, "source_id", None),
        "reference_number": txn.reference_number,
        "payment_mode": txn.payment_mode,
        "is_voided": bool(getattr(txn, "is_voided", False)),
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
    accounts = (db.query(CashAccount).filter(CashAccount.is_deleted == False)
                .options(selectinload(CashAccount.transactions))
                .order_by(CashAccount.name).all())
    return [_account_dict(a) for a in accounts]


@router.post("", response_model=dict)
def create_account(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
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
        credit_limit=Decimal(str(payload["credit_limit"])) if payload.get("credit_limit") is not None else None,
        billing_cycle_date=payload.get("billing_cycle_date"),
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
    current_user: User = Depends(require_write_access),
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
        new_ob = Decimal(str(payload["opening_balance"]))
        old_ob = Decimal(str(account.opening_balance or 0))
        if new_ob != old_ob:
            # Apply the correction ONCE: update opening_balance only.
            # (Previously this ALSO posted a balance_adjustment ledger entry for
            # the delta — since balance = opening + credits − debits, the change
            # was applied twice. The audit trail lives in account.notes instead.)
            audit_note = f"[Opening balance adjusted from {old_ob} to {new_ob} on {date.today()}]"
            account.notes = ((account.notes or "").rstrip() + "\n" + audit_note).strip()
            account.opening_balance = new_ob
    if "credit_limit" in payload:
        account.credit_limit = Decimal(str(payload["credit_limit"])) if payload["credit_limit"] is not None else None
    if "billing_cycle_date" in payload:
        account.billing_cycle_date = payload["billing_cycle_date"]

    db.commit()
    db.refresh(account)
    return _account_dict(account)


@router.delete("/{account_id}", response_model=dict)
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    account = db.query(CashAccount).filter(
        CashAccount.id == account_id, CashAccount.is_deleted == False
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    # C-FIN-8: soft-delete transactions instead of hard-deleting them
    # Hard delete destroys audit trail needed for reconciliation.
    db.query(AccountTransaction).filter(
        AccountTransaction.account_id == account_id,
        AccountTransaction.is_voided == False,
    ).update({"is_voided": True}, synchronize_session=False)
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
    include_voided: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.query(CashAccount).filter(
        CashAccount.id == account_id, CashAccount.is_deleted == False
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    q = db.query(AccountTransaction).filter(AccountTransaction.account_id == account_id)
    if not include_voided:
        q = q.filter(AccountTransaction.is_voided == False)
    # H-DI-8: add id as tiebreaker to make ordering deterministic for same-day transactions
    txns = q.order_by(AccountTransaction.txn_date.desc(), AccountTransaction.id.desc()).limit(limit).all()
    return [_txn_dict(t) for t in txns]


@router.post("/{account_id}/transactions", response_model=dict)
def add_transaction(
    account_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
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

    # C-FIN-9 / C-FIN-10: amount must be strictly positive
    raw_amount = payload.get("amount")
    try:
        dec_amount = Decimal(str(raw_amount))
    except Exception:
        raise HTTPException(status_code=422, detail="amount must be a valid number")
    if dec_amount <= Decimal("0"):
        raise HTTPException(status_code=422, detail="amount must be greater than zero")

    # C-VAL-3: restrict linked_type to known values to prevent arbitrary string injection
    ALLOWED_LINKED_TYPES = {None, "loan", "property", "partnership", "expense", "beesi",
                            "transfer", "obligation", "balance_adjustment", "recurring"}
    linked_type = payload.get("linked_type")
    if linked_type not in ALLOWED_LINKED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"linked_type must be one of: {sorted(t for t in ALLOWED_LINKED_TYPES if t)}",
        )

    txn = AccountTransaction(
        account_id=account_id,
        txn_type=payload["txn_type"],
        amount=dec_amount,
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


@router.post("/transfer", response_model=dict)
def transfer_between_accounts(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    from_id = payload.get("from_account_id")
    to_id = payload.get("to_account_id")
    amount = payload.get("amount")
    txn_date_str = payload.get("txn_date")
    description = payload.get("description", "Transfer")

    if not all([from_id, to_id, amount, txn_date_str]):
        raise HTTPException(
            status_code=422,
            detail="Missing required fields: from_account_id, to_account_id, amount, txn_date",
        )
    if from_id == to_id:
        raise HTTPException(status_code=422, detail="Cannot transfer to the same account")

    # C-FIN-10: amount must be strictly positive
    try:
        transfer_amount = Decimal(str(amount))
    except Exception:
        raise HTTPException(status_code=422, detail="amount must be a valid number")
    if transfer_amount <= Decimal("0"):
        raise HTTPException(status_code=422, detail="Transfer amount must be greater than zero")

    from_account = (
        db.query(CashAccount)
        .filter(CashAccount.id == from_id, CashAccount.is_deleted == False)
        .first()
    )
    to_account = (
        db.query(CashAccount)
        .filter(CashAccount.id == to_id, CashAccount.is_deleted == False)
        .first()
    )
    if not from_account:
        raise HTTPException(status_code=404, detail="Source account not found")
    if not to_account:
        raise HTTPException(status_code=404, detail="Destination account not found")

    try:
        txn_date = date.fromisoformat(txn_date_str)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid txn_date format, expected YYYY-MM-DD")

    debit = AccountTransaction(
        account_id=from_id,
        txn_type="debit",
        amount=transfer_amount,
        txn_date=txn_date,
        description=f"Transfer to {to_account.name}: {description}",
        linked_type="transfer",
        created_by=current_user.id,
    )
    credit = AccountTransaction(
        account_id=to_id,
        txn_type="credit",
        amount=transfer_amount,
        txn_date=txn_date,
        description=f"Transfer from {from_account.name}: {description}",
        linked_type="transfer",
        created_by=current_user.id,
    )
    db.add(debit)
    db.add(credit)
    db.commit()
    db.refresh(debit)
    db.refresh(credit)
    return {"debit": _txn_dict(debit), "credit": _txn_dict(credit), "message": "Transfer successful"}


# Module-managed rows the ledger side cannot safely cascade — deleting them
# here would desync the module's own totals/status, so direct the admin to the
# owning page instead (force=true overrides for emergency cleanup).
_BLOCKED_SOURCE_GUIDANCE = {
    "loan_disbursement": "edit or delete the loan itself (Loans page)",
    "partnership_txn": "delete the transaction on the Partnership page",
    "beesi_installment": "delete the installment on the Beesi page",
    "beesi_withdrawal": "delete the withdrawal on the Beesi page",
    "obligation_create": "delete the obligation (Obligations page)",
    "obligation_settlement": "delete the settlement on the Obligations page",
}
_LEGACY_MODULE_LINKED = {"loan", "partnership", "property", "beesi", "obligation"}


@router.delete("/transactions/{txn_id}", response_model=dict)
def void_transaction(
    txn_id: int,
    force: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access),
):
    """Soft-void a transaction with two-way sync back to the source record.

    - loan payments  → the payment is voided too (loan reopens, later
      payments re-allocated)
    - expenses       → the expense is soft-deleted too
    - other module-managed rows → 409 directing to the owning page
      (pass ?force=true to void just the ledger row anyway — the module's own
      record is then intentionally left untouched)
    - manual / transfer / adjustment rows → plain void
    """
    txn = db.query(AccountTransaction).filter(
        AccountTransaction.id == txn_id,
        AccountTransaction.is_voided == False,
    ).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # ── Cascades (two-way sync) ──────────────────────────────────────────
    if txn.source_type == "loan_payment" and txn.source_id:
        from app.models.loan import Loan, LoanPayment
        from app.services.loan_void import void_loan_payment
        payment = db.query(LoanPayment).filter(
            LoanPayment.id == txn.source_id,
            LoanPayment.is_voided == False,
        ).first()
        loan = db.query(Loan).filter(Loan.id == payment.loan_id).first() if payment else None
        if payment and loan:
            # void_ledger=True voids this very row via the source link
            void_loan_payment(db, loan, payment, void_ledger=True)
            db.commit()
            return {"message": "Transaction voided; linked loan payment voided too",
                    "id": txn_id, "cascaded": "loan_payment", "payment_id": payment.id}
        txn.is_voided = True  # source already gone — just void the row
        db.commit()
        return {"message": "Transaction voided", "id": txn_id}

    if txn.source_type == "expense" and txn.source_id:
        from app.models.expense import Expense
        from app.services.auto_ledger import reverse_all_ledger
        expense = db.query(Expense).filter(
            Expense.id == txn.source_id, Expense.is_deleted == False,
        ).first()
        if expense:
            expense.is_deleted = True
            reverse_all_ledger(db, "expense", expense.id)
            db.commit()
            return {"message": "Transaction voided; linked expense deleted too",
                    "id": txn_id, "cascaded": "expense", "expense_id": expense.id}
        txn.is_voided = True
        db.commit()
        return {"message": "Transaction voided", "id": txn_id}

    # ── Blocked module-managed rows ──────────────────────────────────────
    blocked_reason = None
    if txn.source_type in _BLOCKED_SOURCE_GUIDANCE:
        blocked_reason = _BLOCKED_SOURCE_GUIDANCE[txn.source_type]
    elif txn.source_type is None and txn.linked_type in _LEGACY_MODULE_LINKED:
        blocked_reason = f"manage it from the {txn.linked_type} page"
    if blocked_reason and not force:
        raise HTTPException(
            status_code=409,
            detail=f"This entry is managed by its source record — {blocked_reason}. "
                   "Voiding only the ledger row would desync the module's totals. "
                   "Add ?force=true to void it here anyway.",
        )

    txn.is_voided = True
    db.commit()
    return {"message": "Transaction voided", "id": txn_id,
            "forced": bool(blocked_reason and force)}
