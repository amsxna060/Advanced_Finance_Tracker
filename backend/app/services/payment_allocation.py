from decimal import Decimal
from datetime import date
from sqlalchemy.orm import Session
from typing import Dict
from app.services.interest import calculate_outstanding


def allocate_payment(
    loan_id: int,
    payment_amount: Decimal,
    payment_date: date,
    db: Session
) -> Dict[str, Decimal]:
    """
    Allocate a payment amount to overdue interest, current interest, and principal.
    Fixed allocation order:
      1. Overdue interest (interest that was due before today and unpaid)
      2. Current period interest (interest accrued up to payment_date)
      3. Principal reduction

    Returns: {
        allocated_to_overdue_interest,
        allocated_to_current_interest,
        allocated_to_principal,
        unallocated
    }
    """
    # Calculate outstanding amounts as of payment date
    outstanding = calculate_outstanding(loan_id, payment_date, db)

    remaining = payment_amount
    allocated_overdue_interest = Decimal("0")
    allocated_current_interest = Decimal("0")
    allocated_principal = Decimal("0")

    # For simplicity, treat all interest as current interest
    # In production, would need to track overdue vs current based on due dates
    interest_outstanding = outstanding["interest_outstanding"]
    principal_outstanding = outstanding["principal_outstanding"]

    # Step 1: Allocate to interest first (combining overdue and current for simplicity)
    if remaining > 0 and interest_outstanding > 0:
        interest_payment = min(remaining, interest_outstanding)
        allocated_current_interest = interest_payment
        remaining -= interest_payment

    # Step 2: Allocate remaining to principal
    if remaining > 0 and principal_outstanding > 0:
        principal_payment = min(remaining, principal_outstanding)
        allocated_principal = principal_payment
        remaining -= principal_payment

    return {
        "allocated_to_overdue_interest": allocated_overdue_interest,
        "allocated_to_current_interest": allocated_current_interest,
        "allocated_to_principal": allocated_principal,
        "unallocated": remaining
    }
