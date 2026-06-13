"""Shared loan-payment void logic.

Used by both DELETE /loans/{id}/payments/{pid} (module side) and
DELETE /accounts/transactions/{txn_id} (ledger side, two-way sync) so the
two paths can never diverge: ledger reversal, loan reopen, payment void,
and re-allocation of later payments all happen in one place.
"""
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.loan import Loan, LoanPayment
from app.models.cash_account import AccountTransaction
from app.services.auto_ledger import reverse_ledger_by_source
from app.services.payment_allocation import allocate_payment


def void_loan_payment(db: Session, loan: Loan, payment: LoanPayment, *,
                      void_ledger: bool = True) -> None:
    """Void a payment and restore full consistency. Does NOT commit."""
    if void_ledger:
        # Exact source match first; legacy rows (pre-042) fall back to the
        # old heuristic (C-FIN-6: first live match only).
        if reverse_ledger_by_source(db, "loan_payment", payment.id) == 0:
            acct_id = payment.account_id or loan.account_id
            if acct_id:
                direction = loan.loan_direction
                matching = db.query(AccountTransaction).filter(
                    AccountTransaction.linked_type == "loan",
                    AccountTransaction.linked_id == loan.id,
                    AccountTransaction.txn_type == ("credit" if direction == "given" else "debit"),
                    AccountTransaction.amount == payment.amount_paid,
                    AccountTransaction.txn_date == payment.payment_date,
                    AccountTransaction.is_voided == False,
                ).first()
                if matching:
                    matching.is_voided = True

    # H-DI-15: preserve actual_end_date in notes before clearing it so the
    # original close date is not lost from the audit trail.
    if loan.status == "closed" and loan.actual_end_date:
        close_note = f"[Voided payment on {payment.payment_date}; loan was closed on {loan.actual_end_date}]"
        loan.notes = ((loan.notes or "").rstrip() + "\n" + close_note).strip()
        loan.status = "active"
        loan.actual_end_date = None
    elif loan.status == "closed":
        loan.status = "active"
        loan.actual_end_date = None

    payment.is_voided = True
    db.flush()

    # Re-allocate payments recorded AFTER the voided one: their interest/principal
    # split was computed against an outstanding that included the voided money.
    reallocate_payments_from(db, loan, payment.payment_date, inclusive=True)


def reallocate_payments_from(db: Session, loan: Loan, from_date, *,
                             inclusive: bool = False) -> int:
    """Re-run allocation for live payments dated after `from_date` (or on it,
    when inclusive=True), in chronological order. Used when history changes
    under them: a payment was voided, or a backdated payment was inserted.
    (EMI allocation is proportional and order-independent — skipped.)
    Does NOT commit. Returns the number of payments re-allocated."""
    if loan.loan_type not in ("interest_only", "short_term"):
        return 0
    q = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan.id,
        LoanPayment.is_voided == False,
    )
    if inclusive:
        q = q.filter(LoanPayment.payment_date >= from_date)
    else:
        q = q.filter(LoanPayment.payment_date > from_date)
    later_payments = q.order_by(LoanPayment.payment_date.asc(), LoanPayment.id.asc()).all()
    for lp in later_payments:
        # Temporarily void so calculate_outstanding doesn't see lp's own
        # stale allocation while recomputing (mirrors record_payment, where
        # allocation happens before the row exists).
        lp.is_voided = True
        db.flush()
        penalty = Decimal(str(lp.penalty_paid or 0))
        alloc_amount = max(Decimal(str(lp.amount_paid)) - penalty, Decimal("0"))
        realloc = allocate_payment(loan.id, alloc_amount, lp.payment_date, db)
        lp.allocated_to_overdue_interest = realloc["allocated_to_overdue_interest"]
        lp.allocated_to_current_interest = realloc["allocated_to_current_interest"]
        lp.allocated_to_principal = realloc["allocated_to_principal"]
        lp.is_voided = False
        db.flush()
    return len(later_payments)
