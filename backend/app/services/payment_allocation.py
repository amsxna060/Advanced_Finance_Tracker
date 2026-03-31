from decimal import Decimal
from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Dict
from app.models.loan import Loan, LoanPayment
from app.services.interest import calculate_outstanding, generate_emi_schedule


def allocate_payment(
    loan_id: int,
    payment_amount: Decimal,
    payment_date: date,
    db: Session,
    principal_repayment: Decimal = None,
    auto_split: bool = False,
) -> Dict[str, Decimal]:
    """
    Allocate a payment amount to overdue interest, current interest, and principal.

    For EMI loans:
      Uses carry-forward credit balance approach.
      Clears overdue EMI balance first, then any excess stored as current.

        For interest_only and short_term loans:
            Default allocation order:
                1. All outstanding interest (combined overdue + current)
                2. Principal reduction
            Override:
                If `principal_repayment` is explicitly provided, that portion is
                applied to principal first, then remaining amount follows default rules.

    Returns: {
        allocated_to_overdue_interest,
        allocated_to_current_interest,
        allocated_to_principal,
        unallocated
    }
    """
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        return {
            "allocated_to_overdue_interest": Decimal("0"),
            "allocated_to_current_interest": Decimal("0"),
            "allocated_to_principal": Decimal("0"),
            "unallocated": payment_amount,
        }

    if loan.loan_type == "emi":
        # For EMI loans: use carry-forward logic
        schedule = generate_emi_schedule(loan)
        if not schedule:
            # No schedule — treat entire payment as current
            return {
                "allocated_to_overdue_interest": Decimal("0"),
                "allocated_to_current_interest": payment_amount,
                "allocated_to_principal": Decimal("0"),
                "unallocated": Decimal("0"),
            }

        emi_amount = Decimal(str(loan.emi_amount))

        # Total EMIs due up to and including payment_date
        emis_due_count = sum(1 for e in schedule if e["due_date"] <= payment_date)
        total_due = emi_amount * emis_due_count

        # Payments made BEFORE the current payment (exclude same-date current payment),
        # ordered by payment ID to ensure deterministic allocation on same-day payments
        previous_total = db.query(func.sum(LoanPayment.amount_paid)).filter(
            LoanPayment.loan_id == loan_id,
            LoanPayment.payment_date < payment_date,
        ).scalar() or Decimal("0")
        previous_total = Decimal(str(previous_total))

        overdue_emi_balance = max(total_due - previous_total, Decimal("0"))
        remaining = payment_amount
        allocated_overdue = Decimal("0")
        allocated_current = Decimal("0")
        allocated_principal = Decimal("0")

        # Clear overdue EMI balance first (stored as overdue_interest for tracking)
        if remaining > 0 and overdue_emi_balance > 0:
            pay = min(remaining, overdue_emi_balance)
            allocated_overdue = pay
            remaining -= pay

        # Any excess goes towards future EMIs (stored as current_interest)
        if remaining > 0:
            allocated_current = remaining
            remaining = Decimal("0")

        return {
            "allocated_to_overdue_interest": allocated_overdue,
            "allocated_to_current_interest": allocated_current,
            "allocated_to_principal": allocated_principal,
            "unallocated": remaining,
        }

    else:
        outstanding = calculate_outstanding(loan_id, payment_date, db)
        interest_outstanding = outstanding["interest_outstanding"]
        principal_outstanding = outstanding["principal_outstanding"]

        remaining = payment_amount
        allocated_overdue = Decimal("0")
        allocated_current = Decimal("0")
        allocated_principal = Decimal("0")

        explicit_principal = (
            principal_repayment
            if principal_repayment is not None and principal_repayment > Decimal("0")
            else Decimal("0")
        )

        # If caller explicitly marks principal repayment, honor it first.
        # This avoids forcing interest-first in explicit principal scenarios.
        if explicit_principal > Decimal("0") and remaining > Decimal("0") and principal_outstanding > Decimal("0"):
            principal_payment = min(explicit_principal, remaining, principal_outstanding)
            allocated_principal = principal_payment
            remaining -= principal_payment

        # For the rest of payment, default rule remains interest-first.
        if remaining > 0 and interest_outstanding > 0:
            interest_payment = min(remaining, interest_outstanding)
            allocated_current = interest_payment
            remaining -= interest_payment

        if loan.loan_type == "interest_only":
            # Auto-split: excess after interest goes to principal reduction
            if auto_split and remaining > Decimal("0") and principal_outstanding > Decimal("0"):
                principal_payment = min(remaining, principal_outstanding)
                allocated_principal += principal_payment
                remaining -= principal_payment
            # Manual mode: excess acts as advance credit
            if remaining > Decimal("0"):
                allocated_current += remaining
                remaining = Decimal("0")
        else:
            # short_term: remaining after interest reduces principal.
            if remaining > 0 and principal_outstanding > 0:
                principal_payment = min(remaining, principal_outstanding)
                allocated_principal += principal_payment
                remaining -= principal_payment

        return {
            "allocated_to_overdue_interest": allocated_overdue,
            "allocated_to_current_interest": allocated_current,
            "allocated_to_principal": allocated_principal,
            "unallocated": remaining,
        }
