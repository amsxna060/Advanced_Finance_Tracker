from decimal import Decimal
from datetime import date
from sqlalchemy.orm import Session
from typing import Dict
from app.models.loan import Loan, LoanPayment
from app.services.interest import calculate_outstanding


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
      Proportional split: interest_ratio = total_lifetime_interest / total_repayment.
      allocated_to_current_interest = payment × interest_ratio (rounded to 0.01)
      allocated_to_principal = payment - allocated_to_current_interest
      EMI schedule tracking uses amount_paid/penalty_paid directly — not these fields.

    For interest_only loans (simplified 2x rule):
      monthly_estimate = principal_outstanding * annual_rate / 1200
      if payment < 2 * monthly_estimate  → entire payment = interest only (no principal)
      if payment >= 2 * monthly_estimate  → clear all accrued interest, remainder → principal
      Auto-close triggered in the router when principal reaches 0.

    For short_term loans:
      Interest first, then principal; any surplus = additional profit → current_interest.

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
        # Proportional interest/principal split based on embedded rate.
        # The EMI schedule tracking (which EMIs are overdue) uses amount_paid
        # directly in get_emi_schedule_with_payments — allocation fields are
        # free to carry the economically correct interest/principal split.
        principal = Decimal(str(loan.principal_amount or 0))
        emi_amount = Decimal(str(loan.emi_amount or 0))
        tenure = int(loan.tenure_months or 0)

        # H-FIN-24: if caller provides an explicit principal_repayment override,
        # honour it — the rest of the payment goes to interest.
        if principal_repayment is not None and principal_repayment >= Decimal("0"):
            allocated_principal = min(principal_repayment, payment_amount).quantize(Decimal("0.01"))
            allocated_current = (payment_amount - allocated_principal).quantize(Decimal("0.01"))
        elif emi_amount > 0 and tenure > 0 and principal > 0:
            total_repayment = emi_amount * Decimal(str(tenure))
            total_interest = max(total_repayment - principal, Decimal("0"))
            interest_ratio = total_interest / total_repayment
            allocated_current = (payment_amount * interest_ratio).quantize(Decimal("0.01"))
            allocated_principal = payment_amount - allocated_current
        else:
            # H-FIN-21: malformed loan — cannot safely split the payment.
            # Surface an error so the caller can fix the loan config rather
            # than silently booking the full amount as interest.
            raise ValueError(
                f"Loan {loan_id} has emi_amount={loan.emi_amount}, "
                f"tenure_months={loan.tenure_months}, "
                f"principal_amount={loan.principal_amount}. "
                "Cannot allocate payment without a valid schedule. "
                "Please configure EMI amount and tenure before recording payments."
            )

        return {
            "allocated_to_overdue_interest": Decimal("0"),
            "allocated_to_current_interest": allocated_current,
            "allocated_to_principal": allocated_principal,
            "unallocated": Decimal("0"),
        }

    elif loan.loan_type == "interest_only":
        # Simplified 2x-rule for interest-only loans.
        # principal_repayment and auto_split are ignored here.
        outstanding = calculate_outstanding(loan_id, payment_date, db)
        interest_outstanding = outstanding["interest_outstanding"]
        principal_outstanding = outstanding["principal_outstanding"]
        annual_rate = Decimal(str(loan.interest_rate or 0))

        # Monthly interest estimate (for the 2x threshold check)
        # H-FIN-23: use the original principal_amount (not live outstanding) to make
        # the threshold deterministic — concurrent calls can observe different
        # outstanding values if payments are in flight simultaneously.
        base_principal = Decimal(str(loan.principal_amount or principal_outstanding))
        monthly_estimate = (base_principal * annual_rate / Decimal("1200")).quantize(Decimal("0.01"))
        threshold = monthly_estimate * Decimal("2")

        allocated_overdue = Decimal("0")
        allocated_current = Decimal("0")
        allocated_principal = Decimal("0")
        unallocated = Decimal("0")

        if payment_amount < threshold:
            # Small payment: if there's outstanding interest, allocate to interest.
            # H-FIN-22: if interest_outstanding is 0, route to principal instead of
            # artificially inflating interest — loan should reduce.
            if interest_outstanding > Decimal("0"):
                allocated_current = min(payment_amount, interest_outstanding)
                remainder = payment_amount - allocated_current
                if remainder > 0 and principal_outstanding > 0:
                    allocated_principal = min(remainder, principal_outstanding)
            else:
                # No interest due — route entire small payment to principal
                allocated_principal = min(payment_amount, principal_outstanding)
        else:
            # Large payment → clear all accrued interest first, remainder to principal
            interest_cleared = min(payment_amount, interest_outstanding)
            allocated_current = interest_cleared
            remaining = payment_amount - interest_cleared
            if remaining > 0 and principal_outstanding > 0:
                principal_payment = min(remaining, principal_outstanding)
                allocated_principal = principal_payment
                remaining -= principal_payment
            unallocated = remaining  # over-payment beyond full principal

        return {
            "allocated_to_overdue_interest": allocated_overdue,
            "allocated_to_current_interest": allocated_current,
            "allocated_to_principal": allocated_principal,
            "unallocated": unallocated,
        }

    else:
        # short_term (and any future types): interest-first, then principal,
        # then any surplus is additional profit (allocated to current_interest).
        outstanding = calculate_outstanding(loan_id, payment_date, db)
        interest_outstanding = outstanding["interest_outstanding"]
        principal_outstanding = outstanding["principal_outstanding"]

        remaining = payment_amount
        allocated_overdue = Decimal("0")
        allocated_current = Decimal("0")
        allocated_principal = Decimal("0")

        if remaining > 0 and interest_outstanding > 0:
            interest_payment = min(remaining, interest_outstanding)
            allocated_current = interest_payment
            remaining -= interest_payment

        if remaining > 0 and principal_outstanding > 0:
            principal_payment = min(remaining, principal_outstanding)
            allocated_principal = principal_payment
            remaining -= principal_payment

        # Surplus after full principal recovery = extra interest / profit
        if remaining > 0:
            allocated_current += remaining
            remaining = Decimal("0")

        return {
            "allocated_to_overdue_interest": allocated_overdue,
            "allocated_to_current_interest": allocated_current,
            "allocated_to_principal": allocated_principal,
            "unallocated": Decimal("0"),
        }
