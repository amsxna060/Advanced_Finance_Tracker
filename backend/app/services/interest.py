from decimal import Decimal
from datetime import date, timedelta
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from app.models.loan import Loan, LoanPayment, LoanCapitalizationEvent


def calculate_outstanding(loan_id: int, as_of_date: date, db: Session) -> Dict[str, Decimal]:
    """
    Calculate the outstanding principal and interest for a loan as of a specific date.
    Returns: {principal_outstanding, interest_outstanding, total_outstanding}
    """
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        raise ValueError("Loan not found")

    # Start with original principal
    principal_outstanding = Decimal(str(loan.principal_amount))

    # Apply all capitalization events (increases principal, resets interest calculation)
    cap_events = db.query(LoanCapitalizationEvent).filter(
        LoanCapitalizationEvent.loan_id == loan_id,
        LoanCapitalizationEvent.event_date <= as_of_date
    ).order_by(LoanCapitalizationEvent.event_date).all()

    last_cap_date = loan.disbursed_date
    current_rate = Decimal(str(loan.interest_rate or 0))

    for event in cap_events:
        principal_outstanding = Decimal(str(event.new_principal))
        last_cap_date = event.event_date
        if event.interest_rate_after:
            current_rate = Decimal(str(event.interest_rate_after))

    # Get all payments
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan_id,
        LoanPayment.payment_date <= as_of_date
    ).order_by(LoanPayment.payment_date).all()

    # Subtract all principal payments
    for payment in payments:
        principal_outstanding -= Decimal(str(payment.allocated_to_principal))

    # Calculate interest
    interest_outstanding = Decimal("0")

    # For interest calculation, we need to track principal changes over time
    # Simplified approach: calculate daily interest from last_cap_date to as_of_date
    # accounting for principal reductions from payments

    if loan.loan_type == "short_term" and loan.interest_free_till:
        # Interest only starts after interest_free_till date
        if as_of_date <= loan.interest_free_till:
            interest_outstanding = Decimal("0")
        else:
            # Calculate from interest_free_till + 1 day to as_of_date
            interest_start = loan.interest_free_till + timedelta(days=1)
            rate_to_use = Decimal(str(loan.post_due_interest_rate or 0))
            days = (as_of_date - interest_start).days + 1
            if days > 0:
                interest_outstanding = principal_outstanding * (rate_to_use / Decimal("100") / Decimal("12") / Decimal("30")) * Decimal(str(days))
    else:
        # Regular interest calculation
        interest_start = loan.interest_start_date or loan.disbursed_date
        if as_of_date >= interest_start:
            # Calculate from interest_start to as_of_date
            # For simplicity, using current principal and rate
            # In production, would need to account for principal changes over time
            days = (as_of_date - max(interest_start, last_cap_date)).days + 1
            if days > 0:
                daily_rate = current_rate / Decimal("100") / Decimal("12") / Decimal("30")
                interest_outstanding = principal_outstanding * daily_rate * Decimal(str(days))

    # Subtract all interest payments
    for payment in payments:
        interest_outstanding -= Decimal(str(payment.allocated_to_overdue_interest))
        interest_outstanding -= Decimal(str(payment.allocated_to_current_interest))

    # Ensure non-negative
    principal_outstanding = max(principal_outstanding, Decimal("0"))
    interest_outstanding = max(interest_outstanding, Decimal("0"))

    return {
        "principal_outstanding": principal_outstanding,
        "interest_outstanding": interest_outstanding,
        "total_outstanding": principal_outstanding + interest_outstanding,
        "as_of_date": as_of_date
    }


def generate_emi_schedule(loan: Loan) -> List[Dict[str, Any]]:
    """
    Generate expected EMI schedule for EMI-type loans.
    Returns list of {due_date, due_amount, status}
    """
    if loan.loan_type != "emi" or not loan.tenure_months or not loan.emi_amount:
        return []

    schedule = []
    current_date = loan.disbursed_date
    emi_day = loan.emi_day_of_month or 1

    for i in range(loan.tenure_months):
        # Calculate due date for this EMI
        # Move to next month
        if i == 0:
            # First EMI
            due_date = date(current_date.year, current_date.month, emi_day)
            if due_date < current_date:
                # Move to next month if emi_day already passed
                if current_date.month == 12:
                    due_date = date(current_date.year + 1, 1, emi_day)
                else:
                    due_date = date(current_date.year, current_date.month + 1, emi_day)
        else:
            # Subsequent EMIs
            month = due_date.month
            year = due_date.year
            if month == 12:
                due_date = date(year + 1, 1, emi_day)
            else:
                due_date = date(year, month + 1, emi_day)

        schedule.append({
            "emi_number": i + 1,
            "due_date": due_date,
            "due_amount": loan.emi_amount,
            "status": "pending"  # Would need to check payments to determine actual status
        })

    return schedule


def check_capitalization_due(loan: Loan, db: Session) -> Dict[str, Any]:
    """
    Check if capitalization is due for a loan.
    Returns: {is_due: bool, months_since_last_payment: int, outstanding_interest: Decimal}
    """
    if not loan.capitalization_enabled or not loan.capitalization_after_months:
        return {"is_due": False, "months_since_last_payment": 0, "outstanding_interest": Decimal("0")}

    # Get last payment or capitalization date
    last_payment = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan.id
    ).order_by(LoanPayment.payment_date.desc()).first()

    last_cap_event = db.query(LoanCapitalizationEvent).filter(
        LoanCapitalizationEvent.loan_id == loan.id
    ).order_by(LoanCapitalizationEvent.event_date.desc()).first()

    reference_date = loan.disbursed_date
    if last_cap_event:
        reference_date = max(reference_date, last_cap_event.event_date)
    if last_payment:
        reference_date = max(reference_date, last_payment.payment_date)

    # Calculate months since reference date
    today = date.today()
    months_diff = (today.year - reference_date.year) * 12 + (today.month - reference_date.month)

    # Check if capitalization is due
    is_due = months_diff >= loan.capitalization_after_months

    # Calculate outstanding interest
    outstanding = calculate_outstanding(loan.id, today, db)

    return {
        "is_due": is_due,
        "months_since_last_action": months_diff,
        "outstanding_interest": outstanding["interest_outstanding"],
        "reference_date": reference_date
    }
