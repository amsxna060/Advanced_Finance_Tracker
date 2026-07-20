from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import or_, func
from typing import List, Optional
from decimal import Decimal
from datetime import date, timedelta
import calendar as _cal

from pydantic import BaseModel
from dateutil.relativedelta import relativedelta

from app.database import get_db
from app.dependencies import get_current_user, require_write_access
from app.models.user import User
from app.models.contact import Contact
from app.models.loan import Loan, LoanPayment
from app.models.collateral import Collateral
from app.models.property_deal import PropertyDeal
from app.models.partnership import Partnership, PartnershipMember
from app.models.beesi import Beesi
from app.models.obligation import MoneyObligation
from app.schemas.contact import ContactCreate, ContactUpdate, ContactOut
from app.services.interest import (
    calculate_outstanding,
    calculate_outstanding_from_loan,
    _solve_emi_monthly_rate,
    _generate_emi_amortization,
    _build_monthly_periods,
    _calc_period_interest,
)


def _segment_interest(principal: Decimal, annual_rate: Decimal,
                       from_date: date, to_date_inclusive: date,
                       banking: bool = False) -> Decimal:
    """Gross interest from from_date to to_date_inclusive (both inclusive)."""
    if to_date_inclusive < from_date or annual_rate <= 0 or principal <= 0:
        return Decimal("0")
    if banking:
        days = (to_date_inclusive - from_date).days + 1
        yr = from_date.year
        days_in_year = 366 if _cal.isleap(yr) else 365
        return (principal * annual_rate / Decimal("100") * Decimal(str(days)) / Decimal(str(days_in_year))).quantize(Decimal("0.01"))
    # Commercial: flat monthly, prorated by days for partial months
    monthly_rate = annual_rate / Decimal("1200")
    total = Decimal("0")
    cur = from_date
    while cur <= to_date_inclusive:
        month_last = date(cur.year, cur.month, _cal.monthrange(cur.year, cur.month)[1])
        period_end = min(to_date_inclusive, month_last)
        full_days = _cal.monthrange(cur.year, cur.month)[1]
        actual_days = (period_end - cur).days + 1
        if actual_days < full_days:
            total += principal * monthly_rate * Decimal(str(actual_days)) / Decimal(str(full_days))
        else:
            total += principal * monthly_rate
        if period_end >= to_date_inclusive:
            break
        cur = date(cur.year, cur.month, 1) + relativedelta(months=1)
    return total.quantize(Decimal("0.01"))


def _build_interest_segments(loan, as_of_date: date) -> Optional[list]:
    """
    For interest_only loans that have capitalisation (auto or manual DB events),
    return a list of period/cap_event segments for the statement breakdown.
    Returns None if there is no capitalisation at all.
    """
    banking = getattr(loan, "interest_calc_method", "commercial") == "banking_365"
    interest_start = loan.interest_start_date or loan.disbursed_date

    cap_enabled = bool(loan.capitalization_enabled) and (loan.capitalization_after_months or 0) > 0
    db_cap_events = sorted(
        [e for e in loan.capitalization_events if e.event_date <= as_of_date],
        key=lambda e: e.event_date,
    )

    # ── If neither auto-cap nor any DB cap events exist → simple loan, no segments ──
    if not cap_enabled and not db_cap_events:
        return None

    # ── Auto-capitalisation: compute segments mathematically ──────────────────
    if cap_enabled:
        cap_every = loan.capitalization_after_months
        calc_principal = Decimal(str(loan.principal_amount))
        calc_rate = Decimal(str(loan.interest_rate or 0))

        # L8 fix: release interest payments chronologically — a payment can only
        # offset interest accrued by its date, and capitalizations that happened
        # before it stay untouched (matches _compute_outstanding).
        _ip_events = sorted(
            [(p.payment_date,
              Decimal(str(p.allocated_to_current_interest or 0)) +
              Decimal(str(p.allocated_to_overdue_interest or 0)))
             for p in loan.payments if not getattr(p, "is_voided", False)],
            key=lambda x: x[0],
        )
        _ip_idx = 0
        _available = Decimal("0")

        segments = []
        seg_no = 1
        month_count = 0
        unpaid_carried = Decimal("0")
        seg_start = interest_start
        seg_months: list = []  # (p_start, p_end_excl, mi) per monthly period in this segment

        for p_start, p_end_excl, full_days in _build_monthly_periods(interest_start, as_of_date):
            days = (p_end_excl - p_start).days
            mi = _calc_period_interest(calc_principal, calc_rate, p_start, days, full_days, banking=banking)
            month_count += 1
            seg_months.append((p_start, p_end_excl, mi))

            while _ip_idx < len(_ip_events) and _ip_events[_ip_idx][0] < p_end_excl:
                _available += _ip_events[_ip_idx][1]
                _ip_idx += 1

            unpaid_carried += mi
            _take = min(_available, unpaid_carried)
            unpaid_carried -= _take
            _available -= _take

            is_cap_month = (month_count % cap_every == 0)
            is_past = (p_end_excl - timedelta(days=1)) < as_of_date

            if is_cap_month and unpaid_carried > Decimal("0") and is_past:
                # Close this pre-cap segment
                gross_seg = sum(m[2] for m in seg_months)
                paid_seg = max(gross_seg - unpaid_carried, Decimal("0"))
                seg_end_inclusive = p_end_excl - timedelta(days=1)
                dur = relativedelta(seg_end_inclusive + timedelta(days=1), seg_start)
                segments.append({
                    "type": "period",
                    "segment_no": seg_no,
                    "from_date": seg_start.isoformat(),
                    "to_date": seg_end_inclusive.isoformat(),
                    "duration_years": dur.years,
                    "duration_months": dur.months,
                    "duration_days": dur.days,
                    "principal": float(calc_principal),
                    "annual_rate": float(calc_rate),
                    "monthly_interest": float((calc_principal * calc_rate / Decimal("1200")).quantize(Decimal("0.01"))),
                    "gross_interest": float(gross_seg),
                    "interest_paid": float(paid_seg),
                    "interest_capitalized": float(unpaid_carried),
                })
                new_principal = calc_principal + unpaid_carried
                segments.append({
                    "type": "cap_event",
                    "event_date": p_end_excl.isoformat(),
                    "principal_before": float(calc_principal),
                    "interest_capitalized": float(unpaid_carried),
                    "new_principal": float(new_principal),
                    "interest_rate_after": float(calc_rate),
                    "notes": None,
                })
                calc_principal = new_principal
                unpaid_carried = Decimal("0")
                month_count = 0
                seg_no += 1
                seg_start = p_end_excl
                seg_months = []

        # Final (current) segment
        if seg_months:
            gross_final = sum(m[2] for m in seg_months)
            dur = relativedelta(as_of_date, seg_start)
            segments.append({
                "type": "current_period",
                "segment_no": seg_no,
                "from_date": seg_start.isoformat(),
                "to_date": as_of_date.isoformat(),
                "duration_years": dur.years,
                "duration_months": dur.months,
                "duration_days": dur.days,
                "principal": float(calc_principal),
                "annual_rate": float(calc_rate),
                "monthly_interest": float((calc_principal * calc_rate / Decimal("1200")).quantize(Decimal("0.01"))),
                "gross_interest": float(gross_final),
            })

        # If no cap events actually fired yet (loan < cap_every months old) → no segments needed
        if not any(s["type"] == "cap_event" for s in segments):
            return None

        return segments

    # ── Manual DB cap events (legacy path) ────────────────────────────────────
    start = interest_start
    principal = Decimal(str(loan.principal_amount))
    rate = Decimal(str(loan.interest_rate or 0))
    segments = []
    seg_no = 1

    for cap in db_cap_events:
        end_inclusive = cap.event_date - timedelta(days=1)
        gross = _segment_interest(principal, rate, start, end_inclusive, banking)
        cap_interest = Decimal(str(cap.outstanding_interest_before))
        interest_paid_in_seg = max(gross - cap_interest, Decimal("0"))
        delta = relativedelta(cap.event_date, start)

        segments.append({
            "type": "period",
            "segment_no": seg_no,
            "from_date": start.isoformat(),
            "to_date": end_inclusive.isoformat(),
            "duration_years": delta.years,
            "duration_months": delta.months,
            "duration_days": delta.days,
            "principal": float(principal),
            "annual_rate": float(rate),
            "monthly_interest": float((principal * rate / Decimal("1200")).quantize(Decimal("0.01"))),
            "gross_interest": float(gross),
            "interest_paid": float(interest_paid_in_seg),
            "interest_capitalized": float(cap_interest),
        })
        segments.append({
            "type": "cap_event",
            "event_date": cap.event_date.isoformat(),
            "principal_before": float(cap.principal_before),
            "interest_capitalized": float(cap.outstanding_interest_before),
            "new_principal": float(cap.new_principal),
            "interest_rate_after": float(cap.interest_rate_after) if cap.interest_rate_after else float(rate),
            "notes": cap.notes,
        })
        start = cap.event_date
        principal = Decimal(str(cap.new_principal))
        if cap.interest_rate_after:
            rate = Decimal(str(cap.interest_rate_after))
        seg_no += 1

    if start <= as_of_date:
        gross_final = _segment_interest(principal, rate, start, as_of_date, banking)
        delta = relativedelta(as_of_date, start)
        segments.append({
            "type": "current_period",
            "segment_no": seg_no,
            "from_date": start.isoformat(),
            "to_date": as_of_date.isoformat(),
            "duration_years": delta.years,
            "duration_months": delta.months,
            "duration_days": delta.days,
            "principal": float(principal),
            "annual_rate": float(rate),
            "monthly_interest": float((principal * rate / Decimal("1200")).quantize(Decimal("0.01"))),
            "gross_interest": float(gross_final),
        })

    return segments


class StatementRequest(BaseModel):
    loan_ids: List[int] = []
    obligation_ids: List[int] = []
    as_of_date: date
    signature_name: Optional[str] = None

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


@router.get("", response_model=List[ContactOut])
def get_contacts(
    search: Optional[str] = None,
    contact_type: Optional[str] = None,
    relationship_type: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get list of contacts with optional filters and pagination"""
    query = db.query(Contact).filter(Contact.is_deleted == False, Contact.is_legacy == False)
    
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Contact.name.ilike(search_filter),
                Contact.phone.ilike(search_filter),
                Contact.city.ilike(search_filter)
            )
        )
    
    if contact_type:
        query = query.filter(Contact.contact_type == contact_type)
    
    if relationship_type:
        query = query.filter(Contact.relationship_type == relationship_type)
    
    contacts = query.order_by(Contact.name).offset(skip).limit(limit).all()
    return contacts


@router.post("", response_model=ContactOut)
def create_contact(
    contact_data: ContactCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Create a new contact"""
    # Check duplicate: name + phone (when phone provided), else name + city
    dedup_filters = [
        Contact.is_deleted == False,
        func.lower(Contact.name) == contact_data.name.strip().lower(),
    ]
    if contact_data.phone and contact_data.phone.strip():
        dedup_filters.append(Contact.phone == contact_data.phone.strip())
    elif contact_data.city and contact_data.city.strip():
        dedup_filters.append(func.lower(Contact.city) == contact_data.city.strip().lower())
    else:
        # No phone AND no city — skip dedup (name alone is not enough)
        dedup_filters = None

    existing = None
    if dedup_filters:
        existing = db.query(Contact).filter(*dedup_filters).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Contact '{existing.name}' (Phone: {existing.phone or 'N/A'}) already exists (ID {existing.id}). Use the existing contact instead.",
        )
    
    new_contact = Contact(**contact_data.model_dump())
    db.add(new_contact)
    db.commit()
    db.refresh(new_contact)
    return new_contact


@router.get("/{contact_id}", response_model=dict)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get contact details with summary of all dealings"""
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Calculate summary statistics — eager-load payment history to avoid N+1
    loans_given = db.query(Loan).filter(
        Loan.contact_id == contact_id,
        Loan.loan_direction == "given",
        Loan.is_deleted == False
    ).options(selectinload(Loan.payments), selectinload(Loan.capitalization_events)).all()

    loans_taken = db.query(Loan).filter(
        Loan.contact_id == contact_id,
        Loan.loan_direction == "taken",
        Loan.is_deleted == False
    ).options(selectinload(Loan.payments), selectinload(Loan.capitalization_events)).all()
    
    total_lent_historical = sum(Decimal(str(loan.principal_amount)) for loan in loans_given)
    total_borrowed_closed = sum(
        Decimal(str(loan.principal_amount)) for loan in loans_taken if loan.status == "closed"
    )
    active_loans_count = len([l for l in loans_given + loans_taken if l.status == "active"])

    # Calculate outstanding + interest across all active loans for this contact.
    # total_lent / total_borrowed: for EMI loans use actual principal_outstanding (repayments
    # reduce principal); for interest-only/short-term use original principal_amount (capitalized
    # interest is tracked separately as displayInterest on the frontend).
    today = date.today()
    total_lent = Decimal("0")
    total_borrowed = Decimal("0")
    total_interest_outstanding = Decimal("0")
    # Track given (receivable) and taken (payable) separately so we can show NET.
    given_principal = Decimal("0")
    given_interest  = Decimal("0")
    taken_principal = Decimal("0")
    taken_interest  = Decimal("0")
    outstanding_map = {}
    for loan in loans_given + loans_taken:
        if loan.status != "active":
            continue
        try:
            out = calculate_outstanding_from_loan(loan, today)
            outstanding_map[loan.id] = out
            pout = Decimal(str(out.get("principal_outstanding", 0)))
            iout = Decimal(str(out.get("interest_outstanding", 0)))
            # For principal display: EMI shows amortized remaining; others show original.
            if loan.loan_type == "emi":
                principal_for_display = pout
            else:
                principal_for_display = Decimal(str(loan.principal_amount))
            if loan.loan_direction == "given":
                given_principal += pout
                given_interest  += iout
                total_lent      += principal_for_display
            else:
                taken_principal += pout
                taken_interest  += iout
                total_borrowed  += principal_for_display
        except Exception:
            pass

    # NET outstanding = what they owe us minus what we owe them
    total_principal_outstanding = given_principal - taken_principal
    total_interest_outstanding  = given_interest  - taken_interest
    total_overdue               = total_principal_outstanding + total_interest_outstanding

    # Total collateral value across all loans for this contact
    all_loan_ids = [l.id for l in loans_given + loans_taken]
    total_collateral = Decimal("0")
    if all_loan_ids:
        collaterals = db.query(Collateral).filter(
            Collateral.loan_id.in_(all_loan_ids)
        ).all()
        total_collateral = sum(
            Decimal(str(c.estimated_value)) for c in collaterals if c.estimated_value
        )

    return {
        "contact": ContactOut.model_validate(contact),
        "summary": {
            "total_lent": float(total_lent),
            "total_lent_historical": float(total_lent_historical),
            "total_borrowed": float(total_borrowed),
            "total_borrowed_closed": float(total_borrowed_closed),
            "principal_outstanding": float(total_principal_outstanding),
            "active_loans_count": active_loans_count,
            "total_loans_count": len(loans_given) + len(loans_taken),
            "total_interest_due": float(total_interest_outstanding),
            "total_outstanding": float(total_overdue),
            "given_outstanding": float(given_principal + given_interest),
            "taken_outstanding": float(taken_principal + taken_interest),
            "total_collateral_value": float(total_collateral),
        },
        # Detailed loans list for display
        "loans": [
            {
                "id": l.id,
                "loan_direction": l.loan_direction,
                "loan_type": l.loan_type,
                "principal_amount": float(l.principal_amount),
                "current_principal": float(outstanding_map[l.id]["principal_outstanding"]) if l.id in outstanding_map else None,
                "interest_outstanding": float(outstanding_map[l.id]["interest_outstanding"]) if l.id in outstanding_map else None,
                "total_outstanding": float(outstanding_map[l.id]["total_outstanding"]) if l.id in outstanding_map else None,
                "capitalization_enabled": bool(l.capitalization_enabled),
                "disbursed_date": l.disbursed_date.isoformat() if l.disbursed_date else None,
                "status": l.status,
                "interest_rate": float(l.interest_rate) if l.interest_rate else None,
            }
            for l in sorted(
                loans_given + loans_taken,
                key=lambda x: (0 if x.status == "active" else 1, x.disbursed_date or date.min),
                reverse=False,
            )
        ],
        # Properties linked to this contact
        "properties": [
            {
                "id": p.id,
                "title": p.title,
                "role": "seller" if p.seller_contact_id == contact_id else "buyer",
                "status": p.status,
                "property_type": p.property_type,
            }
            for p in db.query(PropertyDeal).filter(
                PropertyDeal.is_deleted == False,
                or_(
                    PropertyDeal.seller_contact_id == contact_id,
                    PropertyDeal.buyer_contact_id == contact_id,
                ),
            ).order_by(PropertyDeal.created_at.desc()).all()
        ],
        # Partnerships where contact is a member — joinedload avoids lazy per-member query
        "partnerships": [
            {
                "id": pm.partnership.id,
                "title": pm.partnership.title,
                "status": pm.partnership.status,
                "share_percentage": float(pm.share_percentage) if pm.share_percentage else None,
            }
            for pm in db.query(PartnershipMember).filter(
                PartnershipMember.contact_id == contact_id
            ).options(joinedload(PartnershipMember.partnership)).all()
            if pm.partnership and not pm.partnership.is_deleted
        ],
        # Beesis linked to this contact
        "beesis": [
            {"id": b.id, "title": b.title, "status": b.status}
            for b in db.query(Beesi).filter(
                Beesi.contact_id == contact_id, Beesi.is_deleted == False
            ).all()
        ],
    }


@router.post("/{contact_id}/statement")
def generate_statement(
    contact_id: int,
    body: StatementRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a loan statement for a contact as of a specific date."""
    contact = db.query(Contact).filter(
        Contact.id == contact_id, Contact.is_deleted == False
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    as_of = body.as_of_date
    today = date.today()

    # Fetch requested loans with eager-loaded payments and capitalization events
    loans = (
        db.query(Loan)
        .filter(Loan.id.in_(body.loan_ids), Loan.contact_id == contact_id, Loan.is_deleted == False)
        .options(selectinload(Loan.payments), selectinload(Loan.capitalization_events))
        .all()
    ) if body.loan_ids else []

    loan_items = []
    for loan in loans:
        start_date = loan.interest_start_date or loan.disbursed_date
        delta = relativedelta(as_of, start_date)
        dur_years = delta.years
        dur_months = delta.months
        dur_days = delta.days

        # Outstanding as of as_of_date using pre-loaded data
        out = calculate_outstanding_from_loan(loan, as_of)
        principal_outstanding = out.get("principal_outstanding", Decimal("0"))
        interest_outstanding = out.get("interest_outstanding", Decimal("0"))
        gross_interest = out.get("gross_interest_accrued", interest_outstanding)

        # Payments up to as_of_date (exclude voided)
        paid_before = [
            p for p in loan.payments
            if p.payment_date <= as_of and not getattr(p, "is_voided", False)
        ]
        already_paid_principal = sum(Decimal(str(p.allocated_to_principal or 0)) for p in paid_before)
        already_paid_interest = sum(
            Decimal(str(p.allocated_to_current_interest or 0)) +
            Decimal(str(p.allocated_to_overdue_interest or 0))
            for p in paid_before
        )
        # For any loan type, total cash actually received up to as_of
        total_cash_paid = sum(Decimal(str(p.amount_paid or 0)) for p in paid_before)

        type_label = {
            "interest_only": "Interest-Only Loan",
            "emi": "EMI Loan",
            "short_term": "Short-Term Loan",
        }.get(loan.loan_type, loan.loan_type.replace("_", " ").title())

        item = {
            "loan_id": loan.id,
            "label": f"{type_label} - Rs.{int(float(loan.principal_amount)):,}",
            "loan_type": loan.loan_type,
            "direction": loan.loan_direction,
            "notes": loan.notes,
            "status": loan.status,
            "interest_rate": float(loan.interest_rate) if loan.interest_rate else None,
            "emi_amount": float(loan.emi_amount) if loan.emi_amount else None,
            "tenure_months": loan.tenure_months,
            "start_date": start_date.isoformat() if start_date else None,
            "disbursed_date": loan.disbursed_date.isoformat() if loan.disbursed_date else None,
            "as_of_date": as_of.isoformat(),
            "duration_years": dur_years,
            "duration_months": dur_months,
            "duration_days": dur_days,
            "principal_amount": float(loan.principal_amount),
            "already_paid_total": float(total_cash_paid),
            "principal_outstanding": float(principal_outstanding),
            "emi_foreclosure": None,
        }

        # Interest segments (for interest_only with capitalization events)
        item["interest_segments"] = (
            _build_interest_segments(loan, as_of)
            if loan.loan_type == "interest_only"
            else None
        )

        if loan.loan_type == "emi":
            # EMI foreclosure as of as_of_date
            principal = Decimal(str(loan.principal_amount))
            emi_amount = Decimal(str(loan.emi_amount or 0))
            tenure = loan.tenure_months or 0

            monthly_r = _solve_emi_monthly_rate(principal, emi_amount, tenure)
            amort = _generate_emi_amortization(principal, emi_amount, tenure, monthly_r)

            # Count EMIs whose due date falls on or before as_of_date
            disbursed = loan.disbursed_date
            emis_due = sum(1 for i in range(1, tenure + 1)
                           if disbursed and (disbursed + relativedelta(months=i)) <= as_of)

            # Number actually paid = full EMIs covered by cash received
            emis_paid_count = int(total_cash_paid // emi_amount) if emi_amount > 0 else 0
            emis_paid_count = min(emis_paid_count, tenure)
            emis_remaining = max(0, tenure - emis_paid_count)

            # Remaining principal from amortization (after emis_paid_count EMIs)
            if amort and emis_paid_count > 0:
                rem_p = Decimal(str(amort[min(emis_paid_count, len(amort)) - 1]["outstanding_after"]))
            else:
                rem_p = principal

            # Accrued interest from last EMI due date to as_of_date
            if disbursed and emis_paid_count > 0:
                last_due = disbursed + relativedelta(months=emis_paid_count)
                days_elapsed = max(0, (as_of - last_due).days)
            else:
                days_elapsed = 0
            annual_r = monthly_r * 12
            accrued = (rem_p * annual_r * Decimal(str(days_elapsed)) / Decimal("365")).quantize(Decimal("0.01"))

            # Processing fee: 2% of remaining principal
            fee = (rem_p * Decimal("0.02")).quantize(Decimal("0.01"))
            foreclose_total = rem_p + accrued + fee

            effective_rb_rate = float((monthly_r * 12 * 100).quantize(Decimal("0.01"))) if monthly_r > 0 else None

            item["emi_foreclosure"] = {
                "emis_total": tenure,
                "emis_paid": emis_paid_count,
                "emis_remaining": emis_remaining,
                "effective_rb_rate_pct": effective_rb_rate,
                "foreclosure_principal": float(rem_p),
                "foreclosure_accrued_interest": float(accrued),
                "foreclosure_processing_fee": float(fee),
                "foreclosure_amount": float(foreclose_total),
            }
            item["total_outstanding"] = float(foreclose_total)
            item["interest_outstanding"] = float(accrued + fee)
            item["interest_accrued"] = 0.0
            item["total_amount"] = float(principal)
        else:
            has_interest = bool(loan.interest_rate and Decimal(str(loan.interest_rate)) > 0) or \
                           bool(getattr(loan, "post_due_interest_rate", None) and
                                Decimal(str(loan.post_due_interest_rate)) > 0)
            item["interest_accrued"] = float(gross_interest) if has_interest else 0.0
            item["interest_outstanding"] = float(interest_outstanding) if has_interest else 0.0
            item["total_amount"] = float(loan.principal_amount) + (float(gross_interest) if has_interest else 0.0)
            item["total_outstanding"] = float(principal_outstanding) + (float(interest_outstanding) if has_interest else 0.0)
            item["already_paid_principal"] = float(already_paid_principal)
            item["already_paid_interest"] = float(already_paid_interest)

        loan_items.append(item)

    # Obligations
    obligation_items = []
    if body.obligation_ids:
        obls = (
            db.query(MoneyObligation)
            .filter(
                MoneyObligation.id.in_(body.obligation_ids),
                MoneyObligation.is_deleted == False,
            )
            .all()
        )
        for obl in obls:
            # A closed-with-loss obligation has been written off — nothing is
            # still owed, so it contributes zero to the settlement total.
            remaining = (
                0.0 if obl.status in ("closed", "settled")
                else float(Decimal(str(obl.amount)) - Decimal(str(obl.amount_settled or 0)))
            )
            obligation_items.append({
                "obligation_id": obl.id,
                "label": obl.reason or obl.obligation_type.capitalize(),
                "obligation_type": obl.obligation_type,
                "due_date": obl.due_date.isoformat() if obl.due_date else None,
                "amount": float(obl.amount),
                "amount_settled": float(obl.amount_settled or 0),
                "outstanding": remaining,
                "status": obl.status,
            })

    # Totals — given loans are receivable, taken loans are payable (subtract)
    given_items = [i for i in loan_items if i["direction"] == "given"]
    taken_items = [i for i in loan_items if i["direction"] == "taken"]

    total_principal  = sum(i["principal_amount"] for i in loan_items)
    total_interest   = sum(i["interest_accrued"]  for i in loan_items)
    total_paid       = sum(i["already_paid_total"] for i in loan_items)

    given_p_out = sum(i["principal_outstanding"] for i in given_items)
    given_i_out = sum(i["interest_outstanding"]  for i in given_items)
    taken_p_out = sum(i["principal_outstanding"] for i in taken_items)
    taken_i_out = sum(i["interest_outstanding"]  for i in taken_items)

    given_total_out = given_p_out + given_i_out
    taken_total_out = taken_p_out + taken_i_out
    net_outstanding = given_total_out - taken_total_out
    obl_outstanding = sum(o["outstanding"] for o in obligation_items)
    settlement_amount = net_outstanding + obl_outstanding

    return {
        "contact": {
            "id": contact.id,
            "name": contact.name,
            "phone": contact.phone,
            "address": contact.address,
            "city": contact.city,
        },
        "generated_on": today.isoformat(),
        "as_of_date": as_of.isoformat(),
        "signature_name": body.signature_name,
        "loan_items": loan_items,
        "obligation_items": obligation_items,
        "totals": {
            "total_principal": total_principal,
            "total_interest_accrued": total_interest,
            "total_amount": total_principal + total_interest,
            "total_paid": total_paid,
            "total_principal_outstanding": given_p_out,
            "total_interest_outstanding": given_i_out,
            "given_outstanding": given_total_out,
            "taken_outstanding": taken_total_out,
            "net_outstanding": net_outstanding,
            "obligations_outstanding": obl_outstanding,
            "settlement_amount": settlement_amount,
        },
    }


@router.put("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    contact_data: ContactUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Update a contact"""
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Update only provided fields
    update_data = contact_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(contact, field, value)
    
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{contact_id}")
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_write_access)
):
    """Soft delete a contact"""
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.is_deleted == False
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Check if contact has active loans
    active_loans = db.query(Loan).filter(
        Loan.contact_id == contact_id,
        Loan.status == "active",
        Loan.is_deleted == False
    ).count()
    
    if active_loans > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete contact with {active_loans} active loan(s). Close loans first."
        )
    
    contact.is_deleted = True
    db.commit()
    return {"message": "Contact deleted successfully"}
