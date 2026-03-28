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
from app.models.user import User
from app.services.interest import calculate_outstanding

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
