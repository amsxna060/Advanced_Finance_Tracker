import calendar
from decimal import Decimal
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Tuple
from app.models.loan import Loan, LoanPayment, LoanCapitalizationEvent


def _days_in_year(year: int) -> int:
    """Return 366 for leap year, 365 otherwise."""
    return 366 if calendar.isleap(year) else 365


def _build_monthly_periods(start_date: date, end_date: date) -> List[Tuple[date, date, int]]:
    """
    Build disbursement-date-anchored monthly periods from start_date to end_date (inclusive).
    Each period runs: start_date + n months → start_date + (n+1) months (exclusive).
    E.g. loan on 23 Jan: Period 1 = 23 Jan–22 Feb, Period 2 = 23 Feb–22 Mar, etc.
    Returns list of (period_start, period_end_exclusive_actual, full_month_days) tuples.
    full_month_days = days in the complete monthly period (for prorating the partial last period).
    """
    periods = []
    n = 0
    while True:
        p_start = start_date + relativedelta(months=n)
        if p_start > end_date:
            break
        p_end_excl_full = start_date + relativedelta(months=n + 1)
        full_month_days = (p_end_excl_full - p_start).days
        actual_end_excl = min(p_end_excl_full, end_date + timedelta(days=1))
        days = (actual_end_excl - p_start).days
        if days > 0:
            periods.append((p_start, actual_end_excl, full_month_days))
        n += 1
    return periods


def _build_banking_periods(disburse_date: date, today: date) -> List[Tuple[date, date, int, date]]:
    """
    Calendar-month periods for banking-mode (actual/365) loans.
    - Period 0 : disburse_date  → last day of disbursement month  (partial first month)
    - Period 1+: 1st of month   → last day of each calendar month
    - Current incomplete month  : 1st → today
    Returns: (p_start, p_end_excl_actual, full_period_days, payment_due_date)
    payment_due_date = last day of the calendar month the period belongs to.
    """
    periods: List[Tuple[date, date, int, date]] = []

    # ── Period 0: disbursement date → end of that calendar month ──
    disburse_month_last = date(
        disburse_date.year, disburse_date.month,
        calendar.monthrange(disburse_date.year, disburse_date.month)[1],
    )
    p_end_full_excl = disburse_month_last + timedelta(days=1)
    full_days_0 = (p_end_full_excl - disburse_date).days
    actual_end_excl_0 = min(p_end_full_excl, today + timedelta(days=1))
    if (actual_end_excl_0 - disburse_date).days > 0:
        periods.append((disburse_date, actual_end_excl_0, full_days_0, disburse_month_last))

    if today <= disburse_month_last:
        return periods

    # ── Subsequent calendar months: 1st → last ──
    cur_1st = date(disburse_date.year, disburse_date.month, 1) + relativedelta(months=1)
    while cur_1st <= today:
        month_last = date(
            cur_1st.year, cur_1st.month,
            calendar.monthrange(cur_1st.year, cur_1st.month)[1],
        )
        p_end_full_excl = month_last + timedelta(days=1)
        full_days = (p_end_full_excl - cur_1st).days
        actual_end_excl = min(p_end_full_excl, today + timedelta(days=1))
        if (actual_end_excl - cur_1st).days > 0:
            periods.append((cur_1st, actual_end_excl, full_days, month_last))
        cur_1st += relativedelta(months=1)

    return periods


def _calc_period_interest(principal: Decimal, annual_rate: Decimal, period_start: date, days: int, full_period_days: int = 0, banking: bool = False) -> Decimal:
    """
    Calculate interest for a period.
    banking=False (commercial): flat monthly rate (annual_rate / 12 / 100). Full period = exact monthly amount.
      Partial period prorated by days / full_period_days.
    banking=True (banking_365): actual days / 365 (actual year days). interest = principal * rate/100 * days/365.
    """
    if banking:
        # H-FIN-16: for periods that cross a year boundary, compute interest
        # day-by-day in each calendar year so the correct year length is applied.
        period_end = period_start + timedelta(days=days)
        if period_start.year == period_end.year:
            days_in_year = _days_in_year(period_start.year)
            return (principal * annual_rate / Decimal("100") * Decimal(str(days)) / Decimal(str(days_in_year))).quantize(Decimal("0.01"))
        # Cross-year: split at Jan 1 of each new year
        total_interest = Decimal("0")
        seg_start = period_start
        seg_end = date(period_start.year + 1, 1, 1)  # first day of next year
        while seg_start < period_end:
            seg_end = min(date(seg_start.year + 1, 1, 1), period_end)
            seg_days = (seg_end - seg_start).days
            diy = _days_in_year(seg_start.year)
            total_interest += principal * annual_rate / Decimal("100") * Decimal(str(seg_days)) / Decimal(str(diy))
            seg_start = seg_end
        return total_interest.quantize(Decimal("0.01"))
    monthly_rate = annual_rate / Decimal("1200")
    if full_period_days > 0 and days < full_period_days:
        return principal * monthly_rate * Decimal(str(days)) / Decimal(str(full_period_days))
    return principal * monthly_rate


def _solve_emi_monthly_rate(principal: Decimal, emi: Decimal, tenure: int) -> Decimal:
    """Solve for monthly rate r in EMI = P*r*(1+r)^n / ((1+r)^n-1) via binary search."""
    if emi * tenure <= principal or principal <= Decimal("0") or emi <= Decimal("0"):
        return Decimal("0")
    lo, hi = Decimal("0.00001"), Decimal("10.0")
    for _ in range(80):
        mid = (lo + hi) / Decimal("2")
        factor = (Decimal("1") + mid) ** tenure
        denom = factor - Decimal("1")
        if denom <= Decimal("0"):
            lo = mid
            continue
        computed_emi = principal * mid * factor / denom
        if computed_emi < emi:
            lo = mid
        else:
            hi = mid
    return ((lo + hi) / Decimal("2")).quantize(Decimal("0.0000001"))


def _generate_emi_amortization(principal: Decimal, emi: Decimal, tenure: int, monthly_r: Decimal) -> List[Dict]:
    """Reducing-balance amortization: per-EMI breakdown of interest vs principal."""
    outstanding = principal
    result = []
    for i in range(1, tenure + 1):
        if monthly_r > Decimal("0"):
            interest_comp = (outstanding * monthly_r).quantize(Decimal("0.01"))
        else:
            interest_comp = Decimal("0")
        principal_comp = min((emi - interest_comp).quantize(Decimal("0.01")), outstanding)
        outstanding = max(outstanding - principal_comp, Decimal("0"))
        result.append({
            "emi_number": i,
            "interest_component": float(interest_comp),
            "principal_component": float(principal_comp),
            "outstanding_after": float(outstanding.quantize(Decimal("0.01"))),
        })
    return result


def calculate_outstanding_from_loan(loan: "Loan", as_of_date: date) -> Dict[str, Decimal]:
    """Like calculate_outstanding but uses pre-loaded loan.payments and loan.capitalization_events.

    Use this when the loan was fetched with selectinload(Loan.payments) and
    selectinload(Loan.capitalization_events) — avoids all DB calls.
    """
    cap_events = [e for e in loan.capitalization_events if e.event_date <= as_of_date]
    payments   = sorted(
        # H-DI-9 / C-FIN-1: exclude voided payments from all outstanding calculations
        [p for p in loan.payments if p.payment_date <= as_of_date and not getattr(p, 'is_voided', False)],
        key=lambda p: p.payment_date,
    )
    return _compute_outstanding(loan, as_of_date, cap_events, payments)


def get_emi_schedule_preloaded(loan: "Loan") -> List[Dict[str, Any]]:
    """Like get_emi_schedule_with_payments but uses pre-loaded loan.payments — no DB calls.

    Delegates to the same core as get_emi_schedule_with_payments so the two can
    never drift (penalty handling, overdue-day rule, paid-late penalties).
    """
    # C-FIN-1 / H-DI-9: exclude voided payments from all financial calculations
    payments = sorted(
        [p for p in loan.payments if not getattr(p, 'is_voided', False)],
        key=lambda p: p.payment_date,
    )
    return _emi_schedule_core(loan, payments)


def calculate_outstanding(loan_id: int, as_of_date: date, db: Session) -> Dict[str, Decimal]:
    """
    Calculate the outstanding principal and interest for a loan as of a specific date.
    Returns: {principal_outstanding, interest_outstanding, total_outstanding}
    """
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        raise ValueError("Loan not found")

    cap_events = db.query(LoanCapitalizationEvent).filter(
        LoanCapitalizationEvent.loan_id == loan_id,
        LoanCapitalizationEvent.event_date <= as_of_date
    ).order_by(LoanCapitalizationEvent.event_date).all()

    # C-FIN-1 / H-DI-9: exclude voided payments from all outstanding calculations
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan_id,
        LoanPayment.payment_date <= as_of_date,
        LoanPayment.is_voided == False,
    ).order_by(LoanPayment.payment_date).all()

    return _compute_outstanding(loan, as_of_date, cap_events, payments)


def _compute_outstanding(loan, as_of_date: date, cap_events, payments) -> Dict[str, Decimal]:
    """Core outstanding calculation using pre-fetched cap_events and payments lists."""
    # Closed loans have no outstanding balance
    if getattr(loan, "status", None) == "closed":
        return {
            "principal_outstanding": Decimal("0"),
            "interest_outstanding": Decimal("0"),
            "total_outstanding": Decimal("0"),
            "gross_interest_accrued": Decimal("0"),
            "as_of_date": as_of_date,
        }

    # Start with original principal
    principal_outstanding = Decimal(str(loan.principal_amount))

    # Manual cap events only apply when auto-capitalization is OFF (the auto
    # path recomputes its own compounding and ignores DB events).
    auto_cap = loan.capitalization_enabled and (loan.capitalization_after_months or 0) > 0
    last_cap_date = None
    current_rate = Decimal(str(loan.interest_rate or 0))

    if not auto_cap:
        for event in cap_events:
            principal_outstanding = Decimal(str(event.new_principal))
            last_cap_date = event.event_date
            if event.interest_rate_after:
                current_rate = Decimal(str(event.interest_rate_after))

    # A cap event snapshots principal_before NET of earlier principal payments,
    # and consumes interest paid up to its date. Everything before the last
    # event is therefore already baked into new_principal — only payments made
    # AFTER the event may be applied again.
    if last_cap_date is not None:
        effective_payments = [p for p in payments if p.payment_date > last_cap_date]
    else:
        effective_payments = list(payments)

    # Subtract principal payments not already reflected in a cap event
    for payment in effective_payments:
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
        # Penalty is a separate charge — it must not count toward EMI coverage
        # (same rule as get_emi_schedule_with_payments).
        total_paid = sum(
            max(Decimal(str(p.amount_paid)) - Decimal(str(p.penalty_paid or 0)), Decimal("0"))
            for p in payments
        )
        # H-FIN-17: do NOT silently cap total_paid at total_repayment.
        # If payments exceed the scheduled repayment amount the loan is
        # over-paid; honour the actual figures so outstanding shows ≤ 0.
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
            "gross_interest_accrued": max(total_interest, Decimal("0")),
            "as_of_date": as_of_date,
        }

    # Compute interest using the same period-based monthly formula as the schedule.
    # For auto-cap loans: start calc_principal from original principal (ignore old DB cap events).
    # For non-auto-cap loans: the last cap event's new_principal is the accrual base.
    if auto_cap:
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
        # Interest up to the last manual cap event is already inside
        # new_principal — resume accrual the day after the event.
        if last_cap_date is not None:
            interest_start_calc = max(interest_start_calc, last_cap_date + timedelta(days=1))

    if as_of_date < interest_start_calc:
        principal_outstanding = max(principal_outstanding, Decimal("0"))
        return {
            "principal_outstanding": principal_outstanding,
            "interest_outstanding": Decimal("0"),
            "total_outstanding": principal_outstanding,
            "as_of_date": as_of_date,
        }

    gross_accrued = Decimal("0")  # total interest generated (regardless of capitalization)

    # Auto-capitalization: every cap_every months, unpaid interest rolls into principal
    cap_enabled = loan.capitalization_enabled and (loan.capitalization_after_months or 0) > 0
    cap_every = loan.capitalization_after_months or 0
    month_count = 0
    unpaid_carried = Decimal("0")

    # L8 fix: interest payments are released CHRONOLOGICALLY — a payment can
    # only offset interest that had accrued by its payment date, and can never
    # retroactively shrink a capitalization that happened before it. (The old
    # model applied the lifetime total oldest-first, so a payment made in June
    # would rewrite a capitalization from March and could wrongly close loans.)
    interest_payment_events = sorted(
        [(p.payment_date,
          Decimal(str(p.allocated_to_current_interest)) + Decimal(str(p.allocated_to_overdue_interest)))
         for p in effective_payments],
        key=lambda x: x[0],
    )
    ip_idx = 0
    interest_paid_available = Decimal("0")

    # Track principal repayments for all non-EMI loans so accrual basis is reduced.
    principal_repayment_events = sorted(
        [(p.payment_date, Decimal(str(p.allocated_to_principal)))
         for p in effective_payments if Decimal(str(p.allocated_to_principal or 0)) > 0],
        key=lambda x: x[0],
    )
    pr_idx = 0

    # Banking interest mode flag
    banking_mode = getattr(loan, 'interest_calc_method', 'commercial') == 'banking_365'

    # Build disbursement-date-anchored monthly periods and iterate
    periods = _build_monthly_periods(interest_start_calc, as_of_date)
    for p_start, p_end, full_days in periods:
        # Apply any principal repayments whose date falls at or before the start of this period
        while pr_idx < len(principal_repayment_events) and principal_repayment_events[pr_idx][0] <= p_start:
            calc_principal = max(calc_principal - principal_repayment_events[pr_idx][1], Decimal("0"))
            pr_idx += 1

        # Once principal is fully repaid, stop future accrual/capitalization.
        if calc_principal <= Decimal("0"):
            break

        month_count += 1
        days = (p_end - p_start).days
        mi = _calc_period_interest(calc_principal, calc_rate, p_start, days, full_days, banking=banking_mode)
        is_cap_month = cap_enabled and (month_count % cap_every == 0)

        gross_accrued += mi

        # Release interest payments dated inside or before this period, then
        # apply what's available against the oldest unpaid interest.
        while ip_idx < len(interest_payment_events) and interest_payment_events[ip_idx][0] < p_end:
            interest_paid_available += interest_payment_events[ip_idx][1]
            ip_idx += 1

        unpaid_carried += mi
        take = min(interest_paid_available, unpaid_carried)
        unpaid_carried -= take
        interest_paid_available -= take

        # Capitalize at end of cycle (only for fully past periods) — only
        # interest unpaid AS OF the cap date rolls into principal.
        if is_cap_month and unpaid_carried > Decimal("0") and p_end <= as_of_date:
            calc_principal += unpaid_carried
            unpaid_carried = Decimal("0")
            month_count = 0

    # Apply any remaining principal repayments that fell inside or at the end of the last period
    # (their payment_date > last p_start so the inner while loop never consumed them).
    # This fixes the case where payment_date == as_of_date: the repayment is correctly
    # reflected in principal_outstanding for capitalization-enabled loans.
    while pr_idx < len(principal_repayment_events) and principal_repayment_events[pr_idx][0] <= as_of_date:
        calc_principal = max(calc_principal - principal_repayment_events[pr_idx][1], Decimal("0"))
        pr_idx += 1

    # Release any interest payments not consumed by the loop (e.g. the loop
    # broke early because principal hit zero) and net them against what's
    # still unpaid. Leftover paid interest beyond accruals → nothing due.
    while ip_idx < len(interest_payment_events):
        interest_paid_available += interest_payment_events[ip_idx][1]
        ip_idx += 1
    interest_outstanding = max(unpaid_carried - interest_paid_available, Decimal("0")).quantize(Decimal("0.01"))

    # For auto-cap loans: principal_outstanding reflects compounded principal
    # For non-auto-cap loans: principal_outstanding reflects original minus repayments
    if cap_enabled:
        principal_outstanding = calc_principal.quantize(Decimal("0.01"))
    else:
        principal_outstanding = max(principal_outstanding, Decimal("0")).quantize(Decimal("0.01"))

    # H-FIN-25: subtract any recorded write-off amount so that a force-closed
    # loan's outstanding correctly reflects the settlement instead of re-inflating.
    write_off = Decimal(str(loan.write_off_amount or 0))
    if write_off > Decimal("0"):
        principal_outstanding = max(principal_outstanding - write_off, Decimal("0")).quantize(Decimal("0.01"))

    return {
        "principal_outstanding": principal_outstanding,
        "interest_outstanding": interest_outstanding,
        "total_outstanding": (principal_outstanding + interest_outstanding).quantize(Decimal("0.01")),
        "gross_interest_accrued": gross_accrued.quantize(Decimal("0.01")),
        "as_of_date": as_of_date,
        "overdue_interest": interest_outstanding,
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


def calculate_emi_interest_summary(
    principal: Decimal,
    emi_amount: Decimal,
    tenure_months: int,
    disbursed_date: date = None,
    include_amortization: bool = True,
) -> dict:
    """
    For EMI loans: embedded interest, flat rate, reducing-balance (banking) rate,
    per-EMI amortization schedule, and foreclose amount as of today.
    """
    total_repayment = emi_amount * tenure_months
    total_interest = max(total_repayment - principal, Decimal("0"))

    if principal > 0 and tenure_months > 0:
        flat_monthly_rate = (total_interest / principal) / tenure_months
        flat_annual_rate = flat_monthly_rate * 12 * 100
    else:
        flat_annual_rate = Decimal("0")

    monthly_r = _solve_emi_monthly_rate(principal, emi_amount, tenure_months)
    effective_rb_rate = (monthly_r * 12 * 100).quantize(Decimal("0.01"))

    amortization = []
    foreclose_amount = float(principal)
    foreclose_principal = float(principal)
    foreclose_accrued_interest = 0.0
    foreclose_processing_fee = 0.0
    if include_amortization and tenure_months <= 360:
        amortization = _generate_emi_amortization(principal, emi_amount, tenure_months, monthly_r)
        if disbursed_date:
            today = date.today()
            # Count only EMIs whose due dates have actually passed (day-of-month aware)
            months_diff = (today.year - disbursed_date.year) * 12 + (today.month - disbursed_date.month)
            if today.day < disbursed_date.day:
                months_diff -= 1
            emis_paid = max(0, min(months_diff, len(amortization)))

            # Remaining principal after all paid EMIs
            rem_principal = (
                Decimal(str(amortization[emis_paid - 1]["outstanding_after"]))
                if emis_paid > 0
                else principal
            )

            # Interest accrued from last EMI due date to today (actual/365)
            last_due = disbursed_date + relativedelta(months=emis_paid)
            days_elapsed = max(0, (today - last_due).days)
            annual_r = monthly_r * 12
            accrued = (rem_principal * annual_r * Decimal(str(days_elapsed)) / Decimal("365")).quantize(Decimal("0.01"))

            # Processing fee: 2.5% of remaining principal (standard foreclosure charge)
            fee = (rem_principal * Decimal("0.025")).quantize(Decimal("0.01"))

            foreclose_principal = float(rem_principal)
            foreclose_accrued_interest = float(accrued)
            foreclose_processing_fee = float(fee)
            foreclose_amount = float(rem_principal + accrued + fee)

    return {
        "total_repayment": total_repayment,
        "total_interest_embedded": total_interest,
        "effective_annual_rate_pct": flat_annual_rate.quantize(Decimal("0.01")),
        "effective_rb_rate_pct": effective_rb_rate,
        "monthly_rate_pct": (monthly_r * 100).quantize(Decimal("0.0001")),
        "foreclose_amount": foreclose_amount,
        "foreclose_principal": foreclose_principal,
        "foreclose_accrued_interest": foreclose_accrued_interest,
        "foreclose_processing_fee": foreclose_processing_fee,
        "amortization": amortization,
    }


def get_emi_schedule_with_payments(loan: Loan, db: Session) -> List[Dict[str, Any]]:
    """
    Generate EMI schedule with actual payment status using carry-forward logic.
    Returns list of {emi_number, due_date, due_amount, status, paid_amount, outstanding}
    Status: 'paid' | 'partial' | 'unpaid' | 'future'

    Penalty logic:
    - PAID but late: penalty = (effective_coverage_date - due_date).days × penalty_per_day
    - UNPAID/PARTIAL: penalty = max(0, (today - due_date).days - 1) × penalty_per_day
      (yesterday is the last accrual day; today is excluded since they can still pay today)
    """
    # Get all non-voided payments ordered by date asc
    # H-DI-9 / C-FIN-1: exclude voided payments from all financial calculations
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan.id,
        LoanPayment.is_voided == False,
    ).order_by(LoanPayment.payment_date.asc()).all()

    return _emi_schedule_core(loan, payments)


def _emi_schedule_core(loan: Loan, payments: List["LoanPayment"]) -> List[Dict[str, Any]]:
    """Shared EMI-schedule engine used by both the DB and preloaded variants."""
    schedule = generate_emi_schedule(loan)
    if not schedule:
        return []

    today = date.today()
    emi_amount = Decimal(str(loan.emi_amount))
    penalty_per_day = Decimal(str(getattr(loan, "penalty_per_day", None) or 0))

    # Build cumulative payment timeline to find per-EMI effective coverage dates.
    # IMPORTANT: penalty_paid is a separate charge — it must NOT count toward EMI coverage.
    # cum_timeline[i] = (payment_date, cumulative_emi_portion_paid_up_to_this_payment)
    cum_timeline: List[tuple] = []
    running = Decimal("0")
    for p in payments:
        emi_portion = Decimal(str(p.amount_paid)) - Decimal(str(p.penalty_paid or 0))
        running += max(emi_portion, Decimal("0"))
        cum_timeline.append((p.payment_date, running))

    # For each EMI slot (1-indexed), find the date cumulative first >= slot * emi_amount
    def effective_coverage_date(emi_n: int):
        threshold = emi_n * emi_amount
        for pdate, cum in cum_timeline:
            if cum >= threshold:
                return pdate
        return None

    # Penalty actually collected per EMI comes from penalty_paid on each payment
    # and is attributed to the slot THAT payment settled (see second pass below).

    # credit_balance = only the EMI portions (penalty excluded)
    total_paid = sum(
        max(Decimal(str(p.amount_paid)) - Decimal(str(p.penalty_paid or 0)), Decimal("0"))
        for p in payments
    )

    result = []
    credit_balance = total_paid

    for i, entry in enumerate(schedule, 1):
        due_date = entry["due_date"]
        is_future = due_date > today

        if is_future:
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

        # ── Penalty calculation ──
        days_late = 0
        penalty_accrued = 0.0
        if penalty_per_day > 0:
            if status == "paid":
                # Find when cumulative payments first covered this slot
                eff_date = effective_coverage_date(i)
                if eff_date and eff_date > due_date:
                    days_late = (eff_date - due_date).days
                    penalty_accrued = float((penalty_per_day * days_late).quantize(Decimal("0.01")))
            elif status in ("unpaid", "partial") and due_date < today:
                # Count from day-after-due to yesterday (exclude today — can still pay today)
                days_late = max(0, (today - due_date).days - 1)
                penalty_accrued = float((penalty_per_day * days_late).quantize(Decimal("0.01")))

        result.append({
            "emi_number": entry["emi_number"],
            "due_date": due_date,
            "due_amount": float(emi_amount),
            "paid_amount": float(paid_amount),
            "outstanding": float(outstanding),
            "status": status,
            "is_current_month": (due_date.year == today.year and due_date.month == today.month),
            "days_overdue": days_late,
            "penalty_accrued": penalty_accrued,
            "penalty_collected": 0.0,
        })

    # ── Second pass: attribute collected penalties to the right months ──
    # Each payment's penalty_paid belongs to the EMI slot(s) that payment
    # settled — NOT the earliest slot with pending penalty. (Previously a
    # global oldest-first carry-forward showed a penalty paid for EMI #5
    # against EMI #2, so the wrong months looked penalty-settled.)
    n_slots = len(result)
    accrued_remaining = [Decimal(str(e["penalty_accrued"])) for e in result]
    collected = [Decimal("0")] * n_slots
    leftover = Decimal("0")

    cum = Decimal("0")
    for p in payments:  # already sorted by payment_date at both call sites
        emi_portion = max(Decimal(str(p.amount_paid)) - Decimal(str(p.penalty_paid or 0)), Decimal("0"))
        completed_before = int(cum // emi_amount) if emi_amount > 0 else 0
        cum += emi_portion
        completed_after = int(cum // emi_amount) if emi_amount > 0 else 0

        penalty = Decimal(str(p.penalty_paid or 0))
        if penalty <= 0:
            continue

        # Target slots: the ones this payment completed; if it completed none
        # (partial payment), the slot it was paying into.
        targets = list(range(completed_before + 1, completed_after + 1))
        if not targets:
            targets = [completed_after + 1]
        for slot_n in targets:
            idx = slot_n - 1
            if idx < 0 or idx >= n_slots:
                continue
            take = min(penalty, accrued_remaining[idx])
            collected[idx] += take
            accrued_remaining[idx] -= take
            penalty -= take
            if penalty <= 0:
                break
        leftover += penalty

    # Any surplus (e.g. penalty recorded against an on-time slot) falls back to
    # the earliest slots that still have uncovered accrued penalty.
    if leftover > 0:
        for idx in range(n_slots):
            if leftover <= 0:
                break
            take = min(leftover, accrued_remaining[idx])
            collected[idx] += take
            accrued_remaining[idx] -= take
            leftover -= take

    for idx, entry in enumerate(result):
        entry["penalty_collected"] = float(collected[idx])

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

        # Get all interest payments (exclude voided)
        # H-DI-9 / C-FIN-1: exclude voided payments from all financial calculations
        payments = db.query(LoanPayment).filter(
            LoanPayment.loan_id == loan.id,
            LoanPayment.is_voided == False,
        ).order_by(LoanPayment.payment_date.asc()).all()
        total_interest_paid = sum(
            Decimal(str(p.allocated_to_current_interest or 0)) +
            Decimal(str(p.allocated_to_overdue_interest or 0))
            for p in payments
        )

        interest_paid_remaining = total_interest_paid

        # Track principal reductions so interest accrues on reduced balance
        short_term_pr_events = sorted(
            [(p.payment_date, Decimal(str(p.allocated_to_principal or 0)))
             for p in payments if Decimal(str(p.allocated_to_principal or 0)) > 0],
            key=lambda x: x[0],
        )
        st_pr_idx = 0

        # Build disbursement-date-anchored monthly periods
        periods = _build_monthly_periods(start_month, today)
        for p_start, p_end, full_days in periods:
            # Apply principal reductions at period boundaries
            while st_pr_idx < len(short_term_pr_events) and short_term_pr_events[st_pr_idx][0] <= p_start:
                principal = max(principal - short_term_pr_events[st_pr_idx][1], Decimal("0"))
                st_pr_idx += 1

            # If principal is fully repaid, stop generating future interest rows.
            if principal <= Decimal("0"):
                break

            days = (p_end - p_start).days
            is_current = days < full_days
            st_banking = getattr(loan, 'interest_calc_method', 'commercial') == 'banking_365'
            if is_current:
                monthly_interest = _calc_period_interest(principal, rate, p_start, days, full_days, banking=st_banking)
            else:
                monthly_interest = _calc_period_interest(principal, rate, p_start, full_days, full_days, banking=st_banking)

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
            full_end_incl = p_start + relativedelta(months=1) - timedelta(days=1)
            if is_current:
                month_label = f"{p_start.strftime('%d %b')} – {today.strftime('%d %b %Y')} (in progress)"
            else:
                month_label = f"{p_start.strftime('%d %b')} – {full_end_incl.strftime('%d %b %Y')}"

            entries.append({
                "month": p_start.strftime("%Y-%m-%d"),
                "month_label": month_label,
                "interest_due": float(monthly_interest),
                "interest_paid": float(paid),
                "interest_outstanding": float(outstanding),
                "status": status,
                "is_current_month": is_current,
            })

        return entries

    # interest_only
    interest_start = loan.interest_start_date or loan.disbursed_date
    if interest_start > today:
        return []

    principal = Decimal(str(loan.principal_amount))
    rate = Decimal(str(loan.interest_rate or 0))
    banking_mode = getattr(loan, 'interest_calc_method', 'commercial') == 'banking_365'
    cap_enabled = loan.capitalization_enabled and (loan.capitalization_after_months or 0) > 0
    cap_every = loan.capitalization_after_months or 0

    # H-DI-9 / C-FIN-1: exclude voided payments from all financial calculations
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan.id,
        LoanPayment.is_voided == False,
    ).order_by(LoanPayment.payment_date.asc()).all()
    total_interest_paid = sum(
        Decimal(str(p.allocated_to_current_interest or 0)) +
        Decimal(str(p.allocated_to_overdue_interest or 0))
        for p in payments
    )

    entries = []
    month_count = 0

    # L8 fix: payments are released CHRONOLOGICALLY. Within a capitalization
    # segment, released money pays the oldest row first; whatever is unpaid
    # when the segment closes is what gets capitalized — a later payment can
    # never retroactively shrink an earlier capitalization.
    interest_payment_events = sorted(
        [(p.payment_date,
          Decimal(str(p.allocated_to_current_interest or 0)) +
          Decimal(str(p.allocated_to_overdue_interest or 0)))
         for p in payments],
        key=lambda x: x[0],
    )
    ip_idx = 0
    available = Decimal("0")
    seg_start_idx = 0  # first entries[] index of the open segment
    _mi_by_idx: dict = {}  # row index → Decimal interest due (avoid float drift)

    def _allocate_segment(end_idx: int, close_capitalized: bool = False) -> Decimal:
        """Distribute `available` oldest-first across entries[seg_start_idx:end_idx].
        Returns unpaid total of the segment (the amount a cap would roll up).

        close_capitalized=True → the segment ends in a capitalization: whatever
        is unpaid here was rolled into principal, so rows show status
        "capitalized" with zero interest outstanding (it is no longer due AS
        interest — the red "Unpaid" badge was misleading users)."""
        nonlocal available
        unpaid_total = Decimal("0")
        for i in range(seg_start_idx, end_idx):
            mi_i = _mi_by_idx[i]
            pay_i = min(available, mi_i)
            available -= pay_i
            out_i = mi_i - pay_i
            unpaid_total += out_i
            entries[i]["interest_paid"] = float(pay_i)
            if out_i <= Decimal("0.005"):
                entries[i]["status"] = "paid"
                entries[i]["interest_outstanding"] = float(out_i)
            elif close_capitalized:
                entries[i]["status"] = "capitalized"
                entries[i]["interest_outstanding"] = 0.0
                entries[i]["capitalized_into_principal"] = float(out_i)
            elif pay_i > Decimal("0"):
                entries[i]["status"] = "partial"
                entries[i]["interest_outstanding"] = float(out_i)
            else:
                entries[i]["status"] = "unpaid"
                entries[i]["interest_outstanding"] = float(out_i)
        return unpaid_total

    # Manual capitalization events (only meaningful when auto-cap is OFF):
    # rebase principal/rate at the first period after each event and close the
    # display segment — mirrors _compute_outstanding.
    manual_events = []
    if not cap_enabled:
        manual_events = sorted(
            [e for e in (loan.capitalization_events or []) if e.event_date <= today],
            key=lambda e: e.event_date,
        )
    me_idx = 0

    def _apply_manual_events(p_start: date):
        nonlocal me_idx, principal, rate, seg_start_idx
        while me_idx < len(manual_events) and manual_events[me_idx].event_date < p_start:
            ev = manual_events[me_idx]
            _allocate_segment(len(entries), close_capitalized=True)
            if entries:
                entries[-1]["capitalized"] = True
                entries[-1]["capitalized_amount"] = float(ev.outstanding_interest_before or 0)
                entries[-1]["new_principal_after"] = float(ev.new_principal or 0)
            seg_start_idx = len(entries)
            principal = Decimal(str(ev.new_principal))
            if ev.interest_rate_after:
                rate = Decimal(str(ev.interest_rate_after))
            me_idx += 1

    # Track principal reductions so interest accrues on reduced balance
    principal_repayment_events = sorted(
        [(p.payment_date, Decimal(str(p.allocated_to_principal or 0)))
         for p in payments if Decimal(str(p.allocated_to_principal or 0)) > 0],
        key=lambda x: x[0],
    )
    pr_idx = 0

    # Normalize both period modes to (p_start, p_end_excl_actual, full_days, pay_due_date)
    if banking_mode:
        period_infos = _build_banking_periods(interest_start, today)
    else:
        period_infos = [
            (ps, pe, fd, ps + relativedelta(months=1))
            for ps, pe, fd in _build_monthly_periods(interest_start, today)
        ]

    for p_start, p_end_excl_actual, full_days, pay_due in period_infos:
        _apply_manual_events(p_start)
        while pr_idx < len(principal_repayment_events) and principal_repayment_events[pr_idx][0] <= p_start:
            principal = max(principal - principal_repayment_events[pr_idx][1], Decimal("0"))
            pr_idx += 1

        if principal <= Decimal("0"):
            break

        month_count += 1
        days = (p_end_excl_actual - p_start).days
        is_current = days < full_days

        calc_days = days if (is_current or banking_mode) else full_days
        monthly_interest = _calc_period_interest(
            principal, rate, p_start, calc_days, full_days, banking=banking_mode)

        # Release payments dated inside or before this period
        while ip_idx < len(interest_payment_events) and interest_payment_events[ip_idx][0] < p_end_excl_actual:
            available += interest_payment_events[ip_idx][1]
            ip_idx += 1

        # Labels
        period_end_incl = p_end_excl_actual - timedelta(days=1)
        if is_current:
            month_label = f"{p_start.strftime('%d %b')} – {today.strftime('%d %b %Y')} (in progress)"
        elif banking_mode and p_start.day != 1:
            month_label = f"{p_start.strftime('%d %b')} – {period_end_incl.strftime('%d %b %Y')}"
        elif banking_mode:
            month_label = period_end_incl.strftime("%B %Y")
        else:
            full_end_incl = p_start + relativedelta(months=1) - timedelta(days=1)
            month_label = f"{p_start.strftime('%d %b')} – {full_end_incl.strftime('%d %b %Y')}"

        _mi_by_idx[len(entries)] = monthly_interest
        entries.append({
            "month": p_start.strftime("%Y-%m-%d"),
            "month_label": month_label,
            "payment_due_date": pay_due.strftime("%d %b %Y"),
            "interest_due": float(monthly_interest),
            "interest_paid": 0.0,
            "interest_outstanding": float(monthly_interest),
            "status": "unpaid",
            "is_current_month": is_current,
            "capitalized": False,
        })

        is_cap_month = cap_enabled and (month_count % cap_every == 0)
        if is_cap_month and not is_current:
            unpaid_seg = _allocate_segment(len(entries), close_capitalized=True)
            if unpaid_seg > Decimal("0"):
                entries[-1]["capitalized"] = True
                entries[-1]["capitalized_amount"] = float(unpaid_seg)
                entries[-1]["new_principal_after"] = float(principal + unpaid_seg)
                principal += unpaid_seg
            seg_start_idx = len(entries)
            month_count = 0

    # Final (open) segment: release any remaining payments, then allocate
    while ip_idx < len(interest_payment_events):
        available += interest_payment_events[ip_idx][1]
        ip_idx += 1
    _allocate_segment(len(entries))

    return entries
