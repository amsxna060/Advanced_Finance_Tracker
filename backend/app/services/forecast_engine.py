"""
Forecast & Liquidity engine.

Single source of truth for the /api/forecast page. Generates cash-flow
items from loans / obligations / property deals / beesi, applies
user-stored ForecastOverride rows for the *current viewing period*,
groups by entity, and emits totals + a daily timeline + tier breakdown.

Item ID format
--------------
Stable, human-readable, deterministic across requests. Format:

    {kind}:{linked_id}[:{detail}]

Examples:
    loan_emi_in:47:8                  # EMI #8 of given loan 47
    loan_emi_out:51:3                 # EMI #3 of taken loan 51
    loan_int_in:47:overdue            # all currently-overdue interest on loan 47
    loan_int_in:47:upcoming:2026-05   # interest accruing during May 2026
    loan_int_out:47:overdue
    loan_int_out:47:upcoming:2026-05
    loan_princ_in:47                  # principal return of given loan 47
    loan_princ_out:51                 # principal payment of taken loan 51
    loan_st_in:47                     # short-term return
    loan_st_out:51                    # short-term repayment
    obl_in:12                         # receivable obligation
    obl_out:12                        # payable obligation
    property_in:5                     # property deal proceeds
    beesi_out:3:7                     # beesi installment month #7

Period scoping
--------------
`period_key = today.strftime("%Y-%m")`. Overrides are looked up using
this key. When the calendar month changes, last month's overrides
naturally stop applying — items reappear with engine defaults. That
gives "auto-rollover to next month" without mutating any record.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from collections import defaultdict
from typing import Optional, Dict, List, Tuple

from sqlalchemy.orm import Session

from app.models.loan import Loan
from app.models.obligation import MoneyObligation
from app.models.beesi import Beesi
from app.models.cash_account import CashAccount, AccountTransaction
from app.models.forecast_override import ForecastOverride
from app.services.interest import (
    calculate_outstanding,
    get_emi_schedule_with_payments,
    _calc_period_interest,
)

_D = lambda v: Decimal("0") if v is None else Decimal(str(v))
_ZERO = Decimal("0")


# ─────────────────────────────────────────────────────────────────────────────
# Period helpers
# ─────────────────────────────────────────────────────────────────────────────

def current_period_key(today: Optional[date] = None) -> str:
    return (today or date.today()).strftime("%Y-%m")


def _emi_effective_date(due_date: date) -> date:
    """
    Business rule: an EMI whose due date falls on the 1st or 2nd of a calendar
    month is, financially, the obligation for the *previous* month — many
    lenders schedule payment for the start of the next month but it represents
    the prior month's interest/principal cycle.

    Returns the date used for window-membership ("does it fall in this 30d
    view?") and overdue / period-key calculations. The original `due_date`
    is still surfaced to the user.
    """
    if due_date.day in (1, 2):
        # last day of the previous calendar month
        first_of_month = date(due_date.year, due_date.month, 1)
        return first_of_month - timedelta(days=1)
    return due_date


def _month_periods_within(start: date, end: date) -> List[Tuple[date, date, str]]:
    """
    Split [start, end] into calendar-month chunks. Returns list of
    (chunk_start, chunk_end_inclusive, period_key).
    """
    out: List[Tuple[date, date, str]] = []
    if start > end:
        return out
    cur = start
    while cur <= end:
        if cur.month == 12:
            next_month_first = date(cur.year + 1, 1, 1)
        else:
            next_month_first = date(cur.year, cur.month + 1, 1)
        chunk_end = min(end, next_month_first - timedelta(days=1))
        out.append((cur, chunk_end, cur.strftime("%Y-%m")))
        cur = next_month_first
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Confidence heuristic for given loans (interest_only)
# ─────────────────────────────────────────────────────────────────────────────

def _build_last_payment_map(loans_given: List[Loan]) -> Dict[int, date]:
    out: Dict[int, date] = {}
    for loan in loans_given:
        for p in (loan.payments or []):
            if p.payment_date:
                cur = out.get(loan.id)
                if cur is None or p.payment_date > cur:
                    out[loan.id] = p.payment_date
    return out


def _interest_payer_confidence(loan_id: int, today: date, last_pay: Dict[int, date]) -> str:
    last = last_pay.get(loan_id)
    if last is None:
        return "low"
    days_since = (today - last).days
    if days_since <= 30:
        return "high"
    if days_since <= 60:
        return "medium"
    return "low"


def _given_loan_confidence(loan: Loan, today: date, last_pay: Dict[int, date]) -> str:
    if loan.loan_type in ("emi", "short_term"):
        return "high"
    if loan.loan_type == "interest_only":
        return _interest_payer_confidence(loan.id, today, last_pay)
    return "low"


def _remaining_principal(loan: Loan) -> Decimal:
    paid = sum(_D(p.allocated_to_principal) for p in (loan.payments or []) if p.allocated_to_principal)
    return max(_D(loan.principal_amount) - paid, _ZERO)


def _contact_label(loan: Loan) -> str:
    if loan.contact:
        return loan.contact.name
    return loan.institution_name or f"Contact #{loan.contact_id}"


# ─────────────────────────────────────────────────────────────────────────────
# Item generators (return list of raw dicts — no overrides applied yet)
# ─────────────────────────────────────────────────────────────────────────────

def _entity_for_loan(loan: Loan) -> Tuple[str, str, Optional[str]]:
    """Returns (entity_key, entity_name, linked_url)."""
    if loan.contact_id:
        return f"contact:{loan.contact_id}", _contact_label(loan), f"/contacts/{loan.contact_id}"
    return f"institution:{loan.institution_name or loan.id}", _contact_label(loan), f"/loans/{loan.id}"


def _loan_inflow_items(
    loan: Loan, today: date, from_dt: date, to_dt: date,
    last_pay: Dict[int, date], db: Session,
) -> List[dict]:
    items: List[dict] = []
    entity_key, entity_name, entity_url = _entity_for_loan(loan)
    conf = _given_loan_confidence(loan, today, last_pay)
    base = {
        "direction": "inflow",
        "entity_key": entity_key,
        "entity_name": entity_name,
        "entity_type": "contact" if loan.contact_id else "institution",
        "entity_url": entity_url,
        "linked_id": loan.id,
        "linked_url": f"/loans/{loan.id}",
    }

    if loan.loan_type == "emi":
        schedule = get_emi_schedule_with_payments(loan, db)
        for entry in schedule:
            dd: date = entry["due_date"]
            if entry["status"] == "paid":
                continue
            remaining = float(entry["outstanding"] or 0)
            if remaining <= 0:
                continue
            eff = _emi_effective_date(dd)
            is_overdue = eff < today
            # Strict < boundary: EMI belongs in window if its *effective* date is
            # in [from_dt, to_dt). 1st/2nd-of-month EMIs map to prev month-end so
            # they correctly appear in the prior month's view.
            if not is_overdue and not (from_dt <= eff < to_dt):
                continue
            items.append({**base,
                "id": f"loan_emi_in:{loan.id}:{entry['emi_number']}",
                "kind": "loan_emi",
                "label": f"EMI #{entry['emi_number']}",
                "amount": remaining,
                "due_date": dd.isoformat(),
                "is_overdue": is_overdue,
                "confidence": conf,
                "period_key": eff.strftime("%Y-%m"),
            })
        return items

    if loan.loan_type == "interest_only":
        rate = _D(loan.interest_rate)
        if rate <= 0:
            return items
        principal = _D(loan.principal_amount)
        start = loan.interest_start_date or loan.disbursed_date
        if not start:
            return items

        # 1) overdue interest (always shown, single row)
        outstanding = calculate_outstanding(loan.id, today, db)
        overdue = outstanding["interest_outstanding"]
        if overdue > _ZERO:
            items.append({**base,
                "id": f"loan_int_in:{loan.id}:overdue",
                "kind": "loan_interest",
                "label": f"Overdue interest ({rate}% p.a.)",
                "amount": float(overdue.quantize(Decimal("0.01"))),
                "due_date": None,
                "is_overdue": True,
                "confidence": conf,
                "period_key": today.strftime("%Y-%m"),
            })

        # 2) upcoming interest, split per month within the window
        # Strict < boundary: window is [from_dt, to_dt). Inclusive end = to_dt - 1 day.
        if conf in ("high", "medium"):
            future_start = max(from_dt, today)
            window_end_inclusive = to_dt - timedelta(days=1)
            for chunk_start, chunk_end, pk in _month_periods_within(future_start, window_end_inclusive):
                days = (chunk_end - chunk_start).days + 1
                if days <= 0:
                    continue
                amt = _calc_period_interest(principal, rate, chunk_start, days)
                if amt <= 0:
                    continue
                items.append({**base,
                    "id": f"loan_int_in:{loan.id}:upcoming:{pk}",
                    "kind": "loan_interest",
                    "label": f"Interest {chunk_start.strftime('%d %b')}–{chunk_end.strftime('%d %b')} ({rate}% p.a.)",
                    "amount": float(amt.quantize(Decimal("0.01"))),
                    "due_date": chunk_end.isoformat(),
                    "is_overdue": False,
                    "confidence": conf if conf == "high" else "medium",
                    "period_key": pk,
                })

        # 3) principal return
        if loan.expected_end_date:
            end_dt = loan.expected_end_date
            is_past = end_dt < today
            if is_past or end_dt < to_dt:
                rem = _remaining_principal(loan)
                if rem > 0:
                    items.append({**base,
                        "id": f"loan_princ_in:{loan.id}",
                        "kind": "loan_principal",
                        "label": ("Overdue principal return"
                                  if is_past else "Principal return (expected end date)"),
                        "amount": float(rem),
                        "due_date": end_dt.isoformat(),
                        "is_overdue": is_past,
                        "confidence": "low" if conf == "low" else "medium",
                        "period_key": (today if is_past else end_dt).strftime("%Y-%m"),
                    })
        return items

    if loan.loan_type == "short_term":
        rem = _remaining_principal(loan)
        if rem <= 0:
            return items
        end = loan.expected_end_date or loan.interest_free_till
        if end:
            is_past = end < today
            if is_past or end < to_dt:
                items.append({**base,
                    "id": f"loan_st_in:{loan.id}",
                    "kind": "loan_principal",
                    "label": ("Overdue: short-term return"
                              if is_past else "Short-term loan return"),
                    "amount": float(rem),
                    "due_date": end.isoformat(),
                    "is_overdue": is_past,
                    "confidence": conf,
                    "period_key": (today if is_past else end).strftime("%Y-%m"),
                })
        else:
            items.append({**base,
                "id": f"loan_st_in:{loan.id}",
                "kind": "loan_principal",
                "label": "Short-term loan return (no due date)",
                "amount": float(rem),
                "due_date": None,
                "is_overdue": False,
                "confidence": "low",
                "period_key": today.strftime("%Y-%m"),
            })
    return items


def _loan_outflow_items(loan: Loan, today: date, from_dt: date, to_dt: date, db: Session) -> List[dict]:
    """Loans we have *taken* — strict obligations, always 'high' confidence."""
    items: List[dict] = []
    entity_key, entity_name, entity_url = _entity_for_loan(loan)
    base = {
        "direction": "outflow",
        "entity_key": entity_key,
        "entity_name": entity_name,
        "entity_type": "contact" if loan.contact_id else "institution",
        "entity_url": entity_url,
        "linked_id": loan.id,
        "linked_url": f"/loans/{loan.id}",
        "confidence": "high",
    }

    if loan.loan_type == "emi":
        schedule = get_emi_schedule_with_payments(loan, db)
        for entry in schedule:
            dd: date = entry["due_date"]
            if entry["status"] == "paid":
                continue
            remaining = float(entry["outstanding"] or 0)
            if remaining <= 0:
                continue
            eff = _emi_effective_date(dd)
            is_overdue = eff < today
            if not is_overdue and not (from_dt <= eff < to_dt):
                continue
            items.append({**base,
                "id": f"loan_emi_out:{loan.id}:{entry['emi_number']}",
                "kind": "loan_emi",
                "label": f"EMI #{entry['emi_number']}" + (" (overdue)" if is_overdue else ""),
                "amount": remaining,
                "due_date": dd.isoformat(),
                "is_overdue": is_overdue,
                "period_key": eff.strftime("%Y-%m"),
            })
        return items

    if loan.loan_type == "interest_only":
        rate = _D(loan.interest_rate)
        if rate <= 0:
            return items
        principal = _D(loan.principal_amount)

        outstanding = calculate_outstanding(loan.id, today, db)
        overdue = outstanding["interest_outstanding"]
        if overdue > _ZERO:
            items.append({**base,
                "id": f"loan_int_out:{loan.id}:overdue",
                "kind": "loan_interest",
                "label": f"Overdue interest ({rate}% p.a.)",
                "amount": float(overdue.quantize(Decimal("0.01"))),
                "due_date": None,
                "is_overdue": True,
                "period_key": today.strftime("%Y-%m"),
            })

        future_start = max(from_dt, today)
        window_end_inclusive = to_dt - timedelta(days=1)
        for chunk_start, chunk_end, pk in _month_periods_within(future_start, window_end_inclusive):
            days = (chunk_end - chunk_start).days + 1
            if days <= 0:
                continue
            amt = _calc_period_interest(principal, rate, chunk_start, days)
            if amt <= 0:
                continue
            items.append({**base,
                "id": f"loan_int_out:{loan.id}:upcoming:{pk}",
                "kind": "loan_interest",
                "label": f"Interest {chunk_start.strftime('%d %b')}–{chunk_end.strftime('%d %b')} ({rate}% p.a.)",
                "amount": float(amt.quantize(Decimal("0.01"))),
                "due_date": chunk_end.isoformat(),
                "is_overdue": False,
                "period_key": pk,
            })

        if loan.expected_end_date:
            end_dt = loan.expected_end_date
            rem = _remaining_principal(loan)
            if rem > 0:
                is_past = end_dt < today
                if is_past or end_dt < to_dt:
                    items.append({**base,
                        "id": f"loan_princ_out:{loan.id}",
                        "kind": "loan_principal",
                        "label": ("Overdue principal payment"
                                  if is_past else "Principal payment (expected end date)"),
                        "amount": float(rem),
                        "due_date": end_dt.isoformat(),
                        "is_overdue": is_past,
                        "period_key": (today if is_past else end_dt).strftime("%Y-%m"),
                    })
        return items

    if loan.loan_type == "short_term":
        rem = _remaining_principal(loan)
        if rem <= 0:
            return items
        end = loan.expected_end_date or loan.interest_free_till
        if end:
            is_past = end < today
            if is_past or end < to_dt:
                items.append({**base,
                    "id": f"loan_st_out:{loan.id}",
                    "kind": "loan_principal",
                    "label": ("Overdue: short-term repayment"
                              if is_past else "Short-term loan repayment"),
                    "amount": float(rem),
                    "due_date": end.isoformat(),
                    "is_overdue": is_past,
                    "period_key": (today if is_past else end).strftime("%Y-%m"),
                })
    return items


def _obligation_items(obl: MoneyObligation, today: date, from_dt: date, to_dt: date) -> List[dict]:
    # Property-linked obligations belong to the Property Analytics page, not here.
    if (obl.linked_type or "").lower() == "property":
        return []
    remaining = _D(obl.amount) - _D(obl.amount_settled)
    if remaining <= _ZERO:
        return []
    is_overdue = bool(obl.due_date and obl.due_date < today)
    # Strict < boundary: an obligation due exactly on `to_dt` belongs to the next window.
    in_window = (obl.due_date and from_dt <= obl.due_date < to_dt) or (obl.due_date is None)
    if not is_overdue and not in_window:
        return []

    direction = "inflow" if obl.obligation_type == "receivable" else "outflow"
    days_overdue = (today - obl.due_date).days if is_overdue else 0
    if direction == "inflow":
        confidence = "low" if days_overdue > 90 else ("medium" if is_overdue else "high")
    else:
        confidence = "high"

    if obl.contact_id and obl.contact:
        entity_key = f"contact:{obl.contact_id}"
        entity_name = obl.contact.name
        entity_type = "contact"
        entity_url = f"/contacts/{obl.contact_id}"
    else:
        entity_key = f"obligation:{obl.id}"
        entity_name = obl.reason or "Unlinked obligation"
        entity_type = "obligation"
        entity_url = "/obligations"

    return [{
        "id": f"obl_{'in' if direction == 'inflow' else 'out'}:{obl.id}",
        "kind": "obligation",
        "direction": direction,
        "entity_key": entity_key,
        "entity_name": entity_name,
        "entity_type": entity_type,
        "entity_url": entity_url,
        "linked_id": obl.id,
        "linked_url": "/obligations",
        "label": obl.reason or obl.obligation_type.capitalize(),
        "amount": float(remaining),
        "due_date": obl.due_date.isoformat() if obl.due_date else None,
        "is_overdue": is_overdue,
        "confidence": confidence,
        "period_key": (today if is_overdue else (obl.due_date or today)).strftime("%Y-%m"),
    }]


def _add_months(d: date, months: int) -> date:
    """Same month-day in d + months (clamped to month length)."""
    month0 = d.month - 1 + months
    year = d.year + month0 // 12
    month = month0 % 12 + 1
    # clamp day
    from calendar import monthrange
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def _beesi_outflow_items(beesi: Beesi, today: date, from_dt: date, to_dt: date) -> List[dict]:
    """My monthly base_installment for unpaid months within window."""
    items: List[dict] = []
    if beesi.status != "active":
        return items
    base_amt = _D(beesi.base_installment)
    if base_amt <= 0:
        return items
    paid_months = {i.month_number for i in (beesi.installments or [])}

    if beesi.contact_id and beesi.contact:
        entity_key = f"contact:{beesi.contact_id}"
        entity_name = f"{beesi.contact.name} ({beesi.title})"
        entity_type = "contact"
        entity_url = f"/contacts/{beesi.contact_id}"
    else:
        entity_key = f"beesi:{beesi.id}"
        entity_name = beesi.title
        entity_type = "beesi"
        entity_url = f"/beesi/{beesi.id}"

    for n in range(1, (beesi.tenure_months or 0) + 1):
        if n in paid_months:
            continue
        approx_due = _add_months(beesi.start_date, n - 1)
        eff = _emi_effective_date(approx_due)  # apply 1st/2nd-of-month rule for beesi too
        is_overdue = eff < today
        if not is_overdue and not (from_dt <= eff < to_dt):
            continue
        items.append({
            "id": f"beesi_out:{beesi.id}:{n}",
            "kind": "beesi",
            "direction": "outflow",
            "entity_key": entity_key,
            "entity_name": entity_name,
            "entity_type": entity_type,
            "entity_url": entity_url,
            "linked_id": beesi.id,
            "linked_url": f"/beesi/{beesi.id}",
            "label": f"Installment month #{n}",
            "amount": float(base_amt),
            "due_date": approx_due.isoformat(),
            "is_overdue": is_overdue,
            "confidence": "high",
            "period_key": eff.strftime("%Y-%m"),
        })
    return items


# ─────────────────────────────────────────────────────────────────────────────
# Override application + grouping + totals + timeline
# ─────────────────────────────────────────────────────────────────────────────

def _load_overrides(
    db: Session, user_id: int, period_key: str, item_ids: List[str],
) -> Dict[str, ForecastOverride]:
    if not item_ids:
        return {}
    rows = (
        db.query(ForecastOverride)
        .filter(
            ForecastOverride.user_id == user_id,
            ForecastOverride.period_key == period_key,
            ForecastOverride.item_id.in_(item_ids),
        )
        .all()
    )
    return {r.item_id: r for r in rows}


def _apply_overrides(items: List[dict], overrides: Dict[str, ForecastOverride]) -> List[dict]:
    for it in items:
        ov = overrides.get(it["id"])
        if ov is None:
            it["effective_amount"] = it["amount"]
            it["override"] = None
            continue
        ov_amount = float(ov.amount_override) if ov.amount_override is not None else None
        it["effective_amount"] = ov_amount if ov_amount is not None else it["amount"]
        it["override"] = {
            "id": ov.id,
            "included": ov.included,
            "amount_override": ov_amount,
            "status": ov.status,
            "fulfilled_amount": float(ov.fulfilled_amount) if ov.fulfilled_amount is not None else None,
            "fulfilled_at": ov.fulfilled_at.isoformat() if ov.fulfilled_at else None,
            "notes": ov.notes,
        }
    return items


def _is_included(it: dict) -> bool:
    """Counts toward expected/required totals?"""
    ov = it.get("override")
    if ov is None:
        return True
    if ov["status"] == "fulfilled":
        return False  # fulfilled items shown separately
    if ov["status"] == "skipped":
        return False
    if ov["included"] is False:
        return False
    return True


def _is_fulfilled(it: dict) -> bool:
    ov = it.get("override")
    return bool(ov and ov["status"] == "fulfilled")


def _group(items: List[dict], direction: str) -> List[dict]:
    by_entity: Dict[str, dict] = {}
    for it in items:
        if it["direction"] != direction:
            continue
        g = by_entity.setdefault(it["entity_key"], {
            "key": it["entity_key"],
            "entity_name": it["entity_name"],
            "entity_type": it["entity_type"],
            "entity_url": it.get("entity_url"),
            "items": [],
            "calculated_total": 0.0,
            "expected_total": 0.0,
            "fulfilled_total": 0.0,
            "skipped_total": 0.0,
            "item_count": 0,
            "has_overdue": False,
        })
        g["items"].append(it)
        g["calculated_total"] += it["effective_amount"]
        g["item_count"] += 1
        if it.get("is_overdue"):
            g["has_overdue"] = True
        if _is_fulfilled(it):
            g["fulfilled_total"] += it["effective_amount"]
        elif _is_included(it):
            g["expected_total"] += it["effective_amount"]
        else:
            g["skipped_total"] += it["effective_amount"]

    groups = list(by_entity.values())
    # sort items inside each group: overdue first, then by due_date
    for g in groups:
        g["items"].sort(key=lambda x: (
            0 if x.get("is_overdue") else 1,
            x.get("due_date") or "9999-12-31",
        ))
    # sort groups by expected_total desc
    groups.sort(key=lambda g: -g["expected_total"])
    return groups


def _compute_totals(items: List[dict]) -> dict:
    expected_in = 0.0
    expected_out = 0.0
    fulfilled_in = 0.0
    fulfilled_out = 0.0
    overdue_in = 0.0
    overdue_out = 0.0
    calc_in = 0.0
    calc_out = 0.0

    for it in items:
        amt = it["effective_amount"]
        is_in = it["direction"] == "inflow"
        if is_in:
            calc_in += amt
        else:
            calc_out += amt
        if it.get("is_overdue"):
            if is_in:
                overdue_in += amt
            else:
                overdue_out += amt
        if _is_fulfilled(it):
            if is_in:
                fulfilled_in += amt
            else:
                fulfilled_out += amt
        elif _is_included(it):
            if is_in:
                expected_in += amt
            else:
                expected_out += amt

    return {
        "calculated_inflow": round(calc_in, 2),
        "expected_inflow": round(expected_in, 2),
        "fulfilled_inflow": round(fulfilled_in, 2),
        "overdue_inflow": round(overdue_in, 2),
        "calculated_outflow": round(calc_out, 2),
        "required_outflow": round(expected_out, 2),
        "fulfilled_outflow": round(fulfilled_out, 2),
        "overdue_outflow": round(overdue_out, 2),
        "net_liquidity": round(expected_in - expected_out, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Balances + liquidity + timeline
# ─────────────────────────────────────────────────────────────────────────────

def _compute_balances(db: Session) -> dict:
    accounts = db.query(CashAccount).filter(CashAccount.is_deleted == False).all()
    cash = _ZERO
    bank = _ZERO
    items = []
    for acct in accounts:
        running = _D(acct.opening_balance)
        for t in (acct.transactions or []):
            if t.txn_type == "credit":
                running += _D(t.amount)
            else:
                running -= _D(t.amount)
        is_cash = acct.account_type == "cash"
        is_credit = acct.account_type == "credit_card"
        if is_credit:
            # credit cards reduce liquidity (negative balance owed); skip from totals
            pass
        elif is_cash:
            cash += running
        else:
            bank += running
        items.append({
            "id": acct.id,
            "name": acct.name,
            "type": acct.account_type,
            "balance": float(running),
            "mode": "cash" if is_cash else ("credit" if is_credit else "bank"),
        })
    return {
        "cash": float(cash),
        "bank": float(bank),
        "total_liquid": float(cash + bank),
        "accounts": items,
    }


def _compute_timeline(items: List[dict], today: date, to_dt: date, opening_balance: float) -> List[dict]:
    """Daily series for charting: inflow / outflow / running balance."""
    daily_in: Dict[str, float] = defaultdict(float)
    daily_out: Dict[str, float] = defaultdict(float)
    for it in items:
        if not _is_included(it):
            continue
        # bucket overdue items into "today" so the line moves
        if it.get("is_overdue") or not it.get("due_date"):
            day = today.isoformat()
        else:
            day = it["due_date"]
            if day < today.isoformat():
                day = today.isoformat()
            if day > to_dt.isoformat():
                continue
        if it["direction"] == "inflow":
            daily_in[day] += it["effective_amount"]
        else:
            daily_out[day] += it["effective_amount"]

    out: List[dict] = []
    running = opening_balance
    cur = today
    while cur <= to_dt:
        key = cur.isoformat()
        inflow = round(daily_in.get(key, 0.0), 2)
        outflow = round(daily_out.get(key, 0.0), 2)
        running += inflow - outflow
        out.append({
            "date": key,
            "day_label": cur.strftime("%d %b"),
            "inflow": inflow,
            "outflow": outflow,
            "running_balance": round(running, 2),
        })
        cur += timedelta(days=1)
    return out


def _compute_liquidity(balances: dict, items: List[dict], today: date, to_dt: date) -> dict:
    horizon_days = max((to_dt - today).days, 1)
    liquid = balances["total_liquid"]
    required = sum(it["effective_amount"] for it in items
                   if it["direction"] == "outflow" and _is_included(it))
    if required <= 0:
        return {"ok": True, "coverage_ratio": 999.0, "runway_days": 9999,
                "liquid_balance": liquid, "required_outflow": 0.0}
    coverage = liquid / required if required else 999.0
    daily_burn = required / horizon_days
    runway = liquid / daily_burn if daily_burn > 0 else 9999
    return {
        "ok": coverage >= 1.0,
        "coverage_ratio": round(coverage, 2),
        "runway_days": int(runway),
        "liquid_balance": liquid,
        "required_outflow": round(required, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def build_forecast(db: Session, user_id: int, from_date: date, to_date: date) -> dict:
    today = date.today()
    period_key = current_period_key(today)

    active_loans = db.query(Loan).filter(
        Loan.is_deleted == False, Loan.status == "active",
    ).all()
    loans_given = [l for l in active_loans if l.loan_direction == "given"]
    loans_taken = [l for l in active_loans if l.loan_direction == "taken"]
    last_pay = _build_last_payment_map(loans_given)

    items: List[dict] = []
    for loan in loans_given:
        items.extend(_loan_inflow_items(loan, today, from_date, to_date, last_pay, db))
    for loan in loans_taken:
        items.extend(_loan_outflow_items(loan, today, from_date, to_date, db))

    obls = db.query(MoneyObligation).filter(
        MoneyObligation.is_deleted == False,
        MoneyObligation.status.in_(["pending", "partial"]),
    ).all()
    for obl in obls:
        items.extend(_obligation_items(obl, today, from_date, to_date))

    beesis = db.query(Beesi).filter(Beesi.is_deleted == False, Beesi.status == "active").all()
    for b in beesis:
        items.extend(_beesi_outflow_items(b, today, from_date, to_date))

    overrides = _load_overrides(db, user_id, period_key, [it["id"] for it in items])
    items = _apply_overrides(items, overrides)

    balances = _compute_balances(db)

    return {
        "as_of_date": today.isoformat(),
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "timeframe_days": (to_date - from_date).days,
        "period_key": period_key,
        "totals": _compute_totals(items),
        "balances": balances,
        "liquidity": _compute_liquidity(balances, items, today, to_date),
        "inflow_groups": _group(items, "inflow"),
        "outflow_groups": _group(items, "outflow"),
        "timeline": _compute_timeline(items, today, to_date, balances["total_liquid"]),
    }
