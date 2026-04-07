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
from app.services.interest import calculate_outstanding, generate_emi_schedule, get_emi_schedule_with_payments, _build_calendar_periods, _calc_period_interest

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
