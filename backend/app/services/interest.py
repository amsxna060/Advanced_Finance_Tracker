import calendar
from decimal import Decimal
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
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

    # For EMI loans: principal and interest both reduce proportionally with payments.
    # principal_ratio = principal / total_repayment (e.g. 45000/60000 = 0.75)
    # interest_ratio  = total_interest / total_repayment (e.g. 15000/60000 = 0.25)
    # Each rupee paid reduces principal and interest by their respective shares.
    if loan.loan_type == "emi":
        emi_amount = Decimal(str(loan.emi_amount or 0))
        tenure = loan.tenure_months or 0
        principal = Decimal(str(loan.principal_amount))
        total_repayment = (emi_amount * tenure).quantize(Decimal("0.01"))
        total_interest = max(total_repayment - principal, Decimal("0"))
        total_paid = sum(Decimal(str(p.amount_paid)) for p in payments)
        total_paid = min(total_paid, total_repayment)
        total_remaining = max(total_repayment - total_paid, Decimal("0"))

        if total_repayment > Decimal("0"):
            principal_ratio = principal / total_repayment
            interest_ratio = total_interest / total_repayment
        else:
            principal_ratio = Decimal("1")
            interest_ratio = Decimal("0")

        principal_outstanding = (total_remaining * principal_ratio).quantize(Decimal("0.01"))
        interest_outstanding = (total_remaining * interest_ratio).quantize(Decimal("0.01"))

        return {
            "principal_outstanding": principal_outstanding,
            "interest_outstanding": interest_outstanding,
            "total_outstanding": total_remaining,
            "as_of_date": as_of_date,
        }

    # Compute interest using the same period-based monthly formula as the schedule.
    # For auto-cap loans: start calc_principal from original principal (ignore old DB cap events).
    # For non-auto-cap loans: apply DB cap events as starting point.
    if loan.capitalization_enabled and (loan.capitalization_after_months or 0) > 0:
        calc_principal = Decimal(str(loan.principal_amount))
    else:
        calc_principal = Decimal(str(loan.principal_amount))
        for event in cap_events:
            calc_principal = Decimal(str(event.new_principal))

    if loan.loan_type == "short_term" and loan.interest_free_till:
        if as_of_date <= loan.interest_free_till:
            principal_outstanding = max(principal_outstanding, Decimal("0"))
            return {
                "principal_outstanding": principal_outstanding,
                "interest_outstanding": Decimal("0"),
                "total_outstanding": principal_outstanding,
                "as_of_date": as_of_date,
            }
        interest_start_calc = loan.interest_free_till + timedelta(days=1)
        calc_rate = Decimal(str(loan.post_due_interest_rate or 0))
    else:
        interest_start_calc = loan.interest_start_date or loan.disbursed_date
        calc_rate = current_rate

    if as_of_date < interest_start_calc:
        principal_outstanding = max(principal_outstanding, Decimal("0"))
        return {
            "principal_outstanding": principal_outstanding,
            "interest_outstanding": Decimal("0"),
            "total_outstanding": principal_outstanding,
            "as_of_date": as_of_date,
        }

    monthly_interest_full = calc_principal * (calc_rate / Decimal("100") / Decimal("12"))
    interest_accrued = Decimal("0")

    # Auto-capitalization: every cap_every months, unpaid interest rolls into principal
    cap_enabled = loan.capitalization_enabled and (loan.capitalization_after_months or 0) > 0
    cap_every = loan.capitalization_after_months or 0
    month_count = 0
    unpaid_carried = Decimal("0")

    interest_paid_total = sum(
        Decimal(str(p.allocated_to_current_interest)) + Decimal(str(p.allocated_to_overdue_interest))
        for p in payments
    )
    interest_paid_remaining = interest_paid_total

    cur = interest_start_calc
    while cur <= as_of_date:
        period_end = cur + relativedelta(months=1)
        month_count += 1
        monthly_interest_full = calc_principal * (calc_rate / Decimal("100") / Decimal("12"))
        is_cap_month = cap_enabled and (month_count % cap_every == 0)

        if period_end <= as_of_date:
            mi = monthly_interest_full
        else:
            days_elapsed = (as_of_date - cur).days
            days_in_period = (period_end - cur).days
            if days_elapsed > 0 and days_in_period > 0:
                mi = monthly_interest_full * Decimal(str(days_elapsed)) / Decimal(str(days_in_period))
            else:
                cur = period_end
                continue

        interest_accrued += mi

        if interest_paid_remaining >= mi:
            interest_paid_remaining -= mi
            unpaid_carried = Decimal("0")
        elif interest_paid_remaining > 0:
            unpaid_carried += (mi - interest_paid_remaining)
            interest_paid_remaining = Decimal("0")
        else:
            unpaid_carried += mi

        # Capitalize at end of cycle (only for full completed periods)
        if is_cap_month and unpaid_carried > Decimal("0") and period_end <= as_of_date:
            calc_principal += unpaid_carried
            # The capitalized interest is now principal, reset accrued tracking
            interest_accrued -= unpaid_carried
            interest_paid_total -= Decimal("0")  # no change needed
            unpaid_carried = Decimal("0")
            month_count = 0

        cur = period_end

    interest_outstanding = max(interest_accrued - interest_paid_total, Decimal("0")).quantize(Decimal("0.01"))

    # For auto-cap loans: principal_outstanding reflects compounded principal
    # For non-auto-cap loans: principal_outstanding reflects original minus repayments
    if cap_enabled:
        principal_outstanding = calc_principal.quantize(Decimal("0.01"))
    else:
        principal_outstanding = max(principal_outstanding, Decimal("0")).quantize(Decimal("0.01"))

    return {
        "principal_outstanding": principal_outstanding,
        "interest_outstanding": interest_outstanding,
        "total_outstanding": (principal_outstanding + interest_outstanding).quantize(Decimal("0.01")),
        "as_of_date": as_of_date,
    }


def _clamp_day_to_month(year: int, month: int, day: int) -> date:
    """Return a date with `day` clamped to the last valid day of the given month."""
    max_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, max_day))


def generate_emi_schedule(loan: Loan) -> List[Dict[str, Any]]:
    """
    Generate expected EMI schedule for EMI-type loans.
    Returns list of {due_date, due_amount, status}
    First EMI is always due in the month AFTER disbursement.
    """
    if loan.loan_type != "emi" or not loan.tenure_months or not loan.emi_amount:
        return []

    schedule = []
    disbursed = loan.disbursed_date
    emi_day = loan.emi_day_of_month or 1

    # First EMI is always the month AFTER disbursement month
    first_emi_month = disbursed + relativedelta(months=1)

    for i in range(loan.tenure_months):
        due_month = first_emi_month + relativedelta(months=i)
        due_date = _clamp_day_to_month(due_month.year, due_month.month, emi_day)
        schedule.append({
            "emi_number": i + 1,
            "due_date": due_date,
            "due_amount": loan.emi_amount,
            "status": "pending",
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


def calculate_emi_interest_summary(principal: Decimal, emi_amount: Decimal, tenure_months: int) -> dict:
    """
    For EMI loans, calculate embedded interest and effective flat annual rate.
    Returns: {total_repayment, total_interest_embedded, effective_annual_rate_pct}
    """
    total_repayment = emi_amount * tenure_months
    total_interest = total_repayment - principal
    if principal > 0 and tenure_months > 0:
        flat_monthly_rate = (total_interest / principal) / tenure_months
        flat_annual_rate = flat_monthly_rate * 12 * 100
    else:
        flat_annual_rate = Decimal("0")
    return {
        "total_repayment": total_repayment,
        "total_interest_embedded": total_interest,
        "effective_annual_rate_pct": flat_annual_rate.quantize(Decimal("0.01"))
    }


def get_emi_schedule_with_payments(loan: Loan, db: Session) -> List[Dict[str, Any]]:
    """
    Generate EMI schedule with actual payment status using carry-forward logic.
    Returns list of {emi_number, due_date, due_amount, status, paid_amount, outstanding}
    Status: 'paid' | 'partial' | 'unpaid' | 'future'
    """
    schedule = generate_emi_schedule(loan)
    if not schedule:
        return []

    today = date.today()
    emi_amount = Decimal(str(loan.emi_amount))

    # Get all payments ordered by date asc
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan.id
    ).order_by(LoanPayment.payment_date.asc()).all()

    # Total cumulative payment so far
    total_paid = sum(Decimal(str(p.amount_paid)) for p in payments)

    # Assign payments to EMI slots using carry-forward credit balance
    result = []
    credit_balance = total_paid

    for entry in schedule:
        due_date = entry["due_date"]
        is_future = due_date > today

        if is_future:
            # Apply carry-forward to future EMIs too (pre-paid)
            if credit_balance >= emi_amount:
                status = "paid"
                paid_amount = emi_amount
                outstanding = Decimal("0")
                credit_balance -= emi_amount
            elif credit_balance > 0:
                status = "partial"
                paid_amount = credit_balance
                outstanding = emi_amount - credit_balance
                credit_balance = Decimal("0")
            else:
                status = "future"
                paid_amount = Decimal("0")
                outstanding = emi_amount
        else:
            if credit_balance >= emi_amount:
                status = "paid"
                paid_amount = emi_amount
                outstanding = Decimal("0")
                credit_balance -= emi_amount
            elif credit_balance > 0:
                status = "partial"
                paid_amount = credit_balance
                outstanding = emi_amount - credit_balance
                credit_balance = Decimal("0")
            else:
                status = "unpaid"
                paid_amount = Decimal("0")
                outstanding = emi_amount

        result.append({
            "emi_number": entry["emi_number"],
            "due_date": due_date,
            "due_amount": float(emi_amount),
            "paid_amount": float(paid_amount),
            "outstanding": float(outstanding),
            "status": status,
            "is_current_month": (due_date.year == today.year and due_date.month == today.month),
        })

    return result


def generate_monthly_interest_schedule(loan: Loan, db: Session) -> List[Dict[str, Any]]:
    """
    Generate a monthly interest schedule for a loan showing how much interest was due
    each month and how much has been paid.

    For interest_only: monthly interest on outstanding principal
    For emi: uses carry-forward EMI logic
    For short_term: interest-free period, then post-due interest
    """
    today = date.today()

    if loan.loan_type == "emi":
        entries = get_emi_schedule_with_payments(loan, db)
        result = []
        for e in entries:
            due_date = e["due_date"]
            month_label = due_date.strftime("%B %Y")
            result.append({
                "month": due_date.strftime("%Y-%m"),
                "month_label": month_label,
                "interest_due": e["due_amount"],
                "interest_paid": e["paid_amount"],
                "interest_outstanding": e["outstanding"],
                "status": e["status"],
                "is_current_month": e["is_current_month"],
            })
        return result

    if loan.loan_type == "short_term":
        entries = []
        interest_free_till = loan.interest_free_till
        if interest_free_till:
            entries.append({
                "month": "interest_free",
                "month_label": f"Interest-Free Period (until {interest_free_till})",
                "interest_due": 0.0,
                "interest_paid": 0.0,
                "interest_outstanding": 0.0,
                "status": "paid" if today > interest_free_till else "future",
                "is_current_month": False,
            })
            if today <= interest_free_till:
                return entries
            start_month = interest_free_till + timedelta(days=1)
        else:
            start_month = loan.disbursed_date

        # Get outstanding principal
        principal = Decimal(str(loan.principal_amount))
        rate = Decimal(str(loan.post_due_interest_rate or 0))

        # Get all interest payments
        payments = db.query(LoanPayment).filter(
            LoanPayment.loan_id == loan.id
        ).order_by(LoanPayment.payment_date.asc()).all()
        total_interest_paid = sum(
            Decimal(str(p.allocated_to_current_interest or 0)) +
            Decimal(str(p.allocated_to_overdue_interest or 0))
            for p in payments
        )

        # Generate monthly schedule using loan-disbursement-day based periods
        cur = start_month
        interest_paid_remaining = total_interest_paid

        while cur <= today:
            period_end = cur + relativedelta(months=1)
            if period_end <= today:
                # Full period
                monthly_interest = principal * (rate / Decimal("100") / Decimal("12"))
            else:
                # Partial current period — accrue up to today
                days_elapsed = (today - cur).days
                days_in_period = (period_end - cur).days
                if days_elapsed > 0 and days_in_period > 0:
                    monthly_interest = (
                        principal * (rate / Decimal("100") / Decimal("12"))
                        * Decimal(str(days_elapsed)) / Decimal(str(days_in_period))
                    )
                else:
                    cur = period_end
                    continue  # skip 0-day period

            if interest_paid_remaining >= monthly_interest:
                paid = monthly_interest
                interest_paid_remaining -= monthly_interest
                status = "paid"
            elif interest_paid_remaining > 0:
                paid = interest_paid_remaining
                interest_paid_remaining = Decimal("0")
                status = "partial"
            else:
                paid = Decimal("0")
                status = "unpaid"

            outstanding = monthly_interest - paid
            is_current = period_end > today
            period_end_label = today.strftime("%d %b %Y") if is_current else period_end.strftime("%d %b %Y")
            month_label = f"{cur.strftime('%d %b')} – {period_end_label}"

            entries.append({
                "month": cur.strftime("%Y-%m-%d"),
                "month_label": month_label,
                "interest_due": float(monthly_interest),
                "interest_paid": float(paid),
                "interest_outstanding": float(outstanding),
                "status": status,
                "is_current_month": is_current,
            })
            cur = period_end

        return entries

    # interest_only
    interest_start = loan.interest_start_date or loan.disbursed_date
    if interest_start > today:
        return []

    principal = Decimal(str(loan.principal_amount))
    rate = Decimal(str(loan.interest_rate or 0))
    cap_enabled = loan.capitalization_enabled and (loan.capitalization_after_months or 0) > 0
    cap_every = loan.capitalization_after_months or 0

    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan.id
    ).order_by(LoanPayment.payment_date.asc()).all()
    total_interest_paid = sum(
        Decimal(str(p.allocated_to_current_interest or 0)) +
        Decimal(str(p.allocated_to_overdue_interest or 0))
        for p in payments
    )

    cur = interest_start
    interest_paid_remaining = total_interest_paid
    entries = []
    month_count = 0  # how many full periods completed in current cap cycle
    unpaid_interest_carried = Decimal("0")  # interest not yet paid, may capitalize

    while cur <= today:
        period_end = cur + relativedelta(months=1)
        month_count += 1
        is_cap_month = cap_enabled and (month_count % cap_every == 0)

        if period_end <= today:
            # Full period
            monthly_interest = principal * (rate / Decimal("100") / Decimal("12"))
        else:
            # Partial current period — accrue up to today
            days_elapsed = (today - cur).days
            days_in_period = (period_end - cur).days
            if days_elapsed > 0 and days_in_period > 0:
                monthly_interest = (
                    principal * (rate / Decimal("100") / Decimal("12"))
                    * Decimal(str(days_elapsed)) / Decimal(str(days_in_period))
                )
            else:
                cur = period_end
                continue  # skip 0-day period (just started today)

        if interest_paid_remaining >= monthly_interest:
            paid = monthly_interest
            interest_paid_remaining -= monthly_interest
            status = "paid"
            unpaid_interest_carried = Decimal("0")
        elif interest_paid_remaining > 0:
            paid = interest_paid_remaining
            interest_paid_remaining = Decimal("0")
            status = "partial"
            unpaid_interest_carried += (monthly_interest - paid)
        else:
            paid = Decimal("0")
            status = "unpaid"
            unpaid_interest_carried += monthly_interest

        outstanding = monthly_interest - paid
        is_current = period_end > today
        period_end_label = today.strftime("%d %b %Y") if is_current else period_end.strftime("%d %b %Y")
        month_label = f"{cur.strftime('%d %b')} – {period_end_label}"

        entry = {
            "month": cur.strftime("%Y-%m-%d"),
            "month_label": month_label,
            "interest_due": float(monthly_interest),
            "interest_paid": float(paid),
            "interest_outstanding": float(outstanding),
            "status": status,
            "is_current_month": is_current,
            "capitalized": False,
        }

        # At end of cap cycle: unpaid interest rolls into principal for next cycle
        if is_cap_month and unpaid_interest_carried > Decimal("0") and not is_current:
            capitalized_amount = unpaid_interest_carried
            entry["capitalized"] = True
            entry["capitalized_amount"] = float(capitalized_amount)
            entry["new_principal_after"] = float(principal + capitalized_amount)
            principal = principal + capitalized_amount
            unpaid_interest_carried = Decimal("0")
            month_count = 0  # reset cycle counter

        entries.append(entry)
        cur = period_end

    return entries
