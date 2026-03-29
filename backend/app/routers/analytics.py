"""
Analytics / Financial overview router.

Provides consolidated investment, liability, cash-flow and net-worth data
across all modules (loans, properties, partnerships, beesi, accounts).
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func as sa_func, extract, case, literal
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.cash_account import CashAccount, AccountTransaction
from app.models.loan import Loan, LoanPayment
from app.models.property_deal import PropertyDeal, PropertyTransaction
from app.models.partnership import Partnership, PartnershipMember, PartnershipTransaction
from app.models.beesi import Beesi, BeesiInstallment, BeesiWithdrawal
from app.models.expense import Expense
from app.models.contact import Contact
from app.models.obligation import MoneyObligation
from app.models.user import User
from app.services.interest import calculate_outstanding, generate_emi_schedule, get_emi_schedule_with_payments

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

_D = lambda v: Decimal("0") if v is None else Decimal(str(v))


@router.get("/overview")
def analytics_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Consolidated financial overview — investments, liabilities, accounts, cash flow.
    """
    today = date.today()

    # ── LOANS ────────────────────────────────────────────────────────────────
    active_loans = db.query(Loan).filter(Loan.is_deleted == False, Loan.status == "active").all()
    loans_given = [l for l in active_loans if l.loan_direction == "given"]
    loans_taken = [l for l in active_loans if l.loan_direction == "taken"]

    total_given_principal = sum(_D(l.principal_amount) for l in loans_given)
    total_taken_principal = sum(_D(l.principal_amount) for l in loans_taken)

    # Outstanding on loans given (money owed TO us)
    total_given_outstanding = Decimal("0")
    total_given_interest = Decimal("0")
    for l in loans_given:
        try:
            out = calculate_outstanding(l.id, today, db)
            total_given_outstanding += _D(out.get("total_outstanding", 0))
            total_given_interest += _D(out.get("interest_outstanding", 0))
        except Exception:
            total_given_outstanding += _D(l.principal_amount)

    # Outstanding on loans taken (money WE owe)
    total_taken_outstanding = Decimal("0")
    total_taken_interest = Decimal("0")
    for l in loans_taken:
        try:
            out = calculate_outstanding(l.id, today, db)
            total_taken_outstanding += _D(out.get("total_outstanding", 0))
            total_taken_interest += _D(out.get("interest_outstanding", 0))
        except Exception:
            total_taken_outstanding += _D(l.principal_amount)

    # ── PROPERTIES ──────────────────────────────────────────────────────────
    properties = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False).all()
    total_property_advance = sum(_D(p.advance_paid) for p in properties if p.status != "cancelled")
    total_property_investment = sum(_D(p.my_investment) for p in properties if p.property_type == "site" and p.status != "cancelled")
    total_property_profit = sum(_D(p.net_profit) for p in properties if p.net_profit and p.status == "settled")

    # ── PARTNERSHIPS ──────────────────────────────────────────────────────
    partnerships = db.query(Partnership).filter(Partnership.is_deleted == False).all()
    total_partnership_invested = sum(_D(p.our_investment) for p in partnerships if p.status != "cancelled")
    total_partnership_received = sum(_D(p.total_received) for p in partnerships if p.status != "cancelled")
    partnership_pnl = total_partnership_received - total_partnership_invested

    # Partner liabilities: money I've received that belongs to partners
    partner_liabilities = Decimal("0")
    for p in partnerships:
        if p.status == "cancelled":
            continue
        members = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id == p.id,
            PartnershipMember.is_self == False,
        ).all()
        for m in members:
            owed = _D(m.advance_contributed) + (
                _D(p.total_received) * _D(m.share_percentage) / Decimal("100")
                if p.status == "settled" and m.share_percentage else Decimal("0")
            )
            paid_out = _D(m.total_received)
            if owed > paid_out:
                partner_liabilities += owed - paid_out

    # ── BEESI ────────────────────────────────────────────────────────────────
    beesis = db.query(Beesi).filter(Beesi.is_deleted == False).all()
    total_beesi_invested = Decimal("0")
    total_beesi_withdrawn = Decimal("0")
    for b in beesis:
        total_beesi_invested += sum(_D(i.actual_paid) for i in b.installments)
        total_beesi_withdrawn += sum(_D(w.net_received) for w in b.withdrawals)
    beesi_pnl = total_beesi_withdrawn - total_beesi_invested

    # ── ACCOUNTS ─────────────────────────────────────────────────────────
    accounts = db.query(CashAccount).filter(CashAccount.is_deleted == False).all()
    account_balances = []
    total_cash = Decimal("0")
    for acct in accounts:
        opening = _D(acct.opening_balance)
        credits = db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
            AccountTransaction.account_id == acct.id,
            AccountTransaction.txn_type == "credit",
        ).scalar()
        debits = db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
            AccountTransaction.account_id == acct.id,
            AccountTransaction.txn_type == "debit",
        ).scalar()
        balance = opening + _D(credits) - _D(debits)
        total_cash += balance
        account_balances.append({
            "id": acct.id,
            "name": acct.name,
            "account_type": acct.account_type,
            "balance": float(balance),
        })

    # ── EXPENSES ──────────────────────────────────────────────────────────
    total_expenses = _D(
        db.query(sa_func.coalesce(sa_func.sum(Expense.amount), 0)).scalar()
    )
    month_start = today.replace(day=1)
    expenses_this_month = _D(
        db.query(sa_func.coalesce(sa_func.sum(Expense.amount), 0)).filter(
            Expense.expense_date >= month_start,
        ).scalar()
    )

    # ── MONTHLY CASH FLOW (last 12 months) ──────────────────────────────
    monthly_cashflow = []
    for i in range(11, -1, -1):
        # Calculate month start/end
        dt = today.replace(day=1) - timedelta(days=i * 28)  # rough
        m_start = dt.replace(day=1)
        if m_start.month == 12:
            m_end = m_start.replace(year=m_start.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            m_end = m_start.replace(month=m_start.month + 1, day=1) - timedelta(days=1)

        inflow = _D(
            db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
                AccountTransaction.txn_type == "credit",
                AccountTransaction.txn_date >= m_start,
                AccountTransaction.txn_date <= m_end,
            ).scalar()
        )
        outflow = _D(
            db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
                AccountTransaction.txn_type == "debit",
                AccountTransaction.txn_date >= m_start,
                AccountTransaction.txn_date <= m_end,
            ).scalar()
        )
        monthly_cashflow.append({
            "month": m_start.strftime("%Y-%m"),
            "label": m_start.strftime("%b %Y"),
            "inflow": float(inflow),
            "outflow": float(outflow),
            "net": float(inflow - outflow),
        })

    # ── TOP CONTACTS BY OUTSTANDING ──────────────────────────────────────
    top_contacts = []
    contact_outstandings = {}
    for l in loans_given:
        if l.status != "active":
            continue
        try:
            out = calculate_outstanding(l.id, today, db)
            amt = _D(out.get("total_outstanding", 0))
        except Exception:
            amt = _D(l.principal_amount)
        cid = l.contact_id
        contact_outstandings[cid] = contact_outstandings.get(cid, Decimal("0")) + amt

    for cid, amt in sorted(contact_outstandings.items(), key=lambda x: x[1], reverse=True)[:10]:
        c = db.query(Contact).filter(Contact.id == cid).first()
        if c:
            top_contacts.append({"id": c.id, "name": c.name, "outstanding": float(amt)})

    # ── NET WORTH ────────────────────────────────────────────────────────
    # Assets: cash + loans receivable + property advances + partnership investments + beesi invested (not yet withdrawn)
    total_investments = total_given_outstanding + total_property_advance + total_property_investment + total_partnership_invested + total_beesi_invested
    # Liabilities: loans payable + partner liabilities
    total_liabilities = total_taken_outstanding + partner_liabilities
    net_worth = total_cash + total_investments - total_liabilities - total_beesi_invested + total_beesi_withdrawn

    return {
        "as_of_date": today.isoformat(),
        # Investments (money working for me)
        "investments": {
            "loans_given_outstanding": float(total_given_outstanding),
            "loans_given_interest_pending": float(total_given_interest),
            "property_advances": float(total_property_advance),
            "property_site_investments": float(total_property_investment),
            "partnership_invested": float(total_partnership_invested),
            "beesi_invested": float(total_beesi_invested),
            "total": float(total_investments),
        },
        # Liabilities (money I owe)
        "liabilities": {
            "loans_taken_outstanding": float(total_taken_outstanding),
            "loans_taken_interest_pending": float(total_taken_interest),
            "partner_payables": float(partner_liabilities),
            "total": float(total_liabilities),
        },
        # P&L
        "pnl": {
            "property_profit": float(total_property_profit),
            "partnership_pnl": float(partnership_pnl),
            "beesi_pnl": float(beesi_pnl),
            "total_expenses": float(total_expenses),
            "expenses_this_month": float(expenses_this_month),
        },
        # Net worth
        "net_worth": float(net_worth),
        # Accounts
        "accounts": account_balances,
        "total_cash": float(total_cash),
        # Counts
        "counts": {
            "active_loans_given": len(loans_given),
            "active_loans_taken": len(loans_taken),
            "active_properties": len([p for p in properties if p.status not in ("settled", "cancelled")]),
            "active_partnerships": len([p for p in partnerships if p.status == "active"]),
            "active_beesis": len([b for b in beesis if b.status == "active"]),
        },
        # Charts
        "monthly_cashflow": monthly_cashflow,
        "top_contacts": top_contacts,
    }


@router.post("/backfill")
def backfill_past_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One-time backfill: create a "Cash in Hand" account if needed,
    then set account_id on all existing records that don't have one,
    and create AccountTransaction entries for historical data.
    """
    from app.services.auto_ledger import auto_ledger

    # 1. Ensure "Cash in Hand" exists
    cash_acct = db.query(CashAccount).filter(
        CashAccount.name == "Cash in Hand",
        CashAccount.is_deleted == False,
    ).first()
    if not cash_acct:
        cash_acct = CashAccount(
            name="Cash in Hand",
            account_type="cash",
            opening_balance=0,
            created_by=current_user.id,
        )
        db.add(cash_acct)
        db.flush()

    stats = {"loans_linked": 0, "payments_linked": 0, "expenses_linked": 0,
             "property_txns_linked": 0, "partnership_txns_linked": 0}

    # 2. Loans — set account_id and create ledger entries
    loans = db.query(Loan).filter(Loan.account_id == None, Loan.is_deleted == False).all()
    for l in loans:
        l.account_id = cash_acct.id
        stats["loans_linked"] += 1
        txn_type = "debit" if l.loan_direction == "given" else "credit"
        auto_ledger(
            db, cash_acct.id, txn_type, float(l.principal_amount),
            l.disbursed_date, "loan", l.id,
            f"Backfill: Loan #{l.id} disbursement",
            contact_id=l.contact_id, created_by=current_user.id,
        )

    # 3. Loan payments
    payments = db.query(LoanPayment).filter(LoanPayment.account_id == None).all()
    for p in payments:
        loan = db.query(Loan).filter(Loan.id == p.loan_id).first()
        if not loan:
            continue
        p.account_id = cash_acct.id
        stats["payments_linked"] += 1
        txn_type = "credit" if loan.loan_direction == "given" else "debit"
        auto_ledger(
            db, cash_acct.id, txn_type, float(p.amount_paid),
            p.payment_date, "loan_payment", p.id,
            f"Backfill: Payment #{p.id} for Loan #{loan.id}",
            payment_mode=p.payment_mode, contact_id=loan.contact_id,
            created_by=current_user.id,
        )

    # 4. Expenses
    expenses = db.query(Expense).filter(Expense.account_id == None).all()
    for e in expenses:
        e.account_id = cash_acct.id
        stats["expenses_linked"] += 1
        auto_ledger(
            db, cash_acct.id, "debit", float(e.amount),
            e.expense_date, "expense", e.id,
            f"Backfill: Expense #{e.id}",
            payment_mode=e.payment_mode, created_by=current_user.id,
        )

    # 5. Property transactions
    prop_txns = db.query(PropertyTransaction).filter(PropertyTransaction.account_id == None).all()
    INFLOW_TXN_TYPES = {"advance_received", "payment_received", "refund_given"}
    for pt in prop_txns:
        pt.account_id = cash_acct.id
        stats["property_txns_linked"] += 1
        txn_type = "credit" if pt.txn_type in INFLOW_TXN_TYPES else "debit"
        auto_ledger(
            db, cash_acct.id, txn_type, float(pt.amount),
            pt.txn_date, "property_transaction", pt.id,
            f"Backfill: Property txn #{pt.id}",
            created_by=current_user.id,
        )

    # 6. Partnership transactions
    partner_txns = db.query(PartnershipTransaction).filter(PartnershipTransaction.account_id == None).all()
    OUTFLOW_PARTNER = {"invested", "expense"}
    for ptx in partner_txns:
        ptx.account_id = cash_acct.id
        stats["partnership_txns_linked"] += 1
        txn_type = "debit" if ptx.txn_type in OUTFLOW_PARTNER else "credit"
        auto_ledger(
            db, cash_acct.id, txn_type, float(ptx.amount),
            ptx.txn_date, "partnership_transaction", ptx.id,
            f"Backfill: Partnership txn #{ptx.id}",
            created_by=current_user.id,
        )

    db.commit()
    return {"status": "ok", "cash_account_id": cash_acct.id, "stats": stats}


@router.post("/relink-to-cash-home")
def relink_to_cash_home(
    target_account_id: int = 1,
    target_balance: float = 440000,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One-time migration: move all backfilled account_transactions and source
    records from 'Cash in Hand' (id=5) to a target account (default: Cash, id=1),
    then adjust the target account's opening_balance so its computed balance
    equals target_balance.
    """
    target_acct = db.query(CashAccount).filter(
        CashAccount.id == target_account_id,
        CashAccount.is_deleted == False,
    ).first()
    if not target_acct:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Target account not found")

    OLD_ACCOUNT_ID = 5  # Cash in Hand

    # 1. Move backfilled account_transactions from old to target
    moved = db.query(AccountTransaction).filter(
        AccountTransaction.account_id == OLD_ACCOUNT_ID,
        AccountTransaction.description.like("Backfill:%"),
    ).update({AccountTransaction.account_id: target_account_id}, synchronize_session="fetch")

    # 2. Update source records: loans
    loans_updated = db.query(Loan).filter(
        Loan.account_id == OLD_ACCOUNT_ID,
    ).update({Loan.account_id: target_account_id}, synchronize_session="fetch")

    # 3. Loan payments
    payments_updated = db.query(LoanPayment).filter(
        LoanPayment.account_id == OLD_ACCOUNT_ID,
    ).update({LoanPayment.account_id: target_account_id}, synchronize_session="fetch")

    # 4. Property transactions
    prop_updated = db.query(PropertyTransaction).filter(
        PropertyTransaction.account_id == OLD_ACCOUNT_ID,
    ).update({PropertyTransaction.account_id: target_account_id}, synchronize_session="fetch")

    # 5. Partnership transactions
    partner_updated = db.query(PartnershipTransaction).filter(
        PartnershipTransaction.account_id == OLD_ACCOUNT_ID,
    ).update({PartnershipTransaction.account_id: target_account_id}, synchronize_session="fetch")

    # 6. Recalculate opening_balance so computed balance = target_balance
    credits = db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
        AccountTransaction.account_id == target_account_id,
        AccountTransaction.txn_type == "credit",
    ).scalar()
    debits = db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
        AccountTransaction.account_id == target_account_id,
        AccountTransaction.txn_type == "debit",
    ).scalar()
    net = Decimal(str(credits)) - Decimal(str(debits))
    new_opening = Decimal(str(target_balance)) - net
    target_acct.opening_balance = new_opening

    db.commit()
    return {
        "status": "ok",
        "target_account": target_acct.name,
        "account_txns_moved": moved,
        "loans_updated": loans_updated,
        "payments_updated": payments_updated,
        "property_txns_updated": prop_updated,
        "partnership_txns_updated": partner_updated,
        "new_opening_balance": float(new_opening),
        "computed_balance": target_balance,
    }


# ── FORECAST / CASH FLOW PROJECTION ─────────────────────────────────────────
#
# Confidence scoring (think like a CA):
#   HIGH   – EMI receipts (contractual, proven track), recurring monthly interest
#   MEDIUM – Short-term loan returns with end date, beesi installments (committed)
#   LOW    – Property deals (timing uncertain), principal returns without end date,
#            obligations, beesi pots (speculative)
#
# interest_rate is stored as ANNUAL percentage.  Monthly interest = principal * rate / 100 / 12.
# Interest is on ORIGINAL principal (loan.principal_amount), not on compounded outstanding.

@router.get("/forecast")
def analytics_forecast(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from dateutil.relativedelta import relativedelta

    today = date.today()
    periods = {
        "15_days": today + timedelta(days=15),
        "30_days": today + timedelta(days=30),
        "90_days": today + timedelta(days=90),
        "1_year": today + timedelta(days=365),
    }

    active_loans = db.query(Loan).filter(
        Loan.is_deleted == False, Loan.status == "active"
    ).all()
    loans_given = [l for l in active_loans if l.loan_direction == "given"]
    loans_taken = [l for l in active_loans if l.loan_direction == "taken"]

    # ── helper: contact name ─────────────────────────────────────────────
    def _contact(loan):
        if loan.contact:
            return loan.contact.name
        if loan.institution_name:
            return loan.institution_name
        return f"Contact #{loan.contact_id}"

    # ── INFLOWS: Loans Given ─────────────────────────────────────────────
    def _loan_inflow_items(loan, horizon_date):
        items = []
        name = _contact(loan)

        if loan.loan_type == "emi":
            schedule = get_emi_schedule_with_payments(loan, db)
            for entry in schedule:
                dd = entry["due_date"]
                if dd < today or dd > horizon_date:
                    continue
                if entry["status"] == "paid":
                    continue
                remaining = float(entry["outstanding"])
                if remaining > 0:
                    items.append({
                        "source": "emi_receipt", "contact": name,
                        "contact_id": loan.contact_id, "loan_id": loan.id,
                        "amount": remaining,
                        "due_date": dd.isoformat(),
                        "label": f"EMI #{entry['emi_number']}",
                        "confidence": "high",
                    })

        elif loan.loan_type == "interest_only":
            rate = _D(loan.interest_rate)
            if rate <= 0:
                return items
            # interest_rate is ANNUAL — divide by 12 for monthly projection
            principal = _D(loan.principal_amount)
            monthly_interest = float((principal * rate / Decimal("100") / Decimal("12")).quantize(Decimal("0.01")))
            start = loan.interest_start_date or loan.disbursed_date
            if not start:
                return items
            cur = date(today.year, today.month, min(start.day, 28))
            if cur <= today:
                cur += relativedelta(months=1)
            while cur <= horizon_date:
                items.append({
                    "source": "interest_receipt", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": monthly_interest,
                    "due_date": cur.isoformat(),
                    "label": f"Monthly interest ({rate}% p.a.)",
                    "confidence": "high",
                })
                cur += relativedelta(months=1)
            # Principal return only if end date exists and falls in window
            if loan.expected_end_date and today < loan.expected_end_date <= horizon_date:
                items.append({
                    "source": "principal_return", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": float(principal),
                    "due_date": loan.expected_end_date.isoformat(),
                    "label": "Principal return (expected end date)",
                    "confidence": "medium",
                })

        elif loan.loan_type == "short_term":
            principal = _D(loan.principal_amount)
            end = loan.expected_end_date or loan.interest_free_till
            if end and today < end <= horizon_date:
                items.append({
                    "source": "principal_return", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": float(principal),
                    "due_date": end.isoformat(),
                    "label": "Short-term loan return",
                    "confidence": "medium",
                })
            # If no end date — skip entirely for time-bound forecast

        return items

    # ── OUTFLOWS: Loans Taken ─────────────────────────────────────────────
    def _loan_outflow_items(loan, horizon_date):
        items = []
        name = _contact(loan)

        if loan.loan_type == "emi":
            schedule = get_emi_schedule_with_payments(loan, db)
            for entry in schedule:
                dd = entry["due_date"]
                if dd < today or dd > horizon_date:
                    continue
                if entry["status"] == "paid":
                    continue
                remaining = float(entry["outstanding"])
                if remaining > 0:
                    items.append({
                        "source": "emi_payment", "contact": name,
                        "contact_id": loan.contact_id, "loan_id": loan.id,
                        "amount": remaining,
                        "due_date": dd.isoformat(),
                        "label": f"EMI #{entry['emi_number']}",
                        "confidence": "high",
                    })

        elif loan.loan_type == "interest_only":
            rate = _D(loan.interest_rate)
            if rate <= 0:
                return items
            # interest_rate is ANNUAL — divide by 12 for monthly projection
            principal = _D(loan.principal_amount)
            monthly_interest = float((principal * rate / Decimal("100") / Decimal("12")).quantize(Decimal("0.01")))
            start = loan.interest_start_date or loan.disbursed_date
            if not start:
                return items
            cur = date(today.year, today.month, min(start.day, 28))
            if cur <= today:
                cur += relativedelta(months=1)
            while cur <= horizon_date:
                items.append({
                    "source": "interest_payment", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": monthly_interest,
                    "due_date": cur.isoformat(),
                    "label": f"Interest due ({rate}% p.a.)",
                    "confidence": "high",
                })
                cur += relativedelta(months=1)
            if loan.expected_end_date and today < loan.expected_end_date <= horizon_date:
                items.append({
                    "source": "principal_payment", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": float(principal),
                    "due_date": loan.expected_end_date.isoformat(),
                    "label": "Principal due (expected end date)",
                    "confidence": "medium",
                })

        elif loan.loan_type == "short_term":
            principal = _D(loan.principal_amount)
            end = loan.expected_end_date or loan.interest_free_till
            if end and today < end <= horizon_date:
                items.append({
                    "source": "principal_payment", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": float(principal),
                    "due_date": end.isoformat(),
                    "label": "Short-term loan return due",
                    "confidence": "medium",
                })

        return items

    # ── Build per-period forecast ──────────────────────────────────────────
    result = {}

    for period_key, horizon in periods.items():
        inflow_items = []
        outflow_items = []

        for loan in loans_given:
            inflow_items.extend(_loan_inflow_items(loan, horizon))
        for loan in loans_taken:
            outflow_items.extend(_loan_outflow_items(loan, horizon))

        # --- Property inflows: only show NET PROFIT as inflow, not buyer amount
        properties = db.query(PropertyDeal).filter(
            PropertyDeal.is_deleted == False,
            PropertyDeal.status.notin_(["settled", "cancelled"]),
        ).all()
        for prop in properties:
            buyer_val = _D(prop.total_buyer_value)
            seller_val = _D(prop.total_seller_value)
            if buyer_val <= 0:
                continue
            advance_back = _D(prop.advance_paid)
            net_profit = buyer_val - seller_val - _D(prop.broker_commission) - _D(getattr(prop, "other_expenses", None))
            my_return = advance_back + net_profit  # advance comes back + profit
            if my_return <= 0:
                continue
            inflow_items.append({
                "source": "property", "contact": prop.title,
                "contact_id": None, "loan_id": None,
                "amount": float(my_return),
                "due_date": None,
                "label": f"Advance ₹{float(advance_back):,.0f} + Profit ₹{float(net_profit):,.0f}",
                "confidence": "low",
            })

        # --- Beesi ---
        active_beesis = db.query(Beesi).filter(
            Beesi.is_deleted == False, Beesi.status == "active"
        ).all()
        for b in active_beesis:
            paid_months = len(b.installments)
            remaining_months = max(b.tenure_months - paid_months, 0)
            inst = _D(b.base_installment)
            check_date = b.start_date + relativedelta(months=paid_months)
            for _ in range(remaining_months):
                if check_date > horizon:
                    break
                if check_date >= today:
                    outflow_items.append({
                        "source": "beesi_installment", "contact": b.title,
                        "contact_id": None, "loan_id": None,
                        "amount": float(inst),
                        "due_date": check_date.isoformat(),
                        "label": f"Beesi: {b.title}",
                        "confidence": "medium",
                    })
                check_date += relativedelta(months=1)

            # Beesi pot: show NET inflow (pot minus remaining installments), not gross pot
            if not b.withdrawals:
                pot = _D(b.pot_size)
                total_paid = sum(_D(i.actual_paid) for i in b.installments)
                remaining_to_pay = inst * remaining_months
                net_return = pot - remaining_to_pay  # what I get after paying all installments
                if net_return > 0:
                    inflow_items.append({
                        "source": "beesi", "contact": b.title,
                        "contact_id": None, "loan_id": None,
                        "amount": float(net_return),
                        "due_date": None,
                        "label": f"Net after installments (pot ₹{float(pot):,.0f})",
                        "confidence": "low",
                    })

        # --- Money Flow Obligations ---
        pending_obligations = db.query(MoneyObligation).filter(
            MoneyObligation.status.in_(["pending", "partial"]),
        ).all()
        for obl in pending_obligations:
            remaining = _D(obl.amount) - _D(obl.amount_settled)
            if remaining <= Decimal("0"):
                continue
            contact = None
            if obl.contact_id:
                contact = db.query(Contact).filter(Contact.id == obl.contact_id).first()
            cname = contact.name if contact else "Self (You)"

            item = {
                "contact": cname,
                "contact_id": obl.contact_id,
                "loan_id": None,
                "amount": float(remaining),
                "due_date": None,
                "label": obl.reason or ("Receivable" if obl.obligation_type == "receivable" else "Payable"),
                "confidence": "low",
            }
            if obl.obligation_type == "receivable":
                item["source"] = "obligation_receivable"
                inflow_items.append(item)
            else:
                item["source"] = "obligation_payable"
                outflow_items.append(item)

        # --- Aggregate ---
        def _sum_by(items, source_prefix):
            return sum(it["amount"] for it in items if it["source"].startswith(source_prefix))

        def _sum_conf(items, conf):
            return sum(it["amount"] for it in items if it.get("confidence") == conf)

        total_in = sum(it["amount"] for it in inflow_items)
        total_out = sum(it["amount"] for it in outflow_items)

        result[period_key] = {
            "horizon_date": horizon.isoformat(),
            "inflow": {
                "total": round(total_in, 2),
                "high": round(_sum_conf(inflow_items, "high"), 2),
                "medium": round(_sum_conf(inflow_items, "medium"), 2),
                "low": round(_sum_conf(inflow_items, "low"), 2),
                "emi_receipts": round(_sum_by(inflow_items, "emi_"), 2),
                "interest_receipts": round(_sum_by(inflow_items, "interest_"), 2),
                "principal_returns": round(_sum_by(inflow_items, "principal_"), 2),
                "property": round(_sum_by(inflow_items, "property"), 2),
                "beesi": round(_sum_by(inflow_items, "beesi"), 2),
                "receivables": round(_sum_by(inflow_items, "obligation_"), 2),
                "items": sorted(inflow_items, key=lambda x: (
                    {"high": 0, "medium": 1, "low": 2}.get(x.get("confidence"), 3),
                    x["due_date"] or "9999-12-31",
                )),
            },
            "outflow": {
                "total": round(total_out, 2),
                "high": round(_sum_conf(outflow_items, "high"), 2),
                "medium": round(_sum_conf(outflow_items, "medium"), 2),
                "low": round(_sum_conf(outflow_items, "low"), 2),
                "emi_payments": round(_sum_by(outflow_items, "emi_"), 2),
                "interest_payments": round(_sum_by(outflow_items, "interest_"), 2),
                "principal_payments": round(_sum_by(outflow_items, "principal_"), 2),
                "beesi_installments": round(_sum_by(outflow_items, "beesi_"), 2),
                "payables": round(_sum_by(outflow_items, "obligation_"), 2),
                "items": sorted(outflow_items, key=lambda x: (
                    {"high": 0, "medium": 1, "low": 2}.get(x.get("confidence"), 3),
                    x["due_date"] or "9999-12-31",
                )),
            },
            "net": round(total_in - total_out, 2),
        }

    return {"as_of_date": today.isoformat(), "periods": result}
