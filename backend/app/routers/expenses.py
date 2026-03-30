from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.expense import Expense
from app.models.user import User
from app.schemas.expense import ExpenseCreate, ExpenseOut, ExpenseUpdate
from app.services.auto_ledger import auto_ledger, reverse_all_ledger
from app.models.cash_account import AccountTransaction
from decimal import Decimal

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


def _get_expense_or_404(expense_id: int, db: Session) -> Expense:
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.get("", response_model=List[ExpenseOut])
def get_expenses(
    category: Optional[str] = None,
    linked_type: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Expense)

    if category:
        query = query.filter(Expense.category == category)
    if linked_type:
        query = query.filter(Expense.linked_type == linked_type)
    if from_date:
        query = query.filter(Expense.expense_date >= from_date)
    if to_date:
        query = query.filter(Expense.expense_date <= to_date)

    return query.order_by(Expense.expense_date.desc(), Expense.id.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ExpenseOut)
def create_expense(
    expense_data: ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    expense = Expense(**expense_data.model_dump(), created_by=current_user.id)
    db.add(expense)
    db.flush()

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
        )

    db.commit()
    db.refresh(expense)
    return expense


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: int,
    expense_data: ExpenseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    expense = _get_expense_or_404(expense_id, db)
    old_account_id = expense.account_id
    old_amount = Decimal(str(expense.amount)) if expense.amount else Decimal("0")
    old_date = expense.expense_date

    update_data = expense_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(expense, field, value)

    # If amount, date, or account changed, update the ledger entry
    new_amount = Decimal(str(expense.amount)) if expense.amount else Decimal("0")
    if old_account_id and (old_amount != new_amount or old_date != expense.expense_date or old_account_id != expense.account_id):
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
            )

    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    expense = _get_expense_or_404(expense_id, db)
    # Reverse linked ledger entry
    reverse_all_ledger(db, "expense", expense.id)
    db.delete(expense)
    db.commit()
    return {"message": "Expense deleted successfully"}
