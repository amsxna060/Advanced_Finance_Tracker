"""
Analytics / Financial overview router.

Provides consolidated investment, liability, cash-flow and net-worth data
across all modules (loans, properties, partnerships, beesi, accounts).
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func as sa_func, extract, case, literal
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.cash_account import CashAccount, AccountTransaction
from app.models.loan import Loan, LoanPayment
from app.models.property_deal import PropertyDeal, PropertyTransaction, SitePlot, PlotBuyer
from app.models.partnership import Partnership, PartnershipMember, PartnershipTransaction
from app.models.beesi import Beesi, BeesiInstallment, BeesiWithdrawal
from app.models.expense import Expense
from app.models.contact import Contact
from app.models.obligation import MoneyObligation
from app.models.user import User
from app.models.property_anomaly import PropertyAnomaly
from app.services.interest import calculate_outstanding, generate_emi_schedule, get_emi_schedule_with_payments, _build_monthly_periods, _calc_period_interest

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

    # ── PARTNERSHIPS (load first — needed by property section) ──────────
    partnerships = db.query(Partnership).filter(Partnership.is_deleted == False).all()

    # ── PROPERTIES ──────────────────────────────────────────────────────────
    properties = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False).all()
    linked_property_ids = {
        p.linked_property_deal_id for p in partnerships
        if p.linked_property_deal_id and p.status != "cancelled"
    }
    # Build partnership-id → self_member lookup for linked properties
    _prop_to_partnership = {
        p.linked_property_deal_id: p for p in partnerships
        if p.linked_property_deal_id and p.status != "cancelled"
    }

    # Plot Advances (My Share): standalone → advance_paid, partnership → self contribution
    total_property_advance = Decimal("0")
    for prop in properties:
        if prop.status == "cancelled" or prop.property_type == "site":
            continue
        if prop.id in linked_property_ids:
            part = _prop_to_partnership.get(prop.id)
            if part:
                sm = db.query(PartnershipMember).filter(
                    PartnershipMember.partnership_id == part.id,
                    PartnershipMember.is_self == True,
                ).first()
                if sm:
                    total_property_advance += _D(sm.advance_contributed)
        else:
            total_property_advance += _D(prop.advance_paid)

    # Site Investments: max(my_investment, advance_paid) — they represent the same money
    total_property_investment = Decimal("0")
    for prop in properties:
        if prop.property_type == "site" and prop.status != "cancelled":
            total_property_investment += max(_D(prop.my_investment), _D(prop.advance_paid))

    # Partnership invested — only non-property partnerships (pure business partnerships)
    total_partnership_invested = Decimal("0")
    total_partnership_received = Decimal("0")
    for p in partnerships:
        if p.status == "cancelled":
            continue
        if p.linked_property_deal_id:
            continue  # property-linked → already counted in plot advances
        self_member = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id == p.id,
            PartnershipMember.is_self == True,
        ).first()
        if self_member:
            total_partnership_invested += _D(self_member.advance_contributed)
            total_partnership_received += _D(self_member.total_received)
        else:
            total_partnership_invested += _D(p.our_investment)
            if p.our_share_percentage:
                total_partnership_received += (
                    _D(p.total_received) * _D(p.our_share_percentage) / Decimal("100")
                )
            else:
                total_partnership_received += _D(p.total_received)
    partnership_pnl = total_partnership_received - total_partnership_invested

    # Profit from standalone properties only; partnership-linked deal profits
    # are already captured in partnership P&L via member distributions.
    total_property_profit = sum(
        _D(p.net_profit) for p in properties
        if p.net_profit and p.status == "settled" and p.id not in linked_property_ids
    )

    # Partner liabilities: only count when buyer money has been received
    partner_liabilities = Decimal("0")
    for p in partnerships:
        if p.status == "cancelled":
            continue
        if _D(p.total_received) <= 0:
            continue  # no buyer money received yet — no liability
        members = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id == p.id,
            PartnershipMember.is_self == False,
        ).all()
        for m in members:
            owed = _D(m.advance_contributed) + (
                _D(p.total_received) * _D(m.share_percentage) / Decimal("100")
                if m.share_percentage else Decimal("0")
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


# ── ASSETS & LIABILITIES (Balance Sheet) ────────────────────────────────────
#
# Provides a detailed per-item breakdown of everything the user owns (assets)
# and everything the user owes (liabilities), with clickable drill-down links.

@router.get("/assets")
def analytics_assets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Detailed balance-sheet view:
      ASSETS  = Cash + Loans Given + Property Advances + Site Investments
                + Partnerships + Receivables + Collateral Held
      LIABILITIES = Loans Taken + Payables + Partner Payables
    Each category includes per-item rows for UI drill-down.
    """
    today = date.today()

    # ── CASH & BANK ACCOUNTS ────────────────────────────────────────────────
    accounts = db.query(CashAccount).filter(CashAccount.is_deleted == False).all()
    account_items = []
    total_cash = Decimal("0")
    for acct in accounts:
        opening = _D(acct.opening_balance)
        credits = _D(db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
            AccountTransaction.account_id == acct.id,
            AccountTransaction.txn_type == "credit",
        ).scalar())
        debits = _D(db.query(sa_func.coalesce(sa_func.sum(AccountTransaction.amount), 0)).filter(
            AccountTransaction.account_id == acct.id,
            AccountTransaction.txn_type == "debit",
        ).scalar())
        balance = opening + credits - debits
        total_cash += balance
        account_items.append({
            "id": acct.id, "name": acct.name,
            "type": acct.account_type or "cash",
            "bank_name": acct.bank_name,
            "balance": float(balance),
        })

    # ── LOANS GIVEN (money owed TO me) ─────────────────────────────────────
    active_loans = db.query(Loan).filter(Loan.is_deleted == False, Loan.status == "active").all()
    loans_given = [l for l in active_loans if l.loan_direction == "given"]
    loans_taken = [l for l in active_loans if l.loan_direction == "taken"]

    given_items = []
    total_given = Decimal("0")
    total_given_principal = Decimal("0")
    total_given_interest = Decimal("0")
    for l in loans_given:
        contact = db.query(Contact).filter(Contact.id == l.contact_id).first()
        try:
            out = calculate_outstanding(l.id, today, db)
            p_out = _D(out.get("principal_outstanding", 0))
            i_out = _D(out.get("interest_outstanding", 0))
            t_out = _D(out.get("total_outstanding", 0))
        except Exception:
            p_out = _D(l.principal_amount)
            i_out = Decimal("0")
            t_out = p_out
        total_given += t_out
        total_given_principal += p_out
        total_given_interest += i_out
        given_items.append({
            "id": l.id, "contact": contact.name if contact else "Unknown",
            "contact_id": l.contact_id,
            "loan_type": l.loan_type, "rate": float(_D(l.interest_rate)),
            "principal_outstanding": float(p_out),
            "interest_outstanding": float(i_out),
            "total_outstanding": float(t_out),
            "disbursed_date": l.disbursed_date.isoformat() if l.disbursed_date else None,
            "expected_end_date": l.expected_end_date.isoformat() if l.expected_end_date else None,
            "institution_name": l.institution_name,
        })
    given_items.sort(key=lambda x: x["total_outstanding"], reverse=True)

    # ── LOANS TAKEN (money I OWE) ──────────────────────────────────────────
    taken_items = []
    total_taken = Decimal("0")
    total_taken_principal = Decimal("0")
    total_taken_interest = Decimal("0")
    for l in loans_taken:
        contact = db.query(Contact).filter(Contact.id == l.contact_id).first()
        try:
            out = calculate_outstanding(l.id, today, db)
            p_out = _D(out.get("principal_outstanding", 0))
            i_out = _D(out.get("interest_outstanding", 0))
            t_out = _D(out.get("total_outstanding", 0))
        except Exception:
            p_out = _D(l.principal_amount)
            i_out = Decimal("0")
            t_out = p_out
        total_taken += t_out
        total_taken_principal += p_out
        total_taken_interest += i_out
        taken_items.append({
            "id": l.id, "contact": contact.name if contact else "Unknown",
            "contact_id": l.contact_id,
            "loan_type": l.loan_type, "rate": float(_D(l.interest_rate)),
            "principal_outstanding": float(p_out),
            "interest_outstanding": float(i_out),
            "total_outstanding": float(t_out),
            "disbursed_date": l.disbursed_date.isoformat() if l.disbursed_date else None,
            "expected_end_date": l.expected_end_date.isoformat() if l.expected_end_date else None,
            "institution_name": l.institution_name,
        })
    taken_items.sort(key=lambda x: x["total_outstanding"], reverse=True)

    # ── PROPERTY INVESTMENTS ────────────────────────────────────────────────
    partnerships = db.query(Partnership).filter(Partnership.is_deleted == False).all()
    properties = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False).all()
    linked_property_ids = {
        p.linked_property_deal_id for p in partnerships
        if p.linked_property_deal_id and p.status != "cancelled"
    }
    _prop_to_partnership = {
        p.linked_property_deal_id: p for p in partnerships
        if p.linked_property_deal_id and p.status != "cancelled"
    }

    property_items = []
    total_property = Decimal("0")
    for prop in properties:
        if prop.status == "cancelled":
            continue
        my_invested = Decimal("0")
        current_value = Decimal("0")

        if prop.property_type == "site":
            my_invested = max(_D(prop.my_investment), _D(prop.advance_paid))
            # For sites, current value = invested + proportional profit (if settled)
            current_value = my_invested
            if prop.status == "settled" and prop.net_profit:
                pct = _D(prop.my_share_percentage or 100)
                current_value += _D(prop.net_profit) * pct / Decimal("100")
        elif prop.id in linked_property_ids:
            part = _prop_to_partnership.get(prop.id)
            if part:
                sm = db.query(PartnershipMember).filter(
                    PartnershipMember.partnership_id == part.id,
                    PartnershipMember.is_self == True,
                ).first()
                if sm:
                    my_invested = _D(sm.advance_contributed)
                    current_value = my_invested
        else:
            my_invested = _D(prop.advance_paid)
            current_value = my_invested
            if prop.deal_type == "purchase_and_hold":
                if prop.purchase_price:
                    current_value = _D(prop.purchase_price)
                if prop.sale_price and prop.status == "settled":
                    current_value = _D(prop.sale_price)

        if my_invested <= 0 and current_value <= 0:
            continue

        total_property += current_value
        property_items.append({
            "id": prop.id, "title": prop.title,
            "property_type": prop.property_type,
            "deal_type": prop.deal_type,
            "location": prop.location,
            "status": prop.status,
            "invested": float(my_invested),
            "current_value": float(current_value),
        })
    property_items.sort(key=lambda x: x["current_value"], reverse=True)

    # ── PARTNERSHIPS (non-property) ─────────────────────────────────────────
    partnership_items = []
    total_partnership = Decimal("0")
    for p in partnerships:
        if p.status == "cancelled" or p.linked_property_deal_id:
            continue
        self_member = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id == p.id,
            PartnershipMember.is_self == True,
        ).first()
        invested = _D(self_member.advance_contributed) if self_member else _D(p.our_investment)
        received = Decimal("0")
        if self_member:
            received = _D(self_member.total_received)
        elif p.our_share_percentage:
            received = _D(p.total_received) * _D(p.our_share_percentage) / Decimal("100")
        else:
            received = _D(p.total_received)
        net_value = invested - received  # unreturned capital = asset
        if net_value <= 0 and invested <= 0:
            continue
        total_partnership += max(net_value, Decimal("0"))
        partnership_items.append({
            "id": p.id, "title": p.title,
            "status": p.status,
            "invested": float(invested), "received": float(received),
            "net_value": float(max(net_value, Decimal("0"))),
        })
    partnership_items.sort(key=lambda x: x["net_value"], reverse=True)

    # ── RECEIVABLES (obligations owed TO me) ────────────────────────────────
    receivables = db.query(MoneyObligation).filter(
        MoneyObligation.is_deleted == False,
        MoneyObligation.obligation_type == "receivable",
        MoneyObligation.status != "settled",
    ).all()
    receivable_items = []
    total_receivable = Decimal("0")
    for o in receivables:
        pending = _D(o.amount) - _D(o.amount_settled)
        if pending <= 0:
            continue
        contact = db.query(Contact).filter(Contact.id == o.contact_id).first() if o.contact_id else None
        total_receivable += pending
        receivable_items.append({
            "id": o.id, "contact": contact.name if contact else "—",
            "reason": o.reason, "pending": float(pending),
            "due_date": o.due_date.isoformat() if o.due_date else None,
        })
    receivable_items.sort(key=lambda x: x["pending"], reverse=True)

    # ── PAYABLES (obligations I owe) ────────────────────────────────────────
    payables = db.query(MoneyObligation).filter(
        MoneyObligation.is_deleted == False,
        MoneyObligation.obligation_type == "payable",
        MoneyObligation.status != "settled",
    ).all()
    payable_items = []
    total_payable = Decimal("0")
    for o in payables:
        pending = _D(o.amount) - _D(o.amount_settled)
        if pending <= 0:
            continue
        contact = db.query(Contact).filter(Contact.id == o.contact_id).first() if o.contact_id else None
        total_payable += pending
        payable_items.append({
            "id": o.id, "contact": contact.name if contact else "—",
            "reason": o.reason, "pending": float(pending),
            "due_date": o.due_date.isoformat() if o.due_date else None,
        })
    payable_items.sort(key=lambda x: x["pending"], reverse=True)

    # ── PARTNER LIABILITIES ─────────────────────────────────────────────────
    partner_liability_items = []
    total_partner_liability = Decimal("0")
    for p in partnerships:
        if p.status == "cancelled":
            continue
        if _D(p.total_received) <= 0:
            continue
        members = db.query(PartnershipMember).filter(
            PartnershipMember.partnership_id == p.id,
            PartnershipMember.is_self == False,
        ).all()
        for m in members:
            owed = _D(m.advance_contributed) + (
                _D(p.total_received) * _D(m.share_percentage) / Decimal("100")
                if m.share_percentage else Decimal("0")
            )
            paid_out = _D(m.total_received)
            if owed > paid_out:
                diff = owed - paid_out
                total_partner_liability += diff
                mc = db.query(Contact).filter(Contact.id == m.contact_id).first() if m.contact_id else None
                partner_liability_items.append({
                    "partnership_id": p.id, "partnership": p.title,
                    "partner": mc.name if mc else "Partner",
                    "owed": float(owed), "paid": float(paid_out),
                    "pending": float(diff),
                })
    partner_liability_items.sort(key=lambda x: x["pending"], reverse=True)

    # ── COLLATERAL HELD (assets securing loans I gave) ───────────────────────
    from app.models.collateral import Collateral
    collaterals = db.query(Collateral).join(Loan).filter(
        Loan.loan_direction == "given",
        Loan.status == "active",
        Loan.is_deleted == False,
    ).all()
    collateral_items = []
    total_collateral = Decimal("0")
    for c in collaterals:
        val = _D(c.estimated_value)
        total_collateral += val
        loan = c.loan
        contact = db.query(Contact).filter(Contact.id == loan.contact_id).first() if loan else None
        collateral_items.append({
            "id": c.id, "loan_id": c.loan_id,
            "contact": contact.name if contact else "—",
            "type": c.collateral_type,
            "description": c.description,
            "estimated_value": float(val),
            "gold_weight_grams": float(c.gold_weight_grams) if c.gold_weight_grams else None,
            "gold_carat": c.gold_carat,
        })
    collateral_items.sort(key=lambda x: x["estimated_value"], reverse=True)

    # ── TOTALS ──────────────────────────────────────────────────────────────
    total_assets = total_cash + total_given + total_property + total_partnership + total_receivable
    total_liabilities = total_taken + total_payable + total_partner_liability
    net_worth = total_assets - total_liabilities

    return {
        "as_of_date": today.isoformat(),
        "net_worth": float(net_worth),
        "total_assets": float(total_assets),
        "total_liabilities": float(total_liabilities),
        "assets": {
            "cash": {
                "total": float(total_cash),
                "items": account_items,
            },
            "loans_given": {
                "total": float(total_given),
                "principal": float(total_given_principal),
                "interest": float(total_given_interest),
                "count": len(given_items),
                "items": given_items,
            },
            "properties": {
                "total": float(total_property),
                "count": len(property_items),
                "items": property_items,
            },
            "partnerships": {
                "total": float(total_partnership),
                "count": len(partnership_items),
                "items": partnership_items,
            },
            "receivables": {
                "total": float(total_receivable),
                "count": len(receivable_items),
                "items": receivable_items,
            },
            "collateral_held": {
                "total": float(total_collateral),
                "count": len(collateral_items),
                "items": collateral_items,
            },
        },
        "liabilities": {
            "loans_taken": {
                "total": float(total_taken),
                "principal": float(total_taken_principal),
                "interest": float(total_taken_interest),
                "count": len(taken_items),
                "items": taken_items,
            },
            "payables": {
                "total": float(total_payable),
                "count": len(payable_items),
                "items": payable_items,
            },
            "partner_payables": {
                "total": float(total_partner_liability),
                "count": len(partner_liability_items),
                "items": partner_liability_items,
            },
        },
    }


# ── FORECAST / CASH FLOW PROJECTION ─────────────────────────────────────────
#
# CONFIDENCE SCORING (based on actual payment behavior, not just loan type):
#   HIGH   – Borrower paid within last 30 days
#   MEDIUM – Borrower paid within last 60 days (but not last 30)
#   LOW    – Borrower hasn't paid in 60+ days, or never paid
#
# For EMI loans (taken by us, contractual obligation) — outflows stay HIGH.
# For beesi installments — outflows stay MEDIUM (committed).
#
# interest_rate is stored as ANNUAL percentage.  Daily rate = rate / 100 / days_in_year.
# Interest uses calendar-month periods with actual days count.

@router.get("/forecast")
def analytics_forecast(
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD start date"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD end date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from dateutil.relativedelta import relativedelta

    today = date.today()
    start_date = date.fromisoformat(from_date) if from_date else today
    horizon = date.fromisoformat(to_date) if to_date else start_date + timedelta(days=30)

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

    # ── helper: confidence based on loan type + payment behavior ────────
    # Build a map: loan_id → most recent payment date for THAT specific loan
    _loan_last_payment = {}
    for loan in loans_given:
        for p in (loan.payments or []):
            pd_date = p.payment_date
            if pd_date:
                existing = _loan_last_payment.get(loan.id)
                if existing is None or pd_date > existing:
                    _loan_last_payment[loan.id] = pd_date

    def _interest_payment_confidence(loan_id):
        """Confidence for interest_only loans based on payment recency."""
        last = _loan_last_payment.get(loan_id)
        if last is None:
            return "low"            # never paid on this loan
        days_since = (today - last).days
        if days_since <= 30:
            return "high"           # paying regularly each month
        elif days_since <= 60:
            return "medium"         # not paid in ~2 months
        else:
            return "low"            # not paid in 4+ months

    def _loan_confidence(loan):
        """Type-based confidence: short_term=HIGH, emi=HIGH,
        interest_only=payment-history-based, beesi=LOW."""
        if loan.loan_type == "short_term":
            return "high"
        if loan.loan_type == "emi":
            return "high"
        if loan.loan_type == "interest_only":
            return _interest_payment_confidence(loan.id)
        return "low"

    # ── helper: remaining principal for a loan (principal − payments toward principal)
    def _remaining_principal(loan):
        principal = _D(loan.principal_amount)
        paid = sum(
            _D(p.allocated_to_principal)
            for p in (loan.payments or [])
            if p.allocated_to_principal
        )
        return max(principal - paid, Decimal("0"))

    # ── INFLOWS: Loans Given ─────────────────────────────────────────────
    def _loan_inflow_items(loan, from_dt, horizon_date):
        items = []
        name = _contact(loan)
        conf = _loan_confidence(loan)

        if loan.loan_type == "emi":
            # Show all unpaid EMIs within the selected window
            schedule = get_emi_schedule_with_payments(loan, db)
            for entry in schedule:
                dd = entry["due_date"]
                if dd < from_dt or dd > horizon_date:
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
                        "confidence": conf,
                    })

        elif loan.loan_type == "interest_only":
            rate = _D(loan.interest_rate)
            if rate <= 0:
                return items
            principal = _D(loan.principal_amount)
            start = loan.interest_start_date or loan.disbursed_date
            if not start:
                return items

            # 1. Overdue interest: accrued but unpaid as of today (always show)
            outstanding = calculate_outstanding(loan.id, today, db)
            overdue_interest = outstanding["interest_outstanding"]
            if overdue_interest > Decimal("0"):
                items.append({
                    "source": "interest_receipt", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": float(overdue_interest.quantize(Decimal("0.01"))),
                    "due_date": None,
                    "label": f"Overdue interest accrued ({rate}% p.a.)",
                    "confidence": conf,
                    "is_overdue": True,
                })

            # 2. Upcoming interest: only for regular payers (high conf), one merged row
            if conf == "high":
                future_start = max(from_dt, today)
                if future_start < horizon_date:
                    days = (horizon_date - future_start).days
                    future_interest = float(_calc_period_interest(
                        principal, rate, future_start, days
                    ).quantize(Decimal("0.01")))
                    if future_interest > 0:
                        items.append({
                            "source": "interest_receipt", "contact": name,
                            "contact_id": loan.contact_id, "loan_id": loan.id,
                            "amount": future_interest,
                            "due_date": horizon_date.isoformat(),
                            "label": f"Interest {future_start.strftime('%d %b')} \u2013 {horizon_date.strftime('%d %b %Y')} ({rate}% p.a.)",
                            "confidence": conf,
                        })

            # 3. Principal return: show if overdue or falls in window
            if loan.expected_end_date:
                end_date = loan.expected_end_date
                is_end_past = end_date < today
                if is_end_past or end_date <= horizon_date:
                    rem = _remaining_principal(loan)
                    if rem > 0:
                        items.append({
                            "source": "principal_return", "contact": name,
                            "contact_id": loan.contact_id, "loan_id": loan.id,
                            "amount": float(rem),
                            "due_date": end_date.isoformat(),
                            "label": (f"Overdue principal return (due {end_date.strftime('%d %b %Y')})"
                                      if is_end_past else "Principal return (expected end date)"),
                            "confidence": "low" if conf == "low" else "medium",
                            **({"is_overdue": True} if is_end_past else {}),
                        })

        elif loan.loan_type == "short_term":
            remaining = _remaining_principal(loan)
            if remaining <= 0:
                return items  # fully repaid
            end = loan.expected_end_date or loan.interest_free_till
            if end:
                is_end_past = end < today
                if is_end_past or end <= horizon_date:
                    items.append({
                        "source": "principal_return", "contact": name,
                        "contact_id": loan.contact_id, "loan_id": loan.id,
                        "amount": float(remaining),
                        "due_date": end.isoformat(),
                        "label": (f"Overdue: Short-term return (due {end.strftime('%d %b %Y')})"
                                  if is_end_past else "Short-term loan return"),
                        "confidence": conf,
                        **({"is_overdue": True} if is_end_past else {}),
                    })
            else:
                # No due date — include with low confidence
                items.append({
                    "source": "principal_return", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": float(remaining),
                    "due_date": None,
                    "label": "Short-term loan return (no due date set)",
                    "confidence": "low",
                })

        return items

    # ── OUTFLOWS: Loans Taken (our obligations — always high confidence) ──
    def _loan_outflow_items(loan, from_dt, horizon_date):
        items = []
        name = _contact(loan)

        if loan.loan_type == "emi":
            # Show overdue EMIs always, plus only the very next upcoming one (avoids 10-year flood)
            schedule = get_emi_schedule_with_payments(loan, db)
            next_upcoming_added = False
            for entry in schedule:
                dd = entry["due_date"]
                if entry["status"] == "paid":
                    continue
                remaining = float(entry["outstanding"])
                if remaining <= 0:
                    continue
                if dd < today:
                    # Overdue — always show regardless of date window
                    items.append({
                        "source": "emi_payment", "contact": name,
                        "contact_id": loan.contact_id, "loan_id": loan.id,
                        "amount": remaining,
                        "due_date": dd.isoformat(),
                        "label": f"EMI #{entry['emi_number']} (overdue)",
                        "confidence": "high",
                        "is_overdue": True,
                    })
                elif not next_upcoming_added and dd <= horizon_date:
                    # Only the single next upcoming EMI within the window
                    items.append({
                        "source": "emi_payment", "contact": name,
                        "contact_id": loan.contact_id, "loan_id": loan.id,
                        "amount": remaining,
                        "due_date": dd.isoformat(),
                        "label": f"EMI #{entry['emi_number']} (next due)",
                        "confidence": "high",
                    })
                    next_upcoming_added = True

        elif loan.loan_type == "interest_only":
            rate = _D(loan.interest_rate)
            if rate <= 0:
                return items
            principal = _D(loan.principal_amount)
            start = loan.interest_start_date or loan.disbursed_date
            if not start:
                return items

            # 1. Overdue interest outstanding as of today (always show)
            outstanding = calculate_outstanding(loan.id, today, db)
            overdue_interest = outstanding["interest_outstanding"]
            if overdue_interest > Decimal("0"):
                items.append({
                    "source": "interest_payment", "contact": name,
                    "contact_id": loan.contact_id, "loan_id": loan.id,
                    "amount": float(overdue_interest.quantize(Decimal("0.01"))),
                    "due_date": None,
                    "label": f"Overdue interest accrued ({rate}% p.a.)",
                    "confidence": "high",
                    "is_overdue": True,
                })

            # 2. Upcoming interest: one merged row for window (always show — our obligation)
            future_start = max(from_dt, today)
            if future_start < horizon_date:
                days = (horizon_date - future_start).days
                future_interest = float(_calc_period_interest(
                    principal, rate, future_start, days
                ).quantize(Decimal("0.01")))
                if future_interest > 0:
                    items.append({
                        "source": "interest_payment", "contact": name,
                        "contact_id": loan.contact_id, "loan_id": loan.id,
                        "amount": future_interest,
                        "due_date": horizon_date.isoformat(),
                        "label": f"Interest {future_start.strftime('%d %b')} \u2013 {horizon_date.strftime('%d %b %Y')} ({rate}% p.a.)",
                        "confidence": "high",
                    })

            # 3. Principal: show if overdue or due in window
            if loan.expected_end_date:
                end_date = loan.expected_end_date
                rem = _remaining_principal(loan)
                if rem > 0:
                    if end_date < today:
                        items.append({
                            "source": "principal_payment", "contact": name,
                            "contact_id": loan.contact_id, "loan_id": loan.id,
                            "amount": float(rem),
                            "due_date": end_date.isoformat(),
                            "label": f"Overdue principal (was due {end_date.strftime('%d %b %Y')})",
                            "confidence": "high",
                            "is_overdue": True,
                        })
                    elif end_date <= horizon_date:
                        items.append({
                            "source": "principal_payment", "contact": name,
                            "contact_id": loan.contact_id, "loan_id": loan.id,
                            "amount": float(rem),
                            "due_date": end_date.isoformat(),
                            "label": "Principal due (expected end date)",
                            "confidence": "medium",
                        })

        elif loan.loan_type == "short_term":
            remaining = _remaining_principal(loan)
            if remaining <= 0:
                return items
            end = loan.expected_end_date or loan.interest_free_till
            if end:
                is_end_past = end < today
                if is_end_past or end <= horizon_date:
                    items.append({
                        "source": "principal_payment", "contact": name,
                        "contact_id": loan.contact_id, "loan_id": loan.id,
                        "amount": float(remaining),
                        "due_date": end.isoformat(),
                        "label": (f"Overdue: Short-term return (was due {end.strftime('%d %b %Y')})"
                                  if is_end_past else "Short-term loan return due"),
                        "confidence": "high" if is_end_past else "medium",
                        **({"is_overdue": True} if is_end_past else {}),
                    })

        return items

    # ── Build forecast for requested date range ────────────────────────────
    inflow_items = []
    outflow_items = []

    for loan in loans_given:
        inflow_items.extend(_loan_inflow_items(loan, start_date, horizon))
    for loan in loans_taken:
        outflow_items.extend(_loan_outflow_items(loan, start_date, horizon))

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

        # --- Money Flow Obligations ---
        pending_obligations = db.query(MoneyObligation).filter(
            MoneyObligation.is_deleted == False,
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

    return {
        "as_of_date": today.isoformat(),
        "from_date": start_date.isoformat(),
        "to_date": horizon.isoformat(),
        "inflow": {
            "total": round(total_in, 2),
            "high": round(_sum_conf(inflow_items, "high"), 2),
            "medium": round(_sum_conf(inflow_items, "medium"), 2),
            "low": round(_sum_conf(inflow_items, "low"), 2),
            "emi_receipts": round(_sum_by(inflow_items, "emi_"), 2),
            "interest_receipts": round(_sum_by(inflow_items, "interest_"), 2),
            "principal_returns": round(_sum_by(inflow_items, "principal_"), 2),
            "property": round(_sum_by(inflow_items, "property"), 2),
            "receivables": round(_sum_by(inflow_items, "obligation_"), 2),
            "items": sorted(inflow_items, key=lambda x: (
                0 if x.get("is_overdue") else 1,
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
            "payables": round(_sum_by(outflow_items, "obligation_"), 2),
            "items": sorted(outflow_items, key=lambda x: (
                0 if x.get("is_overdue") else 1,
                {"high": 0, "medium": 1, "low": 2}.get(x.get("confidence"), 3),
                x["due_date"] or "9999-12-31",
            )),
        },
        "net": round(total_in - total_out, 2),
    }


# ── HISTORICAL ACTIVITY — What actually happened in the past ─────────────────
#
# Shows: EMIs collected, Interest collected, Loans given, Loans taken,
#        Investments made, Returns received — all with contact drill-down.

@router.get("/activity")
def analytics_activity(
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    period: Optional[str] = Query("30_days", description="30_days|90_days|1_year|custom"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Historical money movement — what actually happened.
    Period presets: 30_days, 90_days, 1_year, or custom with from_date/to_date.
    """
    today = date.today()

    if period == "custom" and from_date and to_date:
        start = date.fromisoformat(from_date)
        end = date.fromisoformat(to_date)
    elif period == "90_days":
        start = today - timedelta(days=90)
        end = today
    elif period == "1_year":
        start = today - timedelta(days=365)
        end = today
    else:  # 30_days default
        start = today - timedelta(days=30)
        end = today

    # ── EMIs Collected (payments received on EMI loans given) ────────────
    emi_payments = (
        db.query(LoanPayment, Loan)
        .join(Loan, Loan.id == LoanPayment.loan_id)
        .filter(
            Loan.loan_direction == "given",
            Loan.loan_type == "emi",
            Loan.is_deleted == False,
            LoanPayment.payment_date >= start,
            LoanPayment.payment_date <= end,
        )
        .all()
    )
    emis_collected = []
    for pay, loan in emi_payments:
        cname = loan.contact.name if loan.contact else f"Contact #{loan.contact_id}"
        emis_collected.append({
            "contact": cname, "contact_id": loan.contact_id, "loan_id": loan.id,
            "amount": float(_D(pay.amount_paid)),
            "interest_portion": float(_D(pay.allocated_to_current_interest) + _D(pay.allocated_to_overdue_interest)),
            "principal_portion": float(_D(pay.allocated_to_principal)),
            "date": pay.payment_date.isoformat(),
            "payment_mode": pay.payment_mode,
        })

    # ── Interest Collected + Principal Collected (payments on interest_only / short_term loans given) ──
    interest_payments = (
        db.query(LoanPayment, Loan)
        .join(Loan, Loan.id == LoanPayment.loan_id)
        .filter(
            Loan.loan_direction == "given",
            Loan.loan_type.in_(["interest_only", "short_term"]),
            Loan.is_deleted == False,
            LoanPayment.payment_date >= start,
            LoanPayment.payment_date <= end,
        )
        .all()
    )
    interest_collected = []
    principal_collected = []
    for pay, loan in interest_payments:
        cname = loan.contact.name if loan.contact else f"Contact #{loan.contact_id}"
        int_amt = float(_D(pay.allocated_to_current_interest) + _D(pay.allocated_to_overdue_interest))
        prin_amt = float(_D(pay.allocated_to_principal))
        base = {
            "contact": cname, "contact_id": loan.contact_id, "loan_id": loan.id,
            "date": pay.payment_date.isoformat(),
            "loan_type": loan.loan_type,
        }
        if int_amt > 0:
            interest_collected.append({**base, "amount": int_amt})
        if prin_amt > 0:
            principal_collected.append({**base, "amount": prin_amt})

    # ── Loans Given (new disbursements in period) ────────────────────────
    new_loans_given = (
        db.query(Loan).filter(
            Loan.loan_direction == "given",
            Loan.is_deleted == False,
            Loan.disbursed_date >= start,
            Loan.disbursed_date <= end,
        ).all()
    )
    loans_given_list = []
    for loan in new_loans_given:
        cname = loan.contact.name if loan.contact else f"Contact #{loan.contact_id}"
        loans_given_list.append({
            "contact": cname, "contact_id": loan.contact_id, "loan_id": loan.id,
            "amount": float(_D(loan.principal_amount)),
            "date": loan.disbursed_date.isoformat(),
            "loan_type": loan.loan_type,
            "interest_rate": float(_D(loan.interest_rate)),
        })

    # ── Loans Taken (new borrowings in period) ───────────────────────────
    new_loans_taken = (
        db.query(Loan).filter(
            Loan.loan_direction == "taken",
            Loan.is_deleted == False,
            Loan.disbursed_date >= start,
            Loan.disbursed_date <= end,
        ).all()
    )
    loans_taken_list = []
    for loan in new_loans_taken:
        cname = loan.contact.name if loan.contact else (loan.institution_name or f"Contact #{loan.contact_id}")
        loans_taken_list.append({
            "contact": cname, "contact_id": loan.contact_id, "loan_id": loan.id,
            "amount": float(_D(loan.principal_amount)),
            "date": loan.disbursed_date.isoformat(),
            "loan_type": loan.loan_type,
            "interest_rate": float(_D(loan.interest_rate)),
        })

    # ── Payments Made (on loans taken — our outflows) ────────────────────
    payments_made = (
        db.query(LoanPayment, Loan)
        .join(Loan, Loan.id == LoanPayment.loan_id)
        .filter(
            Loan.loan_direction == "taken",
            Loan.is_deleted == False,
            LoanPayment.payment_date >= start,
            LoanPayment.payment_date <= end,
        )
        .all()
    )
    payments_made_list = []
    for pay, loan in payments_made:
        cname = loan.contact.name if loan.contact else (loan.institution_name or f"Contact #{loan.contact_id}")
        payments_made_list.append({
            "contact": cname, "contact_id": loan.contact_id, "loan_id": loan.id,
            "amount": float(_D(pay.amount_paid)),
            "date": pay.payment_date.isoformat(),
            "loan_type": loan.loan_type,
        })

    # ── Property Investments (only MY money) ─────────────────────────────
    property_activity = []
    prop_deals = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False).all()

    # Build lookup: property_id → linked partnership (for partnership-linked plots)
    _linked_partnerships = db.query(Partnership).filter(
        Partnership.is_deleted == False,
        Partnership.linked_property_deal_id != None,
        Partnership.status != "cancelled",
    ).all()
    _prop_to_part = {p.linked_property_deal_id: p for p in _linked_partnerships}
    _linked_prop_ids = set(_prop_to_part.keys())

    for prop in prop_deals:
        if prop.status == "cancelled":
            continue

        # Site properties: show my investment (max of my_investment, advance_paid)
        if prop.property_type == "site":
            inv = max(_D(prop.my_investment), _D(prop.advance_paid))
            inv_date = prop.site_deal_start_date or prop.advance_date
            if inv > 0 and inv_date and start <= inv_date <= end:
                property_activity.append({
                    "property": prop.title, "property_id": prop.id,
                    "amount": float(inv),
                    "date": inv_date.isoformat(),
                    "txn_type": "my_investment",
                    "description": f"My investment in {prop.title}",
                })
            continue

        # Plot properties linked to partnership: show only self-member advance
        if prop.id in _linked_prop_ids:
            part = _prop_to_part[prop.id]
            sm = db.query(PartnershipMember).filter(
                PartnershipMember.partnership_id == part.id,
                PartnershipMember.is_self == True,
            ).first()
            if sm and _D(sm.advance_contributed) > 0:
                adv_date = prop.advance_date or part.start_date
                if adv_date and start <= adv_date <= end:
                    property_activity.append({
                        "property": prop.title, "property_id": prop.id,
                        "amount": float(_D(sm.advance_contributed)),
                        "date": adv_date.isoformat(),
                        "txn_type": "advance_given",
                        "description": f"My advance for {prop.title} (partnership)",
                    })
            continue

        # Standalone plot: prefer PropertyTransaction records over PropertyDeal.advance_paid
        has_txns = db.query(PropertyTransaction).filter(
            PropertyTransaction.property_deal_id == prop.id,
            PropertyTransaction.txn_date >= start,
            PropertyTransaction.txn_date <= end,
        ).count()
        if has_txns > 0:
            txns = db.query(PropertyTransaction).filter(
                PropertyTransaction.property_deal_id == prop.id,
                PropertyTransaction.txn_date >= start,
                PropertyTransaction.txn_date <= end,
            ).all()
            for txn in txns:
                property_activity.append({
                    "property": prop.title, "property_id": prop.id,
                    "amount": float(_D(txn.amount)),
                    "date": txn.txn_date.isoformat(),
                    "txn_type": txn.txn_type,
                    "description": txn.description,
                })
        else:
            # No transactions — fall back to advance_paid field
            adv = _D(prop.advance_paid)
            adv_date = prop.advance_date
            if adv > 0 and adv_date and start <= adv_date <= end:
                property_activity.append({
                    "property": prop.title, "property_id": prop.id,
                    "amount": float(adv),
                    "date": adv_date.isoformat(),
                    "txn_type": "advance_given",
                    "description": f"Advance paid for {prop.title}",
                })

    # ── Partnership Transactions ─────────────────────────────────────────
    partner_txns = (
        db.query(PartnershipTransaction, Partnership)
        .join(Partnership, Partnership.id == PartnershipTransaction.partnership_id)
        .filter(
            Partnership.is_deleted == False,
            PartnershipTransaction.txn_date >= start,
            PartnershipTransaction.txn_date <= end,
        )
        .all()
    )
    partnership_activity = []
    for txn, part in partner_txns:
        partnership_activity.append({
            "partnership": part.title, "partnership_id": part.id,
            "amount": float(_D(txn.amount)),
            "date": txn.txn_date.isoformat(),
            "txn_type": txn.txn_type,
            "description": txn.description,
        })

    # ── Beesi Activity ───────────────────────────────────────────────────
    beesi_installments = (
        db.query(BeesiInstallment, Beesi)
        .join(Beesi, Beesi.id == BeesiInstallment.beesi_id)
        .filter(
            Beesi.is_deleted == False,
            BeesiInstallment.payment_date >= start,
            BeesiInstallment.payment_date <= end,
        )
        .all()
    )
    beesi_activity = []
    for inst, b in beesi_installments:
        beesi_activity.append({
            "beesi": b.title, "beesi_id": b.id,
            "amount": float(_D(inst.actual_paid)),
            "date": inst.payment_date.isoformat(),
            "month_number": inst.month_number,
        })

    # ── Aggregate summaries ──────────────────────────────────────────────
    def _group_by_contact(items):
        groups = {}
        for it in items:
            key = it.get("contact") or it.get("property") or it.get("partnership") or it.get("beesi") or "Unknown"
            if key not in groups:
                groups[key] = {"contact": key, "contact_id": it.get("contact_id"), "total": 0, "count": 0, "items": []}
            groups[key]["total"] += it["amount"]
            groups[key]["count"] += 1
            groups[key]["items"].append(it)
        return sorted(groups.values(), key=lambda g: g["total"], reverse=True)

    return {
        "period": {"from": start.isoformat(), "to": end.isoformat(), "preset": period},
        "summary": {
            "emis_collected": round(sum(e["amount"] for e in emis_collected), 2),
            "interest_collected": round(sum(e["amount"] for e in interest_collected), 2),
            "principal_collected": round(sum(e["amount"] for e in principal_collected), 2),
            "total_collected": round(sum(e["amount"] for e in emis_collected) + sum(e["amount"] for e in interest_collected) + sum(e["amount"] for e in principal_collected), 2),
            "loans_given": round(sum(e["amount"] for e in loans_given_list), 2),
            "loans_taken": round(sum(e["amount"] for e in loans_taken_list), 2),
            "payments_made": round(sum(e["amount"] for e in payments_made_list), 2),
            "property_invested": round(sum(t["amount"] for t in property_activity if t["txn_type"] in ("advance_given", "my_investment", "advance_to_seller", "payment_to_seller", "commission_paid", "expense", "other")), 2),
            "property_received": round(sum(t["amount"] for t in property_activity if t["txn_type"] in ("received_from_buyer", "sale_proceeds", "refund")), 2),
            "partnership_invested": round(sum(t["amount"] for t in partnership_activity if t["txn_type"] in ("invested", "expense")), 2),
            "partnership_received": round(sum(t["amount"] for t in partnership_activity if t["txn_type"] in ("received", "profit_distributed")), 2),
            "beesi_paid": round(sum(b["amount"] for b in beesi_activity), 2),
        },
        "sections": {
            "emis_collected": {
                "total": round(sum(e["amount"] for e in emis_collected), 2),
                "count": len(emis_collected),
                "by_contact": _group_by_contact(emis_collected),
            },
            "interest_collected": {
                "total": round(sum(e["amount"] for e in interest_collected), 2),
                "count": len(interest_collected),
                "by_contact": _group_by_contact(interest_collected),
            },
            "principal_collected": {
                "total": round(sum(e["amount"] for e in principal_collected), 2),
                "count": len(principal_collected),
                "by_contact": _group_by_contact(principal_collected),
            },
            "loans_given": {
                "total": round(sum(e["amount"] for e in loans_given_list), 2),
                "count": len(loans_given_list),
                "by_contact": _group_by_contact(loans_given_list),
            },
            "loans_taken": {
                "total": round(sum(e["amount"] for e in loans_taken_list), 2),
                "count": len(loans_taken_list),
                "by_contact": _group_by_contact(loans_taken_list),
            },
            "payments_made": {
                "total": round(sum(e["amount"] for e in payments_made_list), 2),
                "count": len(payments_made_list),
                "by_contact": _group_by_contact(payments_made_list),
            },
            "property": {
                "total": round(sum(t["amount"] for t in property_activity), 2),
                "count": len(property_activity),
                "items": property_activity,
            },
            "partnerships": {
                "items": partnership_activity,
            },
            "beesi": {
                "total": round(sum(b["amount"] for b in beesi_activity), 2),
                "items": beesi_activity,
            },
        },
    }


# ── MONEY FLOW ANALYTICS — account-transaction-based in/out tracking ─────────

@router.get("/money-flow")
def analytics_money_flow(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    period: Optional[str] = Query("3_months"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Account-transaction-based money flow: every credit/debit across all accounts,
    grouped by source type, account, and month.
    """
    today = date.today()
    if period == "custom" and from_date and to_date:
        start = date.fromisoformat(from_date)
        end = date.fromisoformat(to_date)
    elif period == "1_month":
        start = today.replace(day=1)
        end = today
    elif period == "6_months":
        start = (today.replace(day=1) - timedelta(days=180)).replace(day=1)
        end = today
    elif period == "1_year":
        start = (today.replace(day=1) - timedelta(days=365)).replace(day=1)
        end = today
    elif period == "all":
        start = date(2000, 1, 1)
        end = today
    else:  # 3_months
        start = (today.replace(day=1) - timedelta(days=90)).replace(day=1)
        end = today

    txns = (
        db.query(AccountTransaction)
        .join(CashAccount, CashAccount.id == AccountTransaction.account_id)
        .filter(
            CashAccount.is_deleted == False,
            AccountTransaction.txn_date >= start,
            AccountTransaction.txn_date <= end,
        )
        .all()
    )

    # Gather account names
    accounts = db.query(CashAccount).filter(CashAccount.is_deleted == False).all()
    acct_map = {a.id: a.name for a in accounts}

    total_in = 0.0
    total_out = 0.0
    by_source_in = {}
    by_source_out = {}
    by_account = {}
    by_month = {}
    by_payment_mode_in = {}
    by_payment_mode_out = {}
    recent = []

    for t in txns:
        amt = float(_D(t.amount))
        src = t.linked_type or "manual"
        mode = t.payment_mode or "unknown"
        acct_name = acct_map.get(t.account_id, "Unknown")
        month_key = t.txn_date.strftime("%Y-%m") if t.txn_date else "unknown"

        # Per-account
        if acct_name not in by_account:
            by_account[acct_name] = {"credit": 0.0, "debit": 0.0}

        # Per-month
        if month_key not in by_month:
            by_month[month_key] = {"credit": 0.0, "debit": 0.0}

        if t.txn_type == "credit":
            total_in += amt
            by_source_in[src] = by_source_in.get(src, 0.0) + amt
            by_account[acct_name]["credit"] += amt
            by_month[month_key]["credit"] += amt
            by_payment_mode_in[mode] = by_payment_mode_in.get(mode, 0.0) + amt
        else:
            total_out += amt
            by_source_out[src] = by_source_out.get(src, 0.0) + amt
            by_account[acct_name]["debit"] += amt
            by_month[month_key]["debit"] += amt
            by_payment_mode_out[mode] = by_payment_mode_out.get(mode, 0.0) + amt

        recent.append({
            "date": t.txn_date.isoformat() if t.txn_date else None,
            "type": t.txn_type,
            "amount": amt,
            "source": src,
            "description": t.description,
            "account": acct_name,
            "payment_mode": mode,
        })

    recent.sort(key=lambda x: x["date"] or "", reverse=True)

    # Expenses by category in period
    expenses = (
        db.query(Expense)
        .filter(
            Expense.expense_date >= start,
            Expense.expense_date <= end,
        )
        .all()
    )
    expense_by_category = {}
    total_expenses = 0.0
    for e in expenses:
        cat = e.category or "misc"
        amt = float(_D(e.amount))
        expense_by_category[cat] = expense_by_category.get(cat, 0.0) + amt
        total_expenses += amt

    # Sort monthly data
    monthly = sorted(
        [{"month": k, "credit": round(v["credit"], 2), "debit": round(v["debit"], 2)} for k, v in by_month.items()],
        key=lambda x: x["month"],
    )

    return {
        "period": {"from": start.isoformat(), "to": end.isoformat(), "preset": period},
        "total_in": round(total_in, 2),
        "total_out": round(total_out, 2),
        "net_flow": round(total_in - total_out, 2),
        "inflow_by_source": [
            {"source": k, "amount": round(v, 2)}
            for k, v in sorted(by_source_in.items(), key=lambda x: x[1], reverse=True)
        ],
        "outflow_by_source": [
            {"source": k, "amount": round(v, 2)}
            for k, v in sorted(by_source_out.items(), key=lambda x: x[1], reverse=True)
        ],
        "by_account": [
            {"account": k, "credit": round(v["credit"], 2), "debit": round(v["debit"], 2), "net": round(v["credit"] - v["debit"], 2)}
            for k, v in sorted(by_account.items(), key=lambda x: x[1]["credit"] + x[1]["debit"], reverse=True)
        ],
        "monthly": monthly,
        "inflow_by_mode": [
            {"mode": k, "amount": round(v, 2)}
            for k, v in sorted(by_payment_mode_in.items(), key=lambda x: x[1], reverse=True)
        ],
        "outflow_by_mode": [
            {"mode": k, "amount": round(v, 2)}
            for k, v in sorted(by_payment_mode_out.items(), key=lambda x: x[1], reverse=True)
        ],
        "expenses": {
            "total": round(total_expenses, 2),
            "by_category": [
                {"category": k, "amount": round(v, 2)}
                for k, v in sorted(expense_by_category.items(), key=lambda x: x[1], reverse=True)
            ],
        },
        "recent_transactions": recent[:50],
    }


# ── SMART FORECAST — Tiered probability, liquidity runway, mode separation ──

@router.get("/smart-forecast")
def smart_forecast(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Smart forecast with 15/30/90-day horizons, probability tiers,
    liquidity runway indicator, and Cash vs Bank separation.
    """
    from collections import defaultdict

    today = date.today()
    horizons = {
        "15d": today + timedelta(days=15),
        "30d": today + timedelta(days=30),
        "90d": today + timedelta(days=90),
    }

    # ── Gather current liquid balances ──
    accounts = db.query(CashAccount).filter(CashAccount.is_deleted == False).all()
    cash_balance = Decimal("0")
    bank_balance = Decimal("0")
    account_balances = []
    for acct in accounts:
        running = _D(acct.opening_balance)
        for t in (acct.transactions or []):
            if t.txn_type == "credit":
                running += _D(t.amount)
            else:
                running -= _D(t.amount)
        is_cash = acct.account_type == "cash"
        if is_cash:
            cash_balance += running
        else:
            bank_balance += running
        account_balances.append({
            "id": acct.id, "name": acct.name, "type": acct.account_type,
            "balance": float(running), "mode": "cash" if is_cash else "bank",
        })

    total_liquid = cash_balance + bank_balance

    # ── Reuse forecast logic ──
    active_loans = db.query(Loan).filter(
        Loan.is_deleted == False, Loan.status == "active",
    ).all()
    loans_given = [l for l in active_loans if l.loan_direction == "given"]
    loans_taken = [l for l in active_loans if l.loan_direction == "taken"]

    def _contact(loan):
        if loan.contact:
            return loan.contact.name
        return loan.institution_name or f"Contact #{loan.contact_id}"

    _loan_last_pay = {}
    for loan in loans_given:
        for p in (loan.payments or []):
            if p.payment_date:
                existing = _loan_last_pay.get(loan.id)
                if existing is None or p.payment_date > existing:
                    _loan_last_pay[loan.id] = p.payment_date

    def _payment_conf(loan_id):
        last = _loan_last_pay.get(loan_id)
        if not last:
            return "low"
        days_since = (today - last).days
        return "high" if days_since <= 30 else ("medium" if days_since <= 60 else "low")

    def _rem_principal(loan):
        principal = _D(loan.principal_amount)
        paid = sum(_D(p.allocated_to_principal) for p in (loan.payments or []) if p.allocated_to_principal)
        return max(principal - paid, Decimal("0"))

    all_items = []

    # Loan inflows — given loans
    for loan in loans_given:
        name = _contact(loan)
        conf = "high" if loan.loan_type in ("emi", "short_term") else _payment_conf(loan.id)

        if loan.loan_type == "emi":
            schedule = get_emi_schedule_with_payments(loan, db)
            for entry in schedule:
                dd = entry["due_date"]
                if dd < today or dd > horizons["90d"]:
                    continue
                if entry["status"] == "paid":
                    continue
                remaining = float(entry["outstanding"])
                if remaining > 0:
                    all_items.append({
                        "direction": "inflow", "source": "Loan", "sub_source": "EMI Receipt",
                        "contact": name, "contact_id": loan.contact_id,
                        "amount": remaining, "due_date": dd.isoformat(),
                        "label": f"EMI #{entry['emi_number']} from {name}",
                        "tier": 1, "confidence": conf, "mode": "bank",
                    })

        elif loan.loan_type == "interest_only":
            rate = _D(loan.interest_rate)
            if rate <= 0:
                continue
            outstanding = calculate_outstanding(loan.id, today, db)
            overdue = outstanding["interest_outstanding"]
            if overdue > Decimal("0"):
                is_overdue_long = (today - (_loan_last_pay.get(loan.id) or today)).days > 90
                all_items.append({
                    "direction": "inflow", "source": "Loan", "sub_source": "Interest (Overdue)",
                    "contact": name, "contact_id": loan.contact_id,
                    "amount": float(overdue.quantize(Decimal("0.01"))),
                    "due_date": None, "label": f"Overdue interest from {name}",
                    "tier": 3 if is_overdue_long else 2,
                    "confidence": "low" if is_overdue_long else conf,
                    "mode": "bank", "is_overdue": True,
                })
            if conf == "high":
                days_90 = (horizons["90d"] - today).days
                fut_int = float(_calc_period_interest(
                    _D(loan.principal_amount), rate, today, days_90,
                ).quantize(Decimal("0.01")))
                if fut_int > 0:
                    all_items.append({
                        "direction": "inflow", "source": "Loan", "sub_source": "Interest (Upcoming)",
                        "contact": name, "contact_id": loan.contact_id,
                        "amount": fut_int, "due_date": horizons["90d"].isoformat(),
                        "label": f"Interest from {name} (next 90d)",
                        "tier": 2, "confidence": "medium", "mode": "bank",
                    })
            if loan.expected_end_date and loan.expected_end_date <= horizons["90d"]:
                rem = _rem_principal(loan)
                if rem > 0:
                    is_past = loan.expected_end_date < today
                    all_items.append({
                        "direction": "inflow", "source": "Loan", "sub_source": "Principal Return",
                        "contact": name, "contact_id": loan.contact_id,
                        "amount": float(rem), "due_date": loan.expected_end_date.isoformat(),
                        "label": f"Principal from {name}",
                        "tier": 3, "confidence": "low", "mode": "bank",
                        **({"is_overdue": True} if is_past else {}),
                    })

        elif loan.loan_type == "short_term":
            rem = _rem_principal(loan)
            if rem <= 0:
                continue
            end = loan.expected_end_date or loan.interest_free_till
            if end and end <= horizons["90d"]:
                is_past = end < today
                all_items.append({
                    "direction": "inflow", "source": "Loan", "sub_source": "Short-term Return",
                    "contact": name, "contact_id": loan.contact_id,
                    "amount": float(rem), "due_date": end.isoformat(),
                    "label": f"Short-term return from {name}",
                    "tier": 2 if not is_past else 3,
                    "confidence": "high" if not is_past else "low",
                    "mode": "bank",
                    **({"is_overdue": True} if is_past else {}),
                })

    # Loan outflows — taken loans (our obligations — Tier 1)
    for loan in loans_taken:
        name = _contact(loan)
        if loan.loan_type == "emi":
            schedule = get_emi_schedule_with_payments(loan, db)
            next_added = False
            for entry in schedule:
                dd = entry["due_date"]
                if entry["status"] == "paid":
                    continue
                remaining = float(entry["outstanding"])
                if remaining <= 0:
                    continue
                if dd < today:
                    all_items.append({
                        "direction": "outflow", "source": "Loan", "sub_source": "EMI Payment",
                        "contact": name, "contact_id": loan.contact_id,
                        "amount": remaining, "due_date": dd.isoformat(),
                        "label": f"Overdue EMI to {name}",
                        "tier": 1, "confidence": "high", "mode": "bank", "is_overdue": True,
                    })
                elif not next_added and dd <= horizons["90d"]:
                    all_items.append({
                        "direction": "outflow", "source": "Loan", "sub_source": "EMI Payment",
                        "contact": name, "contact_id": loan.contact_id,
                        "amount": remaining, "due_date": dd.isoformat(),
                        "label": f"EMI to {name}",
                        "tier": 1, "confidence": "high", "mode": "bank",
                    })
                    next_added = True

        elif loan.loan_type == "interest_only":
            rate = _D(loan.interest_rate)
            if rate <= 0:
                continue
            outstanding = calculate_outstanding(loan.id, today, db)
            overdue = outstanding["interest_outstanding"]
            if overdue > Decimal("0"):
                all_items.append({
                    "direction": "outflow", "source": "Loan", "sub_source": "Interest Due",
                    "contact": name, "contact_id": loan.contact_id,
                    "amount": float(overdue.quantize(Decimal("0.01"))),
                    "due_date": None, "label": f"Overdue interest to {name}",
                    "tier": 1, "confidence": "high", "mode": "bank", "is_overdue": True,
                })
            days_90 = (horizons["90d"] - today).days
            fut_int = float(_calc_period_interest(
                _D(loan.principal_amount), rate, today, days_90,
            ).quantize(Decimal("0.01")))
            if fut_int > 0:
                all_items.append({
                    "direction": "outflow", "source": "Loan", "sub_source": "Interest (Upcoming)",
                    "contact": name, "contact_id": loan.contact_id,
                    "amount": fut_int, "due_date": horizons["90d"].isoformat(),
                    "label": f"Interest to {name} (next 90d)",
                    "tier": 1, "confidence": "high", "mode": "bank",
                })

    # Obligations
    obls = db.query(MoneyObligation).filter(
        MoneyObligation.is_deleted == False,
        MoneyObligation.status.in_(["pending", "partial"]),
    ).all()
    for obl in obls:
        remaining = _D(obl.amount) - _D(obl.amount_settled)
        if remaining <= Decimal("0"):
            continue
        c = db.query(Contact).filter(Contact.id == obl.contact_id).first() if obl.contact_id else None
        cname = c.name if c else "Unknown"
        is_overdue = obl.due_date and obl.due_date < today
        days_overdue = (today - obl.due_date).days if is_overdue else 0
        tier = 3 if days_overdue > 90 else (2 if obl.obligation_type == "receivable" else 1)
        src = obl.linked_type.capitalize() if obl.linked_type and obl.linked_type != "other" else "Obligation"

        all_items.append({
            "direction": "inflow" if obl.obligation_type == "receivable" else "outflow",
            "source": src, "sub_source": obl.obligation_type.capitalize(),
            "contact": cname, "contact_id": obl.contact_id,
            "amount": float(remaining),
            "due_date": obl.due_date.isoformat() if obl.due_date else None,
            "label": obl.reason or obl.obligation_type.capitalize(),
            "tier": tier,
            "confidence": "low" if days_overdue > 90 else ("medium" if obl.obligation_type == "receivable" else "high"),
            "mode": "cash",
            **({"is_overdue": True} if is_overdue else {}),
        })

    # Properties
    properties = db.query(PropertyDeal).filter(
        PropertyDeal.is_deleted == False,
        PropertyDeal.status.notin_(["settled", "cancelled"]),
    ).all()
    for prop in properties:
        buyer_val = _D(prop.total_buyer_value)
        if buyer_val <= 0:
            continue
        advance = _D(prop.advance_paid)
        net_profit = buyer_val - _D(prop.total_seller_value) - _D(prop.broker_commission) - _D(getattr(prop, "other_expenses", None) or 0)
        my_return = advance + net_profit
        if my_return > 0:
            all_items.append({
                "direction": "inflow", "source": "Property", "sub_source": "Deal Proceeds",
                "contact": prop.title, "contact_id": None,
                "amount": float(my_return), "due_date": None,
                "label": f"{prop.title}: Advance + Profit",
                "tier": 3, "confidence": "low", "mode": "bank",
            })

    # ── Aggregate by horizon ──
    def _horizon_summary(items_list, horizon_date):
        filtered = [i for i in items_list if not i.get("due_date") or i["due_date"] <= horizon_date.isoformat()]
        inflows = [i for i in filtered if i["direction"] == "inflow"]
        outflows = [i for i in filtered if i["direction"] == "outflow"]

        def _by_tier(lst, t):
            return sum(i["amount"] for i in lst if i["tier"] == t)

        def _by_source(lst):
            groups = defaultdict(float)
            for i in lst:
                groups[i["source"]] += i["amount"]
            return [{"source": k, "amount": round(v, 2)} for k, v in sorted(groups.items(), key=lambda x: -x[1])]

        def _by_mode(lst):
            modes = defaultdict(float)
            for i in lst:
                modes[i.get("mode", "bank")] += i["amount"]
            return {k: round(v, 2) for k, v in modes.items()}

        total_in = sum(i["amount"] for i in inflows)
        total_out = sum(i["amount"] for i in outflows)

        return {
            "total_inflow": round(total_in, 2),
            "total_outflow": round(total_out, 2),
            "net_flow": round(total_in - total_out, 2),
            "inflow_by_tier": {
                "t1": round(_by_tier(inflows, 1), 2),
                "t2": round(_by_tier(inflows, 2), 2),
                "t3": round(_by_tier(inflows, 3), 2),
            },
            "outflow_by_tier": {
                "t1": round(_by_tier(outflows, 1), 2),
                "t2": round(_by_tier(outflows, 2), 2),
                "t3": round(_by_tier(outflows, 3), 2),
            },
            "inflow_by_source": _by_source(inflows),
            "outflow_by_source": _by_source(outflows),
            "inflow_by_mode": _by_mode(inflows),
            "outflow_by_mode": _by_mode(outflows),
        }

    h15 = _horizon_summary(all_items, horizons["15d"])
    h30 = _horizon_summary(all_items, horizons["30d"])
    h90 = _horizon_summary(all_items, horizons["90d"])

    # Liquidity runway
    guaranteed_30d = h30["outflow_by_tier"]["t1"]
    daily_burn = guaranteed_30d / 30 if guaranteed_30d > 0 else Decimal("0")
    runway_months = float(total_liquid / Decimal(str(max(float(daily_burn) * 30, 1)))) if daily_burn > 0 else 99
    runway_ok = float(total_liquid) >= guaranteed_30d

    # Timeline: daily net flow for 90 days
    timeline = []
    running = float(total_liquid)
    day_map = defaultdict(lambda: {"inflow": 0.0, "outflow": 0.0})
    for item in all_items:
        d = item.get("due_date")
        if d and today.isoformat() <= d <= horizons["90d"].isoformat():
            if item["direction"] == "inflow":
                day_map[d]["inflow"] += item["amount"]
            else:
                day_map[d]["outflow"] += item["amount"]

    for i in range(91):
        day = today + timedelta(days=i)
        ds = day.isoformat()
        day_in = day_map[ds]["inflow"]
        day_out = day_map[ds]["outflow"]
        running += day_in - day_out
        if i % 3 == 0 or day_in > 0 or day_out > 0:
            timeline.append({
                "date": ds,
                "day_label": day.strftime("%d %b"),
                "inflow": round(day_in, 2),
                "outflow": round(day_out, 2),
                "net": round(day_in - day_out, 2),
                "running_balance": round(running, 2),
            })

    return {
        "as_of_date": today.isoformat(),
        "balances": {
            "cash": float(cash_balance),
            "bank": float(bank_balance),
            "total_liquid": float(total_liquid),
            "accounts": account_balances,
        },
        "liquidity_runway": {
            "ok": runway_ok,
            "liquid_balance": float(total_liquid),
            "guaranteed_30d_outflow": guaranteed_30d,
            "coverage_ratio": round(float(total_liquid) / max(guaranteed_30d, 0.01), 2),
            "runway_months": round(min(runway_months, 99), 1),
        },
        "horizons": {"15d": h15, "30d": h30, "90d": h90},
        "timeline": timeline,
        "items": sorted(all_items, key=lambda x: (
            0 if x.get("is_overdue") else 1,
            x["tier"],
            x.get("due_date") or "9999-12-31",
        )),
    }


# ── AI EXPENSE ANALYSIS ─────────────────────────────────────────────────────

# ── AI EXPENSE ANALYSIS ─────────────────────────────────────────────────────

@router.post("/ai-expense-analysis")
def ai_expense_analysis(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Analyse expenses using Gemini AI for rich insights.
    Falls back to heuristic engine if Gemini is unavailable.
    Payload: { "from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD" }
    """
    from fastapi import HTTPException as _HTTPExc
    from collections import defaultdict

    from_date_str = payload.get("from_date")
    to_date_str = payload.get("to_date")

    if not from_date_str or not to_date_str:
        raise _HTTPExc(status_code=400, detail="from_date and to_date are required")

    from_dt = date.fromisoformat(from_date_str)
    to_dt = date.fromisoformat(to_date_str)

    expenses = (
        db.query(Expense)
        .filter(Expense.expense_date >= from_dt, Expense.expense_date <= to_dt)
        .order_by(Expense.expense_date.asc())
        .all()
    )

    if not expenses:
        return {
            "status": "no_data",
            "message": "No expenses found in the selected date range.",
            "flags": [], "suggestions": [], "insights": [],
        }

    total = Decimal("0")
    by_cat = defaultdict(lambda: {"total": Decimal("0"), "count": 0, "items": []})
    by_month = defaultdict(lambda: Decimal("0"))
    largest = None

    for exp in expenses:
        amt = _D(exp.amount)
        total += amt
        cat = exp.category or "Uncategorized"
        by_cat[cat]["total"] += amt
        by_cat[cat]["count"] += 1
        by_cat[cat]["items"].append({
            "amount": float(amt), "date": exp.expense_date.isoformat(),
            "description": exp.description or "", "sub_category": exp.sub_category or "",
        })
        mk = exp.expense_date.strftime("%Y-%m")
        by_month[mk] += amt
        if largest is None or amt > _D(largest["amount"]):
            largest = {"amount": float(amt), "date": exp.expense_date.isoformat(),
                       "description": exp.description or "", "category": cat}

    num_expenses = len(expenses)
    avg_per_expense = total / max(num_expenses, 1)
    num_days = max((to_dt - from_dt).days, 1)
    daily_avg = total / num_days

    # ── Build heuristic flags and insights (always available) ──
    flags = []
    threshold_3x = float(avg_per_expense * 3)
    for exp in expenses:
        if float(_D(exp.amount)) > threshold_3x:
            flags.append({
                "type": "high_amount", "severity": "warning",
                "title": f"Unusually high expense: \u20b9{float(_D(exp.amount)):,.0f}",
                "detail": f"{exp.description or exp.category or 'Unknown'} on {exp.expense_date.isoformat()} \u2014 {float(_D(exp.amount) / avg_per_expense):.1f}x your average.",
            })

    for cat, data in by_cat.items():
        pct = float(data["total"] / total * 100) if total > 0 else 0
        if pct > 40 and data["count"] > 2:
            flags.append({
                "type": "concentration", "severity": "info",
                "title": f"High concentration in '{cat}' ({pct:.0f}%)",
                "detail": f"\u20b9{float(data['total']):,.0f} across {data['count']} transactions.",
            })

    uncat = by_cat.get("Uncategorized")
    if uncat and uncat["count"] > 0:
        flags.append({
            "type": "uncategorized", "severity": "info",
            "title": f"{uncat['count']} uncategorized expense(s)",
            "detail": f"\u20b9{float(uncat['total']):,.0f} is untagged.",
        })

    sorted_months = sorted(by_month.items())
    for i in range(1, len(sorted_months)):
        prev_amt = sorted_months[i - 1][1]
        curr_amt = sorted_months[i][1]
        if prev_amt > 0 and curr_amt > prev_amt * Decimal("1.5"):
            increase_pct = float((curr_amt - prev_amt) / prev_amt * 100)
            flags.append({
                "type": "spike", "severity": "warning",
                "title": f"Spending spike in {sorted_months[i][0]}",
                "detail": f"\u20b9{float(curr_amt):,.0f} vs \u20b9{float(prev_amt):,.0f} previous month (+{increase_pct:.0f}%).",
            })

    suggestions = []
    for cat, data in by_cat.items():
        items_no_sub = [i for i in data["items"] if not i["sub_category"]]
        if len(items_no_sub) > 2:
            suggestions.append({
                "category": cat,
                "suggestion": f"{len(items_no_sub)} items in '{cat}' lack sub-categories.",
            })

    heuristic_insights = []
    heuristic_insights.append({
        "icon": "\U0001f4ca", "title": "Spending Overview",
        "text": f"You spent \u20b9{float(total):,.0f} across {num_expenses} transactions over {num_days} days. That's \u20b9{float(daily_avg):,.0f}/day.",
    })
    if largest:
        heuristic_insights.append({
            "icon": "\U0001f4b8", "title": "Biggest Expense",
            "text": f"\u20b9{largest['amount']:,.0f} on {largest['date']} \u2014 {largest['description'] or largest['category']}.",
        })
    top_cats = sorted(by_cat.items(), key=lambda x: x[1]["total"], reverse=True)[:3]
    heuristic_insights.append({
        "icon": "\U0001f3f7\ufe0f", "title": "Top Categories",
        "text": ", ".join([f"{c} (\u20b9{float(d['total']):,.0f})" for c, d in top_cats]),
    })
    if len(sorted_months) >= 2:
        last_m = sorted_months[-1]
        prev_m = sorted_months[-2]
        diff = float(last_m[1] - prev_m[1])
        heuristic_insights.append({
            "icon": "\U0001f4c8" if diff > 0 else "\U0001f4c9",
            "title": "Monthly Trend",
            "text": f"Spending went {'up' if diff > 0 else 'down'} by \u20b9{abs(diff):,.0f} from {prev_m[0]} to {last_m[0]}.",
        })

    # ── Gemini AI analysis ──
    gemini_narrative = None
    ai_insights = []
    ai_pie_data = []
    try:
        from app.config import settings
        if settings.GEMINI_API_KEY:
            from google import genai as _genai
            import json as _json

            _client = _genai.Client(api_key=settings.GEMINI_API_KEY)

            top_cats_summary = "\n".join(
                f"- {cat}: \u20b9{float(d['total']):,.0f} ({d['count']} txns)"
                for cat, d in sorted(by_cat.items(), key=lambda x: x[1]["total"], reverse=True)[:8]
            )
            monthly_summary = "\n".join(
                f"- {m}: \u20b9{float(a):,.0f}" for m, a in sorted_months
            )
            prompt = (
                f"You are a personal financial advisor analyzing expense data for an Indian household.\n"
                f"Analyse the following spending data and give actionable insights in plain conversational Hindi-English (Hinglish is fine).\n\n"
                f"Period: {from_date_str} to {to_date_str}\n"
                f"Total Spent: \u20b9{float(total):,.0f} across {num_expenses} transactions ({num_days} days)\n"
                f"Daily Average: \u20b9{float(daily_avg):,.0f}\n\n"
                f"Top Spending Categories:\n{top_cats_summary}\n\n"
                f"Monthly Trend:\n{monthly_summary}\n\n"
                f"Respond with JSON only, format:\n"
                f'{{"insights": [{{"icon": "<emoji>", "title": "<short title>", "text": "<1-2 sentence insight>"}}], '
                f'"suggestions": [{{"category": "<cat>", "suggestion": "<actionable advice>"}}], '
                f'"narrative": "<2-3 sentence overall assessment in conversational tone>"}}\n\n'
                f"Give 4-5 insights and 2-3 suggestions. Be specific with numbers. Use \u20b9 symbol."
            )
            response = _client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            raw = (response.text or "").strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            parsed = _json.loads(raw.strip())
            ai_insights = parsed.get("insights", [])
            gemini_suggestions = parsed.get("suggestions", [])
            gemini_narrative = parsed.get("narrative", "")
            # Merge suggestions (AI ones are more useful)
            if gemini_suggestions:
                suggestions = gemini_suggestions

            # ── Second Gemini call: AI thematic pie chart from raw descriptions ──
            ai_pie_data = []
            try:
                sample_expenses = sorted(expenses, key=lambda e: _D(e.amount), reverse=True)[:60]
                desc_lines = "\n".join(
                    f"{e.description or 'Expense'} | ₹{float(_D(e.amount)):,.0f}"
                    for e in sample_expenses if e.description
                )[:3000]  # cap prompt size

                if desc_lines:
                    pie_prompt = (
                        "You are a creative financial lifestyle analyst.\n"
                        "Below are real expense descriptions with amounts from an Indian household.\n"
                        "Group them into 5-7 THEMATIC lifestyle categories that reveal spending patterns "
                        "(e.g., 'Weekend Social Life', 'Daily Fuel & Commute', 'Health & Wellness', "
                        "'Digital & Entertainment', 'Home & Family', 'Street Food & Snacks').\n"
                        "These themes should be DIFFERENT from standard accounting categories — they tell a STORY.\n"
                        "For each theme, estimate the total amount from the expenses listed.\n\n"
                        f"Expenses:\n{desc_lines}\n\n"
                        "Respond with JSON only:\n"
                        "{\"themes\": [{\"name\": \"<theme>\", \"amount\": <number>, \"count\": <n>, "
                        "\"insight\": \"<1 sentence observation about this lifestyle theme>\"}]}\n"
                        "Rules: amounts must sum close to the total of all listed expenses. "
                        "No explanation outside JSON."
                    )
                    pie_response = _client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=pie_prompt,
                    )
                    pie_raw = (pie_response.text or "").strip()
                    if pie_raw.startswith("```"):
                        pie_raw = pie_raw.split("```")[1]
                        if pie_raw.startswith("json"):
                            pie_raw = pie_raw[4:]
                    pie_parsed = _json.loads(pie_raw.strip())
                    ai_pie_data = pie_parsed.get("themes", [])
            except Exception:
                pass  # AI pie chart is optional — fail silently
    except Exception:
        pass  # fall through to heuristic insights

    insights = ai_insights if ai_insights else heuristic_insights

    return {
        "status": "ok",
        "analyzed_at": date.today().isoformat(),
        "period": {"from": from_date_str, "to": to_date_str},
        "summary": {
            "total": float(total),
            "count": num_expenses,
            "daily_avg": float(daily_avg.quantize(Decimal("0.01"))),
            "categories_used": len(by_cat),
        },
        "narrative": gemini_narrative,
        "flags": flags,
        "suggestions": suggestions,
        "insights": insights,
        "ai_powered": bool(gemini_narrative),
        "ai_pie_data": ai_pie_data,
    }


# ── RECONCILIATION & LEDGER ─────────────────────────────────────────────────

@router.get("/reconciliation")
def reconciliation_ledger(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Transaction ledger with reconciliation: running balance, unlinked items flagged.
    """
    today = date.today()
    start = date.fromisoformat(from_date) if from_date else today - timedelta(days=30)
    end = date.fromisoformat(to_date) if to_date else today

    accts = db.query(CashAccount).filter(CashAccount.is_deleted == False).all()
    acct_map = {a.id: a for a in accts}

    q = db.query(AccountTransaction).filter(
        AccountTransaction.txn_date >= start,
        AccountTransaction.txn_date <= end,
    )
    if account_id:
        q = q.filter(AccountTransaction.account_id == account_id)

    txns = q.order_by(AccountTransaction.txn_date.asc(), AccountTransaction.id.asc()).all()

    opening_balances = {}
    for acct in accts:
        if account_id and acct.id != account_id:
            continue
        running = _D(acct.opening_balance)
        for t in (acct.transactions or []):
            if t.txn_date < start:
                running += _D(t.amount) if t.txn_type == "credit" else -_D(t.amount)
        opening_balances[acct.id] = float(running)

    ledger = []
    running_map = dict(opening_balances)
    unlinked_count = 0
    total_credits = Decimal("0")
    total_debits = Decimal("0")

    for t in txns:
        amt = _D(t.amount)
        acct_name = acct_map[t.account_id].name if t.account_id in acct_map else "Unknown"
        prev_bal = running_map.get(t.account_id, 0.0)
        if t.txn_type == "credit":
            new_bal = prev_bal + float(amt)
            total_credits += amt
        else:
            new_bal = prev_bal - float(amt)
            total_debits += amt
        running_map[t.account_id] = new_bal

        is_unlinked = not t.linked_type or t.linked_type == "manual"
        if is_unlinked:
            unlinked_count += 1

        ledger.append({
            "id": t.id, "date": t.txn_date.isoformat(),
            "account": acct_name, "account_id": t.account_id,
            "type": t.txn_type, "amount": float(amt),
            "description": t.description or "", "source": t.linked_type or "unlinked",
            "linked_id": t.linked_id, "payment_mode": t.payment_mode or "",
            "reference": t.reference_number or "",
            "running_balance": round(new_bal, 2),
            "is_unlinked": is_unlinked,
        })

    # Reverse so newest transactions appear first; running_balance per row
    # still represents the balance at that point in chronological time.
    ledger.reverse()

    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "accounts": [{"id": a.id, "name": a.name, "type": a.account_type} for a in accts],
        "opening_balances": opening_balances,
        "closing_balances": running_map,
        "summary": {
            "total_credits": float(total_credits),
            "total_debits": float(total_debits),
            "net": float(total_credits - total_debits),
            "transaction_count": len(ledger),
            "unlinked_count": unlinked_count,
        },
        "ledger": ledger,
    }


# ── PROPERTY ANALYTICS — money flow per property/plot/partnership ───────────

# Inflows to "us" (the deal pot): money received from buyers / final sale.
_PROPERTY_INFLOW_TYPES = {"received_from_buyer", "sale_proceeds", "buyer_payment", "buyer_advance"}
# Outflows from "us": payments to seller, broker, other expenses, refunds.
_PROPERTY_OUTFLOW_TYPES = {
    "advance_to_seller", "payment_to_seller", "remaining_to_seller",
    "commission_paid", "broker_commission", "expense", "other_expense", "refund",
}


def _scope_label(kind: str, obj) -> str:
    if kind == "property":
        return f"Property: {obj.title}"
    if kind == "site_plot":
        return f"Plot #{obj.plot_number or obj.id}"
    if kind == "partnership":
        return f"Partnership: {obj.title}"
    return kind


def _member_label(m: PartnershipMember, contact_map: dict) -> str:
    if m.is_self:
        return "Self"
    c = contact_map.get(m.contact_id)
    if c:
        return c.name
    return f"Member #{m.id}"


def _empty_buckets():
    return {
        "to_receive_from_buyers": 0.0,
        "to_pay_to_seller": 0.0,
        "already_received": 0.0,
        "already_paid_out": 0.0,
        "projected_net_profit": 0.0,
        "projected_gross_profit": 0.0,
        "total_seller_value": 0.0,
        "total_buyer_value": 0.0,
        "broker_commission": 0.0,
        "other_expenses": 0.0,
        # Area metrics
        "total_land_area": 0.0,
        "sold_area": 0.0,
        "remaining_area": 0.0,
        # Capital metrics
        "partner_advances": 0.0,
        # Seller-payment breakdown
        "paid_to_seller": 0.0,
        "paid_to_seller_advance": 0.0,
        "paid_to_seller_additional": 0.0,
        # Set in _compute_property_buckets when applicable
        "registered_buyer_value": 0.0,
        "is_partial_projection": False,
    }


def _compute_property_buckets(deal: PropertyDeal, db: Session) -> dict:
    """Aggregate property-level money flow numbers from the deal + transactions + plot buyers."""
    b = _empty_buckets()

    seller_value = float(_D(deal.total_seller_value))
    buyer_value = float(_D(deal.total_buyer_value))
    broker = float(_D(deal.broker_commission))
    other_exp = float(_D(deal.other_expenses))

    # ── Aggregate paid-to-seller across BOTH PropertyTransactions and PartnershipTransactions
    # of any linked partnership. Earlier code only looked at PropertyTransactions, missing
    # additional payments partners made directly via the partnership ledger.
    deal_advance = float(_D(deal.advance_paid))
    advance_to_seller_txns = 0.0   # sum of "advance_to_seller" txns (across both tables)
    additional_to_seller = 0.0     # payment_to_seller + remaining_to_seller (across both tables)
    paid_broker = 0.0
    paid_expenses = 0.0
    received_from_buyer = 0.0      # buyer payments across both tables (deduplicated source)

    txns = (
        db.query(PropertyTransaction)
        .filter(PropertyTransaction.property_deal_id == deal.id)
        .all()
    )
    has_property_buyer_txns = False
    for t in txns:
        amt = float(_D(t.amount))
        ty = t.txn_type or ""
        if ty == "advance_to_seller":
            advance_to_seller_txns += amt
        elif ty in ("payment_to_seller", "remaining_to_seller"):
            additional_to_seller += amt
        elif ty in ("commission_paid", "broker_commission"):
            paid_broker += amt
        elif ty in ("expense", "other_expense", "refund"):
            paid_expenses += amt
        elif ty in ("received_from_buyer", "sale_proceeds", "buyer_payment", "buyer_advance"):
            received_from_buyer += amt
            has_property_buyer_txns = True

    # Pull from linked partnerships' transaction ledger
    linked_partnerships_for_buckets = db.query(Partnership).filter(
        Partnership.linked_property_deal_id == deal.id,
        Partnership.is_deleted == False,
    ).all()
    p_buyer_received = 0.0
    for lp in linked_partnerships_for_buckets:
        for t in db.query(PartnershipTransaction).filter(
            PartnershipTransaction.partnership_id == lp.id
        ).all():
            amt = float(_D(t.amount))
            ty = t.txn_type or ""
            if ty == "advance_to_seller":
                advance_to_seller_txns += amt
            elif ty in ("payment_to_seller", "remaining_to_seller"):
                additional_to_seller += amt
            elif ty in ("broker_commission", "broker_paid"):
                paid_broker += amt
            elif ty in ("expense", "other_expense"):
                paid_expenses += amt
            elif ty in ("buyer_advance", "buyer_payment", "buyer_payment_received"):
                p_buyer_received += amt

    # Buyer receipts: prefer property-level numbers when present (they're the canonical record).
    # Otherwise fall back to partnership-level buyer payments to avoid undercounting.
    if not has_property_buyer_txns and p_buyer_received > 0:
        received_from_buyer = p_buyer_received

    # Resolve advance vs additional split.
    # If deal.advance_paid is set, it represents the initial token; treat any extra
    # advance_to_seller transactions as additional payments.
    if deal_advance > 0:
        advance_to_seller = deal_advance
        additional_to_seller += max(0.0, advance_to_seller_txns - deal_advance)
    else:
        advance_to_seller = advance_to_seller_txns

    paid_to_seller = advance_to_seller + additional_to_seller
    paid_out = paid_to_seller + paid_broker + paid_expenses
    received_in = received_from_buyer

    # Final fallback for legacy data with no transactions at all
    if not txns and p_buyer_received == 0:
        linked_p = linked_partnerships_for_buckets[0] if linked_partnerships_for_buckets else None
        if linked_p:
            received_in = float(_D(linked_p.total_received))
            received_from_buyer = received_in

    # Outstanding from buyers: prefer plot_buyers if present, else fall back to deal-level totals
    plot_buyers = (
        db.query(PlotBuyer)
        .filter(PlotBuyer.property_deal_id == deal.id)
        .all()
    )
    site_plots = (
        db.query(SitePlot)
        .filter(SitePlot.property_deal_id == deal.id)
        .all()
    )
    sold_area = 0.0
    if plot_buyers or site_plots:
        outstanding_buyers = 0.0
        registered_buyer_value = 0.0
        for pb in plot_buyers:
            tv = float(_D(pb.total_value))
            paid = float(_D(pb.total_paid))
            outstanding_buyers += max(0.0, tv - paid)
            registered_buyer_value += tv
            sold_area += float(_D(pb.area_sqft))
        for sp in site_plots:
            tv = float(_D(sp.calculated_price))
            paid = float(_D(sp.total_paid))
            outstanding_buyers += max(0.0, tv - paid)
            registered_buyer_value += tv
            # A site_plot only counts as "sold" when it has a buyer assigned
            if sp.buyer_contact_id or (sp.buyer_name and sp.buyer_name.strip()):
                sold_area += float(_D(sp.area_sqft))
        b["to_receive_from_buyers"] = round(outstanding_buyers, 2)
        effective_buyer_value = max(buyer_value, registered_buyer_value)
        b["registered_buyer_value"] = round(registered_buyer_value, 2)
        b["is_partial_projection"] = registered_buyer_value < (seller_value * 0.95)
    else:
        b["to_receive_from_buyers"] = round(max(0.0, buyer_value - received_from_buyer), 2)
        effective_buyer_value = buyer_value
        b["registered_buyer_value"] = round(buyer_value, 2)
        b["is_partial_projection"] = False

    total_land_area = float(_D(deal.total_area_sqft))
    b["total_land_area"] = round(total_land_area, 2)
    b["sold_area"] = round(min(sold_area, total_land_area) if total_land_area else sold_area, 2)
    b["remaining_area"] = round(max(0.0, total_land_area - sold_area), 2)

    b["paid_to_seller"] = round(paid_to_seller, 2)
    b["paid_to_seller_advance"] = round(advance_to_seller, 2)
    b["paid_to_seller_additional"] = round(additional_to_seller, 2)
    b["to_pay_to_seller"] = round(max(0.0, seller_value - paid_to_seller), 2)
    b["already_paid_out"] = round(paid_out, 2)
    b["already_received"] = round(received_in, 2)
    b["total_seller_value"] = round(seller_value, 2)
    b["total_buyer_value"] = round(effective_buyer_value, 2)
    b["broker_commission"] = round(broker, 2)
    b["other_expenses"] = round(other_exp, 2)
    b["projected_gross_profit"] = round(effective_buyer_value - seller_value, 2)
    b["projected_net_profit"] = round(effective_buyer_value - seller_value - broker - other_exp, 2)
    return b


def _compute_partnership_member_breakdown(
    p: Partnership, db: Session, contact_map: dict, projected_net_profit: float = 0.0
) -> List[dict]:
    """
    For each member compute a clean money-flow picture:
      own_invested          — advance_contributed only (capital they put in as their share)
      collected_from_buyers — buyer payments received by them (pot money, not their own)
      all_paid_out          — seller payments & expenses they made from collected / own cash
                              NOTE: "invested" txn type is NOT counted here (double-count with
                              advance_contributed).
      net_holding           — collected_from_buyers - all_paid_out (positive = sitting on pot cash)
      transferred_in/out    — partner_transfer flows (internal rebalancing between members)
      projected_share       — their % of projected_net_profit
      settlement_balance    — what they will still receive (or owe) at full settlement
    """
    members = (
        db.query(PartnershipMember)
        .filter(PartnershipMember.partnership_id == p.id)
        .all()
    )
    p_txns = (
        db.query(PartnershipTransaction)
        .filter(PartnershipTransaction.partnership_id == p.id)
        .all()
    )

    # Property-level inflows credited to specific members (legacy data path)
    member_ids = [m.id for m in members]
    prop_txns_for_members = []
    if member_ids and p.linked_property_deal_id:
        prop_txns_for_members = (
            db.query(PropertyTransaction)
            .filter(
                PropertyTransaction.property_deal_id == p.linked_property_deal_id,
                PropertyTransaction.received_by_member_id.in_(member_ids),
            )
            .all()
        )

    breakdown = []
    for m in members:
        share_pct = float(_D(m.share_percentage))

        # Capital they put in as their advance share (the only "investment" amount we trust;
        # legacy "invested" / "advance_given" txns are NOT added here to avoid double-counting).
        own_invested = float(_D(m.advance_contributed))

        # Buyer money received by this member (pot money sitting with them)
        collected_from_buyers = 0.0
        # Money they paid TO the property seller (only)
        paid_to_seller_by_member = 0.0
        # Property-related expenses paid by this partner out of project funds
        expenses_paid = 0.0
        # Other pot outflows (broker fees, misc) — kept for legacy/back-compat
        other_paid_out = 0.0
        # Partner-to-partner transfers
        transferred_out = 0.0
        transferred_in = 0.0

        for t in p_txns:
            amt = float(_D(t.amount))
            ty = t.txn_type or ""

            if t.member_id == m.id:
                if ty in ("advance_to_seller", "remaining_to_seller", "payment_to_seller"):
                    paid_to_seller_by_member += amt
                elif ty in ("expense", "other_expense"):
                    # Expenses are tracked separately so they appear in Current Holding
                    expenses_paid += amt
                elif ty in ("broker_commission", "broker_paid"):
                    other_paid_out += amt
                # NOTE: "invested" and "advance_given" intentionally excluded — they represent
                # the same capital that's already captured in advance_contributed; counting them
                # here causes the "Net Outflow doubling" bug.
                elif ty in ("buyer_advance", "buyer_payment", "buyer_payment_received"):
                    collected_from_buyers += amt
                elif ty == "partner_transfer":
                    transferred_out += amt

            if t.received_by_member_id == m.id:
                if ty in ("buyer_advance", "buyer_payment", "buyer_payment_received"):
                    collected_from_buyers += amt
                elif ty == "partner_transfer":
                    transferred_in += amt

        for t in prop_txns_for_members:
            if t.received_by_member_id != m.id:
                continue
            ty = t.txn_type or ""
            amt = float(_D(t.amount))
            if ty in ("received_from_buyer", "sale_proceeds", "buyer_payment", "buyer_advance"):
                collected_from_buyers += amt

        # For the "self" member: also count property-level Expense records linked to the deal.
        # These expenses are recorded in the expenses table (not as PartnershipTransactions)
        # and are always attributed to the self user who paid them.
        if m.is_self and p.linked_property_deal_id:
            prop_expenses_total = (
                db.query(sa_func.coalesce(sa_func.sum(Expense.amount), 0))
                .filter(
                    Expense.linked_type == "property",
                    Expense.linked_id == p.linked_property_deal_id,
                )
                .scalar()
            )
            expenses_paid += float(_D(prop_expenses_total))

        # Total outflows they personally moved (seller + expenses + broker).
        all_paid_out = paid_to_seller_by_member + expenses_paid + other_paid_out

        # Current Holding (per spec):
        #   = (Collected from Buyers + Transferred IN)
        #     − (Sent to Seller + Transferred OUT + Expenses Paid)
        current_holding = round(
            collected_from_buyers + transferred_in
            - transferred_out - paid_to_seller_by_member - expenses_paid,
            2,
        )

        # Legacy "net_holding" = collected − all_paid_out (kept for back-compat fields)
        net_holding = round(collected_from_buyers - all_paid_out, 2)

        projected_share = round(projected_net_profit * share_pct / 100.0, 2)
        settlement_balance = round(projected_share - current_holding, 2)

        if current_holding > 1e-2:
            holding_status = "holding_pot_money"
        elif own_invested > (collected_from_buyers + transferred_in) + 1e-2:
            holding_status = "pot_owes_them"
        else:
            holding_status = "balanced"

        breakdown.append({
            "member_id": m.id,
            "name": _member_label(m, contact_map),
            "is_self": bool(m.is_self),
            "share_percentage": share_pct,
            "own_invested": round(own_invested, 2),
            "collected_from_buyers": round(collected_from_buyers, 2),
            "paid_to_seller": round(paid_to_seller_by_member, 2),
            "expenses_paid": round(expenses_paid, 2),
            "other_paid_out": round(other_paid_out, 2),
            "all_paid_out": round(all_paid_out, 2),
            "current_holding": current_holding,
            "net_holding": net_holding,
            "transferred_out": round(transferred_out, 2),
            "transferred_in": round(transferred_in, 2),
            "projected_share": projected_share,
            "settlement_balance": settlement_balance,
            # Legacy aliases for back-compat
            "contributed": round(own_invested, 2),
            "advance_contributed": round(own_invested, 2),
            "paid_for_pot": round(all_paid_out, 2),
            "received_out": round(transferred_in, 2),
            "collected_for_pot": round(collected_from_buyers, 2),
            "currently_holding": current_holding,
            "final_settlement": settlement_balance,
            "status": holding_status,
        })

    return breakdown


def _txns_for_buyer(deal_id: int, plot_buyer_id: Optional[int], site_plot_id: Optional[int],
                    db: Session, member_map: dict) -> List[dict]:
    """Return chronological transactions tied to a specific buyer (plot_buyer or site_plot)."""
    rows = []
    if plot_buyer_id:
        for t in (
            db.query(PropertyTransaction)
            .filter(
                PropertyTransaction.property_deal_id == deal_id,
                PropertyTransaction.plot_buyer_id == plot_buyer_id,
            )
            .all()
        ):
            rows.append({
                "date": t.txn_date.isoformat() if t.txn_date else None,
                "type": t.txn_type,
                "amount": float(_D(t.amount)),
                "description": t.description,
                "received_by": member_map.get(t.received_by_member_id) if t.received_by_member_id else None,
                "payment_mode": t.payment_mode,
            })
        for t in (
            db.query(PartnershipTransaction)
            .filter(PartnershipTransaction.plot_buyer_id == plot_buyer_id)
            .all()
        ):
            rows.append({
                "date": t.txn_date.isoformat() if t.txn_date else None,
                "type": t.txn_type,
                "amount": float(_D(t.amount)),
                "description": t.description,
                "received_by": member_map.get(t.received_by_member_id) if t.received_by_member_id else None,
                "from_member": member_map.get(t.member_id) if t.member_id else None,
                "payment_mode": t.payment_mode,
            })
    if site_plot_id:
        for t in (
            db.query(PartnershipTransaction)
            .filter(PartnershipTransaction.site_plot_id == site_plot_id)
            .all()
        ):
            rows.append({
                "date": t.txn_date.isoformat() if t.txn_date else None,
                "type": t.txn_type,
                "amount": float(_D(t.amount)),
                "description": t.description,
                "received_by": member_map.get(t.received_by_member_id) if t.received_by_member_id else None,
                "from_member": member_map.get(t.member_id) if t.member_id else None,
                "payment_mode": t.payment_mode,
            })
    rows.sort(key=lambda r: r["date"] or "", reverse=True)
    return rows


def _events_for_member(member_id: int, partnership_id: int, deal_id: Optional[int],
                       db: Session, member_map: dict,
                       event_limit: int = 10) -> dict:
    """
    Build a member-centric event log with pagination.
    Returns {items: [...], total: int, has_more: bool}.
    Covers:
      - Advances given (advance_to_seller / remaining_to_seller / etc by them)
      - Buyer payments they received
      - Partner transfers in/out
      - Property-level inflows credited to them
    """
    events = []
    p_txns = (
        db.query(PartnershipTransaction)
        .filter(PartnershipTransaction.partnership_id == partnership_id)
        .filter(
            (PartnershipTransaction.member_id == member_id)
            | (PartnershipTransaction.received_by_member_id == member_id)
        )
        .all()
    )
    for t in p_txns:
        ty = t.txn_type or ""
        amt = float(_D(t.amount))
        is_payer = (t.member_id == member_id)
        is_receiver = (t.received_by_member_id == member_id)

        if ty in ("advance_to_seller", "remaining_to_seller", "advance_given") and is_payer:
            kind, direction = "paid_to_seller", "out"
        elif ty in ("broker_commission", "broker_paid") and is_payer:
            kind, direction = "paid_broker", "out"
        elif ty in ("expense", "other_expense") and is_payer:
            kind, direction = "paid_expense", "out"
        elif ty in ("buyer_advance", "buyer_payment", "buyer_payment_received") and (is_receiver or is_payer):
            kind, direction = "received_from_buyer", "in"
        elif ty == "partner_transfer" and is_receiver:
            kind, direction = "transfer_in", "in"
        elif ty == "partner_transfer" and is_payer:
            kind, direction = "transfer_out", "out"
        elif ty == "invested" and is_payer:
            kind, direction = "advance_given", "out"
        else:
            continue

        if is_payer and t.received_by_member_id:
            counterparty = member_map.get(t.received_by_member_id)
        elif is_receiver and t.member_id:
            counterparty = member_map.get(t.member_id)
        else:
            counterparty = None

        events.append({
            "date": t.txn_date.isoformat() if t.txn_date else None,
            "kind": kind,
            "type": ty,
            "amount": amt,
            "direction": direction,
            "description": t.description,
            "counterparty": counterparty,
            "payment_mode": t.payment_mode,
        })

    if deal_id:
        for t in (
            db.query(PropertyTransaction)
            .filter(
                PropertyTransaction.property_deal_id == deal_id,
                PropertyTransaction.received_by_member_id == member_id,
            )
            .all()
        ):
            ty = t.txn_type or ""
            if ty in ("received_from_buyer", "sale_proceeds", "buyer_payment", "buyer_advance"):
                events.append({
                    "date": t.txn_date.isoformat() if t.txn_date else None,
                    "kind": "received_from_buyer",
                    "type": ty,
                    "amount": float(_D(t.amount)),
                    "direction": "in",
                    "description": t.description,
                    "counterparty": None,
                    "payment_mode": t.payment_mode,
                })

    events.sort(key=lambda r: r["date"] or "", reverse=True)
    total = len(events)
    has_more = total > event_limit
    return {"items": events[:event_limit], "total": total, "has_more": has_more}


def _build_timeline_for_property(deal_id: int, db: Session, contact_map: dict, member_map: dict, source_label: str = "") -> List[dict]:
    rows = []
    for t in db.query(PropertyTransaction).filter(PropertyTransaction.property_deal_id == deal_id).all():
        rows.append({
            "date": t.txn_date.isoformat() if t.txn_date else None,
            "type": t.txn_type,
            "amount": float(_D(t.amount)),
            "description": t.description,
            "scope": "property",
            "source_label": source_label,
            "received_by": member_map.get(t.received_by_member_id) if t.received_by_member_id else None,
            "payment_mode": t.payment_mode,
        })
    return rows


def _build_timeline_for_partnership(p_id: int, db: Session, member_map: dict, source_label: str = "") -> List[dict]:
    rows = []
    for t in db.query(PartnershipTransaction).filter(PartnershipTransaction.partnership_id == p_id).all():
        rows.append({
            "date": t.txn_date.isoformat() if t.txn_date else None,
            "type": t.txn_type,
            "amount": float(_D(t.amount)),
            "description": t.description,
            "scope": "partnership",
            "source_label": source_label,
            "from_member": member_map.get(t.member_id) if t.member_id else None,
            "received_by": member_map.get(t.received_by_member_id) if t.received_by_member_id else None,
            "from_partnership_pot": bool(t.from_partnership_pot),
            "payment_mode": t.payment_mode,
        })
    return rows


@router.get("/property")
def property_analytics(
    property_ids: Optional[List[int]] = Query(None),
    site_plot_ids: Optional[List[int]] = Query(None),
    partnership_ids: Optional[List[int]] = Query(None),
    scope: Optional[str] = Query(None),  # "all" → aggregate everything; otherwise honor filters
    event_limit: int = Query(10, ge=1, le=200),  # events per member (pagination)
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Property-focused money-flow analytics.

    Returns one block per selected scope (property / site_plot / partnership) plus a
    combined aggregate. Each block surfaces:
      - Six money-flow buckets (to_receive_from_buyers, to_pay_to_seller, already_received,
        already_paid_out, projected_gross_profit, projected_net_profit)
      - Per-member breakdown (own contribution, received, currently holding, projected share,
        final settlement after full settlement)
      - Transaction timeline scoped to that block
    """
    property_ids = property_ids or []
    site_plot_ids = site_plot_ids or []
    partnership_ids = partnership_ids or []

    # Resolve "all" → load every active property + partnership
    if scope == "all" and not (property_ids or site_plot_ids or partnership_ids):
        property_ids = [
            p.id for p in db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False).all()
        ]
        partnership_ids = [
            p.id for p in db.query(Partnership).filter(Partnership.is_deleted == False).all()
        ]

    # Pre-load contacts for member labelling
    contacts = db.query(Contact).all()
    contact_map = {c.id: c for c in contacts}

    blocks = []
    # Track which partnership IDs are already processed via a linked property block,
    # so we don't double-count them when partnership_ids also lists them.
    already_processed_partnership_ids: set = set()

    # ── PROPERTY scopes ─────────────────────────────────────────────────────
    for pid in property_ids:
        deal = db.query(PropertyDeal).filter(PropertyDeal.id == pid).first()
        if not deal:
            continue
        buckets = _compute_property_buckets(deal, db)

        # Find any partnerships linked to this deal (for member breakdown)
        linked_partnerships = (
            db.query(Partnership)
            .filter(
                Partnership.linked_property_deal_id == deal.id,
                Partnership.is_deleted == False,
            )
            .all()
        )
        member_map = {}
        partner_advances_total = 0.0
        # Track member context (which partnership each member belongs to) so we can
        # build their events later.
        member_context = []  # [(member_id, partnership_id)]
        for lp in linked_partnerships:
            for m in db.query(PartnershipMember).filter(PartnershipMember.partnership_id == lp.id).all():
                member_map[m.id] = _member_label(m, contact_map)
                partner_advances_total += float(_D(m.advance_contributed))
                member_context.append((m.id, lp.id))
            already_processed_partnership_ids.add(lp.id)

        members_breakdown = []
        for lp in linked_partnerships:
            for row in _compute_partnership_member_breakdown(
                lp, db, contact_map, projected_net_profit=buckets["projected_net_profit"]
            ):
                row["partnership_id"] = lp.id
                row["partnership_title"] = lp.title
                # Attach this member's personal event log
                row["events"] = _events_for_member(
                    row["member_id"], lp.id, deal.id, db, member_map,
                    event_limit=event_limit,
                )
                members_breakdown.append(row)

        buckets["partner_advances"] = round(partner_advances_total, 2)

        # Plot-buyer summaries with per-buyer transactions attached
        plot_buyers = db.query(PlotBuyer).filter(PlotBuyer.property_deal_id == deal.id).all()
        site_plots = db.query(SitePlot).filter(SitePlot.property_deal_id == deal.id).all()
        buyer_rows = []
        for pb in plot_buyers:
            tv = float(_D(pb.total_value))
            paid = float(_D(pb.total_paid))
            buyer_rows.append({
                "kind": "plot_buyer",
                "id": pb.id,
                "name": (contact_map.get(pb.buyer_contact_id).name if pb.buyer_contact_id and contact_map.get(pb.buyer_contact_id) else pb.buyer_name) or "Unknown",
                "area_sqft": round(float(_D(pb.area_sqft)), 2),
                "rate_per_sqft": round(float(_D(pb.rate_per_sqft)), 3),
                "total_value": round(tv, 2),
                "paid": round(paid, 2),
                "outstanding": round(max(0.0, tv - paid), 2),
                "status": pb.status,
                "transactions": _txns_for_buyer(deal.id, pb.id, None, db, member_map),
            })
        for sp in site_plots:
            tv = float(_D(sp.calculated_price))
            paid = float(_D(sp.total_paid))
            buyer_rows.append({
                "kind": "site_plot",
                "id": sp.id,
                "name": (contact_map.get(sp.buyer_contact_id).name if sp.buyer_contact_id and contact_map.get(sp.buyer_contact_id) else sp.buyer_name) or f"Plot {sp.plot_number}",
                "area_sqft": round(float(_D(sp.area_sqft)), 2),
                "rate_per_sqft": round(float(_D(sp.sold_price_per_sqft)), 3),
                "total_value": round(tv, 2),
                "paid": round(paid, 2),
                "outstanding": round(max(0.0, tv - paid), 2),
                "status": sp.status,
                "transactions": _txns_for_buyer(deal.id, None, sp.id, db, member_map),
            })

        seller_name = contact_map.get(deal.seller_contact_id).name if deal.seller_contact_id and contact_map.get(deal.seller_contact_id) else None

        # Collect ALL seller-payment transactions for this property (not subject to event_limit
        # pagination) so the seller history always includes the initial advance/token payment.
        _seller_txn_types = ["advance_to_seller", "remaining_to_seller", "payment_to_seller"]
        seller_txns: list = []
        for lp in linked_partnerships:
            for t in (
                db.query(PartnershipTransaction)
                .filter(
                    PartnershipTransaction.partnership_id == lp.id,
                    PartnershipTransaction.txn_type.in_(_seller_txn_types),
                )
                .all()
            ):
                seller_txns.append({
                    "date": t.txn_date.isoformat() if t.txn_date else None,
                    "amount": float(_D(t.amount)),
                    "type": t.txn_type,
                    "payment_mode": t.payment_mode,
                    "description": t.description,
                    "from_member": member_map.get(t.member_id) if t.member_id else None,
                })
        for t in (
            db.query(PropertyTransaction)
            .filter(
                PropertyTransaction.property_deal_id == deal.id,
                PropertyTransaction.txn_type.in_(_seller_txn_types),
            )
            .all()
        ):
            seller_txns.append({
                "date": t.txn_date.isoformat() if t.txn_date else None,
                "amount": float(_D(t.amount)),
                "type": t.txn_type,
                "payment_mode": t.payment_mode,
                "description": t.description,
                "from_member": None,
            })
        seller_txns.sort(key=lambda x: x.get("date") or "", reverse=True)

        blocks.append({
            "kind": "property",
            "id": deal.id,
            "label": _scope_label("property", deal),
            "title": deal.title,
            "status": deal.status,
            "seller_name": seller_name,
            "buckets": buckets,
            "buyers": buyer_rows,
            "members": members_breakdown,
            "linked_partnership_ids": [lp.id for lp in linked_partnerships],
            "seller_transactions": seller_txns,
        })

    # ── SITE PLOT scopes ────────────────────────────────────────────────────
    for sp_id in site_plot_ids:
        sp = db.query(SitePlot).filter(SitePlot.id == sp_id).first()
        if not sp:
            continue
        deal = db.query(PropertyDeal).filter(PropertyDeal.id == sp.property_deal_id).first()
        tv = float(_D(sp.calculated_price))
        paid = float(_D(sp.total_paid))

        # Allocate seller-side proportional to plot area
        seller_share = 0.0
        broker_share = 0.0
        other_share = 0.0
        if deal:
            total_area = float(_D(deal.total_area_sqft)) or 1.0
            plot_area = float(_D(sp.area_sqft))
            ratio = (plot_area / total_area) if total_area else 0.0
            seller_share = float(_D(deal.total_seller_value)) * ratio
            broker_share = float(_D(deal.broker_commission)) * ratio
            other_share = float(_D(deal.other_expenses)) * ratio

        net_profit = round(tv - seller_share - broker_share - other_share, 2)
        buckets = {
            "to_receive_from_buyers": round(max(0.0, tv - paid), 2),
            "to_pay_to_seller": round(seller_share, 2),
            "already_received": round(paid, 2),
            "already_paid_out": 0.0,
            "projected_net_profit": net_profit,
            "projected_gross_profit": round(tv - seller_share, 2),
            "total_buyer_value": round(tv, 2),
            "total_seller_value": round(seller_share, 2),
            "broker_commission": round(broker_share, 2),
            "other_expenses": round(other_share, 2),
        }

        blocks.append({
            "kind": "site_plot",
            "id": sp.id,
            "label": _scope_label("site_plot", sp),
            "title": f"Plot {sp.plot_number} — {deal.title if deal else ''}",
            "status": sp.status,
            "buyer_name": (contact_map.get(sp.buyer_contact_id).name if sp.buyer_contact_id and contact_map.get(sp.buyer_contact_id) else sp.buyer_name) or "Unallocated",
            "buckets": buckets,
            "members": [],
            "timeline": [],
            "buyers": [{
                "kind": "site_plot",
                "id": sp.id,
                "name": (contact_map.get(sp.buyer_contact_id).name if sp.buyer_contact_id and contact_map.get(sp.buyer_contact_id) else sp.buyer_name) or "Unallocated",
                "total_value": round(tv, 2),
                "paid": round(paid, 2),
                "outstanding": round(max(0.0, tv - paid), 2),
                "status": sp.status,
            }],
            "property_deal_id": sp.property_deal_id,
        })

    # ── PARTNERSHIP scopes ─────────────────────────────────────────────────
    for pp_id in partnership_ids:
        if pp_id in already_processed_partnership_ids:
            continue  # already counted via its linked property block — avoid double-counting
        p = db.query(Partnership).filter(Partnership.id == pp_id).first()
        if not p:
            continue
        member_map = {}
        for m in db.query(PartnershipMember).filter(PartnershipMember.partnership_id == p.id).all():
            member_map[m.id] = _member_label(m, contact_map)

        # Buckets: borrow from linked property deal, else build from partnership-only data.
        if p.linked_property_deal_id:
            deal = db.query(PropertyDeal).filter(PropertyDeal.id == p.linked_property_deal_id).first()
            if deal:
                buckets = _compute_property_buckets(deal, db)
            else:
                buckets = _empty_buckets()
        else:
            buckets = _empty_buckets()

        if not p.linked_property_deal_id:
            buckets["total_buyer_value"] = float(_D(p.total_deal_value))
            buckets["total_seller_value"] = float(_D(p.our_investment))
            buckets["projected_gross_profit"] = round(buckets["total_buyer_value"] - buckets["total_seller_value"], 2)
            buckets["projected_net_profit"] = buckets["projected_gross_profit"]

        partner_advances_total = 0.0
        for m in db.query(PartnershipMember).filter(PartnershipMember.partnership_id == p.id).all():
            partner_advances_total += float(_D(m.advance_contributed))
        buckets["partner_advances"] = round(partner_advances_total, 2)

        members_breakdown = _compute_partnership_member_breakdown(
            p, db, contact_map, projected_net_profit=buckets["projected_net_profit"]
        )
        for row in members_breakdown:
            row["events"] = _events_for_member(
                row["member_id"], p.id, p.linked_property_deal_id, db, member_map,
                event_limit=event_limit,
            )

        blocks.append({
            "kind": "partnership",
            "id": p.id,
            "label": _scope_label("partnership", p),
            "title": p.title,
            "status": p.status,
            "linked_property_deal_id": p.linked_property_deal_id,
            "buckets": buckets,
            "members": members_breakdown,
            "buyers": [],
        })

    # ── COMBINED aggregate across blocks ────────────────────────────────────
    combined_buckets = _empty_buckets()
    for blk in blocks:
        for k, v in combined_buckets.items():
            blk_v = blk["buckets"].get(k, 0.0)
            if isinstance(v, bool) or isinstance(blk_v, bool):
                combined_buckets[k] = bool(v) or bool(blk_v)
            else:
                combined_buckets[k] = round(v + (blk_v or 0.0), 2)

    # Combine member positions across all blocks by (name, is_self).
    combined_members = {}
    for blk in blocks:
        for row in blk.get("members", []):
            key = (row["name"], row["is_self"])
            agg = combined_members.setdefault(key, {
                "name": row["name"],
                "is_self": row["is_self"],
                "own_invested": 0.0,
                "collected_from_buyers": 0.0,
                "paid_to_seller": 0.0,
                "expenses_paid": 0.0,
                "other_paid_out": 0.0,
                "all_paid_out": 0.0,
                "net_holding": 0.0,
                "current_holding": 0.0,
                "transferred_out": 0.0,
                "transferred_in": 0.0,
                # Legacy aliases
                "contributed": 0.0,
                "received_out": 0.0,
                "collected_for_pot": 0.0,
                "currently_holding": 0.0,
                "projected_share": 0.0,
                "final_settlement": 0.0,
            })
            for fld in ("own_invested", "collected_from_buyers", "paid_to_seller", "expenses_paid",
                        "other_paid_out", "all_paid_out", "net_holding", "current_holding",
                        "transferred_out", "transferred_in", "contributed", "received_out",
                        "collected_for_pot", "currently_holding", "projected_share", "final_settlement"):
                agg[fld] = agg[fld] + row.get(fld, 0.0)

    combined_members_list = [
        {**v, **{k2: round(v[k2], 2) for k2 in v if isinstance(v[k2], float)}}
        for v in combined_members.values()
    ]
    combined_members_list.sort(key=lambda r: (not r["is_self"], -r.get("collected_from_buyers", 0)))

    # Plain-English sentence for the page header
    summary_sentence = _build_summary_sentence(combined_buckets, combined_members_list)

    # ── SERVER-SIDE seller aggregation (grouped by seller_name) ─────────────
    # Aggregates financial metrics per seller across all selected blocks so the
    # frontend never has to re-compute this.
    _seller_agg: dict = {}
    for blk in blocks:
        raw_name = blk.get("seller_name") or "Unknown Seller"
        key = raw_name.strip().lower()
        if key not in _seller_agg:
            _seller_agg[key] = {
                "name": raw_name,
                "advance_received": 0.0,
                "remaining_received": 0.0,
                "pending_balance": 0.0,
                "total_value": 0.0,
                "property_titles": [],
                "seller_events": [],
            }
        s = _seller_agg[key]
        b = blk.get("buckets") or {}
        s["advance_received"]   = round(s["advance_received"]   + (b.get("paid_to_seller_advance")    or 0.0), 2)
        s["remaining_received"] = round(s["remaining_received"] + (b.get("paid_to_seller_additional") or 0.0), 2)
        s["pending_balance"]    = round(s["pending_balance"]    + (b.get("to_pay_to_seller")          or 0.0), 2)
        s["total_value"]        = round(s["total_value"]        + (b.get("total_seller_value")        or 0.0), 2)
        if blk.get("title"):
            s["property_titles"].append(blk["title"])
        for txn in blk.get("seller_transactions") or []:
            s["seller_events"].append({**txn, "property": blk.get("title")})
    for s in _seller_agg.values():
        s["seller_events"].sort(key=lambda x: x.get("date") or "", reverse=True)
    combined_sellers_list = list(_seller_agg.values())

    # Available scope options (so the picker can populate without a second call)
    options = {
        "properties": [
            {"id": p.id, "title": p.title, "status": p.status}
            for p in db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False).order_by(PropertyDeal.id.desc()).all()
        ],
        "partnerships": [
            {"id": p.id, "title": p.title, "status": p.status, "linked_property_deal_id": p.linked_property_deal_id}
            for p in db.query(Partnership).filter(Partnership.is_deleted == False).order_by(Partnership.id.desc()).all()
        ],
        "site_plots": [
            {
                "id": sp.id,
                "plot_number": sp.plot_number,
                "property_deal_id": sp.property_deal_id,
                "status": sp.status,
            }
            for sp in db.query(SitePlot).order_by(SitePlot.id.desc()).all()
        ],
    }

    return {
        "scope": {
            "property_ids": property_ids,
            "site_plot_ids": site_plot_ids,
            "partnership_ids": partnership_ids,
            "preset": scope,
        },
        "summary_sentence": summary_sentence,
        "combined": {
            "buckets": combined_buckets,
            "members": combined_members_list,
            "sellers": combined_sellers_list,
        },
        "blocks": blocks,
        "options": options,
    }



def _fmt_inr(n: float) -> str:
    """Compact INR formatter (₹12.5L / ₹1.2Cr) for the plain-English summary."""
    n = float(n or 0)
    sign = "-" if n < 0 else ""
    n = abs(n)
    if n >= 1_00_00_000:
        return f"{sign}₹{n/1_00_00_000:.2f}Cr"
    if n >= 1_00_000:
        return f"{sign}₹{n/1_00_000:.2f}L"
    if n >= 1_000:
        return f"{sign}₹{n/1_000:.1f}K"
    return f"{sign}₹{int(n)}"


def _build_summary_sentence(buckets: dict, members: list) -> str:
    parts = []
    if buckets.get("to_receive_from_buyers", 0) > 0:
        parts.append(f"{_fmt_inr(buckets['to_receive_from_buyers'])} still to come from buyers")
    if buckets.get("to_pay_to_seller", 0) > 0:
        parts.append(f"{_fmt_inr(buckets['to_pay_to_seller'])} still owed to seller")
    if buckets.get("already_received", 0) > 0:
        parts.append(f"{_fmt_inr(buckets['already_received'])} already received from buyers")
    if buckets.get("already_paid_out", 0) > 0:
        parts.append(f"{_fmt_inr(buckets['already_paid_out'])} paid to seller so far")
    self_holding = next((m.get("net_holding", m.get("currently_holding", 0)) for m in members if m.get("is_self")), 0)
    if self_holding and abs(self_holding) > 1:
        parts.append(f"You are holding {_fmt_inr(self_holding)} of pot money")
    others_holding = sum(
        m.get("net_holding", m.get("currently_holding", 0))
        for m in members if not m.get("is_self") and m.get("net_holding", 0) > 0
    )
    if others_holding and others_holding > 1:
        parts.append(f"Partners are holding {_fmt_inr(others_holding)}")
    return " · ".join(parts) if parts else "Select properties above to see the money flow."


# ═══════════════════════════════════════════════════════════════════════════════
# ANOMALY DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def _upsert_anomaly(
    db: Session,
    scope_kind: str,
    scope_id: int,
    scope_title: str,
    anomaly_type: str,
    severity: str,
    message: str,
    metric_value: float,
    threshold_value: float,
) -> None:
    """Insert or refresh an anomaly record; mark resolved if condition cleared."""
    existing = (
        db.query(PropertyAnomaly)
        .filter(
            PropertyAnomaly.scope_kind == scope_kind,
            PropertyAnomaly.scope_id == scope_id,
            PropertyAnomaly.anomaly_type == anomaly_type,
            PropertyAnomaly.is_resolved == False,
        )
        .first()
    )
    now = datetime.now(timezone.utc)
    if existing:
        existing.metric_value = metric_value
        existing.threshold_value = threshold_value
        existing.message = message
        existing.last_scanned = now
    else:
        db.add(PropertyAnomaly(
            scope_kind=scope_kind,
            scope_id=scope_id,
            scope_title=scope_title,
            anomaly_type=anomaly_type,
            severity=severity,
            message=message,
            metric_value=metric_value,
            threshold_value=threshold_value,
            first_seen=now,
            last_scanned=now,
        ))


def _resolve_anomaly(
    db: Session,
    scope_kind: str,
    scope_id: int,
    anomaly_type: str,
) -> None:
    existing = (
        db.query(PropertyAnomaly)
        .filter(
            PropertyAnomaly.scope_kind == scope_kind,
            PropertyAnomaly.scope_id == scope_id,
            PropertyAnomaly.anomaly_type == anomaly_type,
            PropertyAnomaly.is_resolved == False,
        )
        .first()
    )
    if existing:
        existing.is_resolved = True
        existing.resolved_at = datetime.now(timezone.utc)


def _run_anomaly_scan(db: Session) -> int:
    """
    Scan all active property deals for financial imbalances.
    Returns the count of active (unresolved) anomalies after the scan.
    """
    deals = db.query(PropertyDeal).filter(PropertyDeal.is_deleted == False).all()
    for deal in deals:
        buckets = _compute_property_buckets(deal, db)
        title = deal.title or f"Property #{deal.id}"
        seller_value = buckets.get("total_seller_value", 0.0)
        buyer_value  = buckets.get("registered_buyer_value", 0.0)
        paid_to_seller = buckets.get("paid_to_seller", 0.0)
        to_pay = buckets.get("to_pay_to_seller", 0.0)
        already_received = buckets.get("already_received", 0.0)

        # 1. Low buyer coverage — buyer registrations cover < 50% of seller cost
        threshold_50 = round(seller_value * 0.50, 2)
        if seller_value > 0 and buyer_value < threshold_50:
            _upsert_anomaly(
                db, "property", deal.id, title,
                "low_buyer_coverage", "warning",
                f"Registered buyer value ({_fmt_inr(buyer_value)}) covers only "
                f"{int(buyer_value / seller_value * 100)}% of seller cost ({_fmt_inr(seller_value)}).",
                buyer_value, threshold_50,
            )
        else:
            _resolve_anomaly(db, "property", deal.id, "low_buyer_coverage")

        # 2. Cash flow risk — still owe seller more than we have collected from buyers
        if to_pay > 0 and to_pay > already_received:
            _upsert_anomaly(
                db, "property", deal.id, title,
                "cash_flow_risk", "critical",
                f"Still owe seller {_fmt_inr(to_pay)} but only "
                f"{_fmt_inr(already_received)} has been collected from buyers.",
                to_pay, already_received,
            )
        else:
            _resolve_anomaly(db, "property", deal.id, "cash_flow_risk")

        # 3. Overpaid to seller — paid > total_seller_value (data integrity issue)
        if seller_value > 0 and paid_to_seller > seller_value * 1.05:
            _upsert_anomaly(
                db, "property", deal.id, title,
                "overpaid_to_seller", "critical",
                f"Total paid to seller ({_fmt_inr(paid_to_seller)}) exceeds "
                f"agreed seller value ({_fmt_inr(seller_value)}) by more than 5%.",
                paid_to_seller, seller_value,
            )
        else:
            _resolve_anomaly(db, "property", deal.id, "overpaid_to_seller")

        # 4. Collection lag — > 80% buyer value outstanding
        if buyer_value > 0:
            to_receive = buckets.get("to_receive_from_buyers", 0.0)
            lag_threshold = round(buyer_value * 0.80, 2)
            if to_receive > lag_threshold:
                _upsert_anomaly(
                    db, "property", deal.id, title,
                    "collection_lag", "warning",
                    f"{_fmt_inr(to_receive)} ({int(to_receive / buyer_value * 100)}% of buyer total) "
                    f"is still outstanding from buyers.",
                    to_receive, lag_threshold,
                )
            else:
                _resolve_anomaly(db, "property", deal.id, "collection_lag")

    db.commit()
    return db.query(PropertyAnomaly).filter(PropertyAnomaly.is_resolved == False).count()


@router.post("/anomalies/scan")
def trigger_anomaly_scan(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Trigger a full anomaly scan across all active property deals.
    Idempotent: safe to call on every dashboard load.
    """
    active_count = _run_anomaly_scan(db)
    return {"status": "ok", "active_anomalies": active_count}


@router.get("/anomalies")
def get_anomalies(
    scope_kind: Optional[str] = Query(None),
    scope_id: Optional[int] = Query(None),
    resolved: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return flagged financial anomalies, newest first."""
    q = db.query(PropertyAnomaly).filter(PropertyAnomaly.is_resolved == resolved)
    if scope_kind:
        q = q.filter(PropertyAnomaly.scope_kind == scope_kind)
    if scope_id is not None:
        q = q.filter(PropertyAnomaly.scope_id == scope_id)
    rows = q.order_by(PropertyAnomaly.first_seen.desc()).all()
    return [
        {
            "id": r.id,
            "scope_kind": r.scope_kind,
            "scope_id": r.scope_id,
            "scope_title": r.scope_title,
            "anomaly_type": r.anomaly_type,
            "severity": r.severity,
            "message": r.message,
            "metric_value": float(r.metric_value or 0),
            "threshold_value": float(r.threshold_value or 0),
            "is_resolved": r.is_resolved,
            "first_seen": r.first_seen.isoformat() if r.first_seen else None,
            "last_scanned": r.last_scanned.isoformat() if r.last_scanned else None,
        }
        for r in rows
    ]
