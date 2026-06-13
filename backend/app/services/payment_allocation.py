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

    For interest_only loans (interest-first with a future-interest buffer):
      1. clear accrued (overdue + current) interest as of the payment date
      2. hold up to LOAN_INTEREST_PREPAY_MONTHS future months of interest as a
         PREPAID credit (offsets next month's interest; never touches principal)
      3. only the excess beyond that buffer reduces principal — and the engine
         then accrues future interest on the reduced balance from that period
      4. surplus beyond full principal payoff → unallocated
      An explicit `principal_repayment` is honoured exactly (deliberate paydown).
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
        # Interest-first with a FUTURE-INTEREST BUFFER, then principal.
        #
        # Order of allocation:
        #   1. Clear all accrued (overdue + current) interest as of the payment date.
        #   2. Hold up to N future months of interest as PREPAID interest — a credit
        #      that offsets next month(s)' interest. This never touches principal,
        #      so a borrower simply paying next month's interest in advance does
        #      not shrink the principal.
        #   3. Only the excess BEYOND that buffer reduces principal. Once principal
        #      drops, the engine accrues future interest on the reduced balance from
        #      that period onward (principal_repayment_events).
        #   4. Anything beyond full principal payoff is surplus (unallocated).
        #
        # An explicit `principal_repayment` (e.g. a deliberate principal paydown)
        # is honoured exactly — the buffer logic is only the automatic default.
        outstanding = calculate_outstanding(loan_id, payment_date, db)
        interest_outstanding = outstanding["interest_outstanding"]
        principal_outstanding = outstanding["principal_outstanding"]
        annual_rate = Decimal(str(loan.interest_rate or 0))

        allocated_overdue = Decimal("0")
        allocated_current = Decimal("0")
        allocated_principal = Decimal("0")
        unallocated = Decimal("0")
        remaining = payment_amount

        # ── Explicit principal paydown override (deliberate principal payment) ──
        if principal_repayment is not None and principal_repayment > Decimal("0"):
            allocated_principal = min(principal_repayment, principal_outstanding, remaining)
            remaining -= allocated_principal
            # The rest clears interest (accrued first, then prepaid), surplus over.
            allocated_current = remaining
            return {
                "allocated_to_overdue_interest": allocated_overdue,
                "allocated_to_current_interest": allocated_current,
                "allocated_to_principal": allocated_principal,
                "unallocated": Decimal("0"),
            }

        # 1) Clear accrued interest.
        if remaining > 0 and interest_outstanding > 0:
            pay_interest = min(remaining, interest_outstanding)
            allocated_current = pay_interest
            remaining -= pay_interest

        # 2) Classify the leftover by SIZE against a future-interest buffer:
        #    - leftover ≤ buffer (a month or two of interest) → treat the WHOLE
        #      leftover as prepaid future interest; principal is untouched.
        #    - leftover  > buffer → it's a deliberate principal paydown, so the
        #      WHOLE leftover reduces principal (no buffer carve-out — otherwise
        #      a near-full payoff would wrongly leave the buffer sitting on the
        #      loan).
        #    The monthly figure is on the CURRENT outstanding principal, so it
        #    reflects what next month's interest will actually be.
        try:
            from app.config import settings
            prepay_months = max(int(settings.LOAN_INTEREST_PREPAY_MONTHS), 0)
        except Exception:
            prepay_months = 2
        monthly_interest = (principal_outstanding * annual_rate / Decimal("1200")).quantize(Decimal("0.01"))
        future_interest_buffer = monthly_interest * Decimal(str(prepay_months))

        if remaining > 0:
            if principal_outstanding > 0 and remaining <= future_interest_buffer:
                # Small excess → prepaid future interest (offsets next month(s)).
                allocated_current += remaining
                remaining = Decimal("0")
            else:
                # Clear principal paydown (or no principal left to protect).
                pay_principal = min(remaining, principal_outstanding)
                allocated_principal = pay_principal
                remaining -= pay_principal
                unallocated = remaining  # surplus beyond full principal payoff

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
