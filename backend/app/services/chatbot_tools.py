"""
Financial data tools for the AI chatbot.
Each function queries the database (read-only) and returns a structured dict
that Gemini can interpret and relay to the user.
"""

from datetime import date, timedelta
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_

from app.models.cash_account import CashAccount, AccountTransaction
from app.models.loan import Loan, LoanPayment
from app.models.expense import Expense
from app.models.property_deal import PropertyDeal, PropertyTransaction
from app.models.partnership import Partnership, PartnershipMember, PartnershipTransaction
from app.models.beesi import Beesi, BeesiInstallment, BeesiWithdrawal
from app.models.obligation import MoneyObligation, ObligationSettlement
from app.models.contact import Contact
from app.models.category_limit import CategoryLimit


def _dec(v):
    """Convert Decimal/None to float for JSON serialisation."""
    if v is None:
        return 0.0
    return float(v)


# ── 1. Account summary ──────────────────────────────────────────────

def get_account_summary(db: Session, user_id: int) -> dict:
    """Return all cash accounts with computed balances."""
    accounts = (
        db.query(CashAccount)
        .filter(CashAccount.created_by == user_id, CashAccount.is_deleted == False)
        .all()
    )
    results = []
    total_balance = 0.0
    for acc in accounts:
        credits = (
            db.query(func.coalesce(func.sum(AccountTransaction.amount), 0))
            .filter(AccountTransaction.account_id == acc.id, AccountTransaction.txn_type == "credit")
            .scalar()
        )
        debits = (
            db.query(func.coalesce(func.sum(AccountTransaction.amount), 0))
            .filter(AccountTransaction.account_id == acc.id, AccountTransaction.txn_type == "debit")
            .scalar()
        )
        balance = _dec(acc.opening_balance) + _dec(credits) - _dec(debits)
        total_balance += balance
        results.append({
            "id": acc.id,
            "name": acc.name,
            "type": acc.account_type,
            "bank": acc.bank_name or "",
            "opening_balance": _dec(acc.opening_balance),
            "total_credits": _dec(credits),
            "total_debits": _dec(debits),
            "current_balance": round(balance, 2),
        })
    return {"accounts": results, "total_balance": round(total_balance, 2)}


# ── 2. Loan summary ─────────────────────────────────────────────────

def get_loan_summary(db: Session, user_id: int) -> dict:
    """Return all active loans with outstanding amounts."""
    loans = (
        db.query(Loan)
        .filter(Loan.created_by == user_id, Loan.is_deleted == False)
        .all()
    )
    results = []
    total_given = 0.0
    total_taken = 0.0
    for loan in loans:
        paid = (
            db.query(func.coalesce(func.sum(LoanPayment.amount_paid), 0))
            .filter(LoanPayment.loan_id == loan.id)
            .scalar()
        )
        contact_name = loan.contact.name if loan.contact else "Unknown"
        principal = _dec(loan.principal_amount)
        paid_amount = _dec(paid)
        outstanding = principal - paid_amount

        if loan.loan_direction == "given":
            total_given += outstanding
        else:
            total_taken += outstanding

        results.append({
            "id": loan.id,
            "contact": contact_name,
            "direction": loan.loan_direction,
            "type": loan.loan_type,
            "principal": principal,
            "interest_rate_monthly": _dec(loan.interest_rate),
            "total_paid": paid_amount,
            "outstanding": round(outstanding, 2),
            "status": loan.status,
            "disbursed_date": str(loan.disbursed_date) if loan.disbursed_date else None,
        })
    return {
        "loans": results,
        "total_outstanding_given": round(total_given, 2),
        "total_outstanding_taken": round(total_taken, 2),
        "count": len(results),
    }


# ── 3. Expense analysis ─────────────────────────────────────────────

def get_expense_analysis(db: Session, user_id: int, period_days: int = 30) -> dict:
    """Expense breakdown for the given period (default 30 days)."""
    since = date.today() - timedelta(days=period_days)
    expenses = (
        db.query(Expense)
        .filter(Expense.created_by == user_id, Expense.expense_date >= since)
        .all()
    )
    by_category = {}
    total = 0.0
    for exp in expenses:
        cat = exp.category or "Uncategorized"
        amt = _dec(exp.amount)
        by_category[cat] = by_category.get(cat, 0.0) + amt
        total += amt

    # Check category limits
    limits = db.query(CategoryLimit).filter(CategoryLimit.created_by == user_id).all()
    limit_map = {cl.category: _dec(cl.monthly_limit) for cl in limits}
    warnings = []
    for cat, spent in by_category.items():
        if cat in limit_map and spent > limit_map[cat]:
            warnings.append(f"{cat}: spent ₹{spent:,.2f} vs limit ₹{limit_map[cat]:,.2f} (over by ₹{spent - limit_map[cat]:,.2f})")

    sorted_cats = sorted(by_category.items(), key=lambda x: x[1], reverse=True)
    return {
        "period_days": period_days,
        "total_spent": round(total, 2),
        "by_category": [{"category": c, "amount": round(a, 2)} for c, a in sorted_cats],
        "budget_warnings": warnings,
        "expense_count": len(expenses),
    }


# ── 4. Obligation / debt summary ────────────────────────────────────

def get_obligation_summary(db: Session, user_id: int) -> dict:
    """Who owes you, and who you owe."""
    obligations = (
        db.query(MoneyObligation)
        .filter(MoneyObligation.created_by == user_id, MoneyObligation.is_deleted == False)
        .all()
    )
    receivables = []
    payables = []
    for ob in obligations:
        contact_name = ob.contact.name if ob.contact else "Unknown"
        remaining = _dec(ob.amount) - _dec(ob.amount_settled)
        entry = {
            "id": ob.id,
            "contact": contact_name,
            "total_amount": _dec(ob.amount),
            "settled": _dec(ob.amount_settled),
            "remaining": round(remaining, 2),
            "reason": ob.reason or "",
            "due_date": str(ob.due_date) if ob.due_date else None,
            "status": ob.status,
            "linked_type": ob.linked_type,
        }
        if ob.obligation_type == "receivable":
            receivables.append(entry)
        else:
            payables.append(entry)

    return {
        "receivables": receivables,
        "payables": payables,
        "total_receivable": round(sum(r["remaining"] for r in receivables), 2),
        "total_payable": round(sum(p["remaining"] for p in payables), 2),
    }


# ── 5. Property summary ─────────────────────────────────────────────

def get_property_summary(db: Session, user_id: int) -> dict:
    """All property deals with status and financials."""
    deals = (
        db.query(PropertyDeal)
        .filter(PropertyDeal.created_by == user_id, PropertyDeal.is_deleted == False, PropertyDeal.is_legacy == False)
        .all()
    )
    results = []
    for d in deals:
        txn_in = (
            db.query(func.coalesce(func.sum(PropertyTransaction.amount), 0))
            .filter(
                PropertyTransaction.property_deal_id == d.id,
                PropertyTransaction.txn_type.in_(["received_from_buyer", "sale_proceeds"]),
            )
            .scalar()
        )
        txn_out = (
            db.query(func.coalesce(func.sum(PropertyTransaction.amount), 0))
            .filter(
                PropertyTransaction.property_deal_id == d.id,
                PropertyTransaction.txn_type.in_(["advance_to_seller", "payment_to_seller", "commission_paid", "expense"]),
            )
            .scalar()
        )
        results.append({
            "id": d.id,
            "title": d.title,
            "location": d.location or "",
            "status": d.status,
            "my_investment": _dec(d.my_investment),
            "total_received": _dec(txn_in),
            "total_paid": _dec(txn_out),
            "net_profit": _dec(d.net_profit),
            "property_type": d.property_type,
        })
    return {"properties": results, "count": len(results)}


# ── 6. Partnership summary ──────────────────────────────────────────

def get_partnership_summary(db: Session, user_id: int) -> dict:
    """All partnerships with member shares and financials."""
    partnerships = (
        db.query(Partnership)
        .filter(Partnership.created_by == user_id, Partnership.is_deleted == False, Partnership.is_legacy == False)
        .all()
    )
    results = []
    for p in partnerships:
        members = (
            db.query(PartnershipMember)
            .filter(PartnershipMember.partnership_id == p.id)
            .all()
        )
        member_list = []
        for m in members:
            name = "Self" if m.is_self else (m.contact.name if m.contact else "Unknown")
            member_list.append({
                "name": name,
                "share_pct": _dec(m.share_percentage),
                "contributed": _dec(m.advance_contributed),
                "received": _dec(m.total_received),
            })
        results.append({
            "id": p.id,
            "title": p.title,
            "status": p.status,
            "our_investment": _dec(p.our_investment),
            "our_share_pct": _dec(p.our_share_percentage),
            "total_received": _dec(p.total_received),
            "deal_value": _dec(p.total_deal_value),
            "members": member_list,
        })
    return {"partnerships": results, "count": len(results)}


# ── 7. Beesi summary ────────────────────────────────────────────────

def get_beesi_summary(db: Session, user_id: int) -> dict:
    """All beesi (chit fund) statuses."""
    beesis = (
        db.query(Beesi)
        .filter(Beesi.created_by == user_id, Beesi.is_deleted == False)
        .all()
    )
    results = []
    for b in beesis:
        total_paid = (
            db.query(func.coalesce(func.sum(BeesiInstallment.actual_paid), 0))
            .filter(BeesiInstallment.beesi_id == b.id)
            .scalar()
        )
        total_withdrawn = (
            db.query(func.coalesce(func.sum(BeesiWithdrawal.net_received), 0))
            .filter(BeesiWithdrawal.beesi_id == b.id)
            .scalar()
        )
        installments_done = (
            db.query(func.count(BeesiInstallment.id))
            .filter(BeesiInstallment.beesi_id == b.id)
            .scalar()
        )
        results.append({
            "id": b.id,
            "title": b.title,
            "pot_size": _dec(b.pot_size),
            "member_count": b.member_count,
            "tenure_months": b.tenure_months,
            "base_installment": _dec(b.base_installment),
            "installments_done": installments_done,
            "total_paid_in": _dec(total_paid),
            "total_withdrawn": _dec(total_withdrawn),
            "status": b.status,
        })
    return {"beesis": results, "count": len(results)}


# ── 8. Contact debt lookup ──────────────────────────────────────────

def get_contact_financial_summary(db: Session, user_id: int, contact_name: str) -> dict:
    """
    Look up a specific contact by name and return all their financial links:
    loans, obligations, partnership memberships, property transactions.
    """
    contacts = (
        db.query(Contact)
        .filter(
            Contact.is_deleted == False,
            Contact.name.ilike(f"%{contact_name}%"),
        )
        .all()
    )
    if not contacts:
        return {"found": False, "message": f"No contact found matching '{contact_name}'"}

    results = []
    for c in contacts:
        # Loans with this contact
        loans = db.query(Loan).filter(Loan.contact_id == c.id, Loan.is_deleted == False).all()
        loan_data = []
        for loan in loans:
            paid = (
                db.query(func.coalesce(func.sum(LoanPayment.amount_paid), 0))
                .filter(LoanPayment.loan_id == loan.id)
                .scalar()
            )
            loan_data.append({
                "direction": loan.loan_direction,
                "principal": _dec(loan.principal_amount),
                "paid": _dec(paid),
                "outstanding": round(_dec(loan.principal_amount) - _dec(paid), 2),
                "status": loan.status,
            })

        # Obligations
        obligations = db.query(MoneyObligation).filter(
            MoneyObligation.contact_id == c.id, MoneyObligation.is_deleted == False
        ).all()
        ob_data = [{
            "type": ob.obligation_type,
            "amount": _dec(ob.amount),
            "settled": _dec(ob.amount_settled),
            "remaining": round(_dec(ob.amount) - _dec(ob.amount_settled), 2),
            "reason": ob.reason or "",
            "due_date": str(ob.due_date) if ob.due_date else None,
            "status": ob.status,
        } for ob in obligations]

        results.append({
            "contact_id": c.id,
            "name": c.name,
            "phone": c.phone or "",
            "relationship": c.relationship_type,
            "loans": loan_data,
            "obligations": ob_data,
        })
    return {"found": True, "contacts": results}


# ── 9. Upcoming payments / due dates ────────────────────────────────

def get_upcoming_payments(db: Session, user_id: int, days_ahead: int = 30) -> dict:
    """Obligations and expected payments due in the next N days."""
    cutoff = date.today() + timedelta(days=days_ahead)
    obligations = (
        db.query(MoneyObligation)
        .filter(
            MoneyObligation.created_by == user_id,
            MoneyObligation.is_deleted == False,
            MoneyObligation.status.in_(["pending", "partial"]),
            MoneyObligation.due_date != None,
            MoneyObligation.due_date <= cutoff,
        )
        .order_by(MoneyObligation.due_date)
        .all()
    )
    results = []
    for ob in obligations:
        remaining = _dec(ob.amount) - _dec(ob.amount_settled)
        contact_name = ob.contact.name if ob.contact else "Unknown"
        results.append({
            "type": ob.obligation_type,
            "contact": contact_name,
            "remaining": round(remaining, 2),
            "due_date": str(ob.due_date),
            "reason": ob.reason or "",
            "overdue": ob.due_date < date.today(),
        })
    return {
        "upcoming": results,
        "count": len(results),
        "overdue_count": sum(1 for r in results if r["overdue"]),
    }


# ── 10. Validate incoming money claim ───────────────────────────────

def validate_incoming_money(db: Session, user_id: int, person_name: str, amount: float, expected_date: str) -> dict:
    """
    User says "X amount from Y person by Z date" → check if a matching
    obligation / loan exists.
    """
    contacts = (
        db.query(Contact)
        .filter(Contact.is_deleted == False, Contact.name.ilike(f"%{person_name}%"))
        .all()
    )
    if not contacts:
        return {
            "verified": False,
            "message": f"No contact found matching '{person_name}'. Please check the name.",
            "suggestion": "Would you like me to search with a different name?"
        }

    findings = []
    for c in contacts:
        # Check receivable obligations
        obligations = db.query(MoneyObligation).filter(
            MoneyObligation.contact_id == c.id,
            MoneyObligation.is_deleted == False,
            MoneyObligation.obligation_type == "receivable",
            MoneyObligation.status.in_(["pending", "partial"]),
        ).all()
        for ob in obligations:
            remaining = _dec(ob.amount) - _dec(ob.amount_settled)
            findings.append({
                "source": "obligation",
                "contact": c.name,
                "total_amount": _dec(ob.amount),
                "remaining": round(remaining, 2),
                "due_date": str(ob.due_date) if ob.due_date else None,
                "reason": ob.reason or "",
                "amount_matches": abs(remaining - amount) < 1.0,
            })

        # Check loans given (they owe us)
        loans = db.query(Loan).filter(
            Loan.contact_id == c.id,
            Loan.is_deleted == False,
            Loan.loan_direction == "given",
            Loan.status == "active",
        ).all()
        for loan in loans:
            paid = (
                db.query(func.coalesce(func.sum(LoanPayment.amount_paid), 0))
                .filter(LoanPayment.loan_id == loan.id)
                .scalar()
            )
            outstanding = _dec(loan.principal_amount) - _dec(paid)
            findings.append({
                "source": "loan",
                "contact": c.name,
                "principal": _dec(loan.principal_amount),
                "outstanding": round(outstanding, 2),
                "interest_rate": _dec(loan.interest_rate),
                "amount_matches": abs(outstanding - amount) < 1.0 or amount <= outstanding,
            })

    if not findings:
        return {
            "verified": False,
            "message": f"No outstanding receivable or loan found for '{person_name}'.",
            "suggestion": "This person doesn't owe any recorded amount. Should I create a new obligation?"
        }

    any_match = any(f.get("amount_matches") for f in findings)
    return {
        "verified": any_match,
        "message": "Found matching records" if any_match else "Records exist but amounts don't match exactly",
        "findings": findings,
    }


# ── 11. Data quality check ──────────────────────────────────────────

def get_data_issues(db: Session, user_id: int) -> dict:
    """Scan for common data entry problems."""
    issues = []

    # Uncategorized expenses
    uncat_count = (
        db.query(func.count(Expense.id))
        .filter(Expense.created_by == user_id, Expense.category == None)
        .scalar()
    )
    if uncat_count > 0:
        issues.append({"severity": "warning", "message": f"{uncat_count} expenses without a category"})

    # Loans with no payments
    stale_loans = (
        db.query(Loan)
        .filter(Loan.created_by == user_id, Loan.is_deleted == False, Loan.status == "active")
        .all()
    )
    for loan in stale_loans:
        last_payment = (
            db.query(func.max(LoanPayment.payment_date))
            .filter(LoanPayment.loan_id == loan.id)
            .scalar()
        )
        if last_payment and (date.today() - last_payment).days > 90:
            contact_name = loan.contact.name if loan.contact else "Unknown"
            issues.append({
                "severity": "warning",
                "message": f"Loan to {contact_name} (₹{_dec(loan.principal_amount):,.0f}) - no payment in {(date.today() - last_payment).days} days"
            })
        elif not last_payment:
            contact_name = loan.contact.name if loan.contact else "Unknown"
            age = (date.today() - loan.disbursed_date).days if loan.disbursed_date else 0
            if age > 30:
                issues.append({
                    "severity": "info",
                    "message": f"Loan to {contact_name} (₹{_dec(loan.principal_amount):,.0f}) - no payments recorded ({age} days old)"
                })

    # Overdue obligations
    overdue = (
        db.query(MoneyObligation)
        .filter(
            MoneyObligation.created_by == user_id,
            MoneyObligation.is_deleted == False,
            MoneyObligation.status.in_(["pending", "partial"]),
            MoneyObligation.due_date != None,
            MoneyObligation.due_date < date.today(),
        )
        .all()
    )
    for ob in overdue:
        remaining = _dec(ob.amount) - _dec(ob.amount_settled)
        contact_name = ob.contact.name if ob.contact else "Unknown"
        days_overdue = (date.today() - ob.due_date).days
        issues.append({
            "severity": "alert",
            "message": f"{'Receivable from' if ob.obligation_type == 'receivable' else 'Payable to'} {contact_name}: ₹{remaining:,.0f} is {days_overdue} days overdue"
        })

    # Accounts with negative balance
    accounts = (
        db.query(CashAccount)
        .filter(CashAccount.created_by == user_id, CashAccount.is_deleted == False)
        .all()
    )
    for acc in accounts:
        if acc.account_type == "credit_card":
            continue
        credits = (
            db.query(func.coalesce(func.sum(AccountTransaction.amount), 0))
            .filter(AccountTransaction.account_id == acc.id, AccountTransaction.txn_type == "credit")
            .scalar()
        )
        debits = (
            db.query(func.coalesce(func.sum(AccountTransaction.amount), 0))
            .filter(AccountTransaction.account_id == acc.id, AccountTransaction.txn_type == "debit")
            .scalar()
        )
        balance = _dec(acc.opening_balance) + _dec(credits) - _dec(debits)
        if balance < 0:
            issues.append({
                "severity": "alert",
                "message": f"Account '{acc.name}' has negative balance: ₹{balance:,.2f}"
            })

    return {"issues": issues, "count": len(issues)}


# ── 12. Financial overview / net position ────────────────────────────

def get_financial_overview(db: Session, user_id: int) -> dict:
    """High-level financial snapshot: total assets, liabilities, net worth."""
    # Account balances
    acc_data = get_account_summary(db, user_id)
    cash_total = acc_data["total_balance"]

    # Loans given (assets) vs taken (liabilities)
    loan_data = get_loan_summary(db, user_id)

    # Obligations
    ob_data = get_obligation_summary(db, user_id)

    # Property investments
    prop_data = get_property_summary(db, user_id)
    prop_invested = sum(p["my_investment"] for p in prop_data["properties"])

    # Partnership investments
    partner_data = get_partnership_summary(db, user_id)
    partner_invested = sum(p["our_investment"] for p in partner_data["partnerships"])

    total_assets = cash_total + loan_data["total_outstanding_given"] + ob_data["total_receivable"] + prop_invested + partner_invested
    total_liabilities = loan_data["total_outstanding_taken"] + ob_data["total_payable"]

    return {
        "cash_in_accounts": round(cash_total, 2),
        "loans_given_outstanding": loan_data["total_outstanding_given"],
        "loans_taken_outstanding": loan_data["total_outstanding_taken"],
        "receivables": ob_data["total_receivable"],
        "payables": ob_data["total_payable"],
        "property_investments": round(prop_invested, 2),
        "partnership_investments": round(partner_invested, 2),
        "total_assets": round(total_assets, 2),
        "total_liabilities": round(total_liabilities, 2),
        "net_worth": round(total_assets - total_liabilities, 2),
    }


# ── 13. Recent transactions ─────────────────────────────────────────

def get_recent_transactions(db: Session, user_id: int, limit: int = 20) -> dict:
    """Return the most recent account transactions."""
    txns = (
        db.query(AccountTransaction)
        .join(CashAccount, AccountTransaction.account_id == CashAccount.id)
        .filter(CashAccount.created_by == user_id)
        .order_by(AccountTransaction.txn_date.desc(), AccountTransaction.id.desc())
        .limit(limit)
        .all()
    )
    results = []
    for t in txns:
        acc = db.query(CashAccount).filter(CashAccount.id == t.account_id).first()
        contact = db.query(Contact).filter(Contact.id == t.contact_id).first() if t.contact_id else None
        results.append({
            "date": str(t.txn_date),
            "type": t.txn_type,
            "amount": _dec(t.amount),
            "account": acc.name if acc else "Unknown",
            "description": t.description or "",
            "linked_type": t.linked_type or "",
            "contact": contact.name if contact else "",
            "payment_mode": t.payment_mode or "",
        })
    return {"transactions": results, "count": len(results)}


# ── Tool registry for Gemini function-calling ────────────────────────

TOOL_FUNCTIONS = {
    "get_account_summary": get_account_summary,
    "get_loan_summary": get_loan_summary,
    "get_expense_analysis": get_expense_analysis,
    "get_obligation_summary": get_obligation_summary,
    "get_property_summary": get_property_summary,
    "get_partnership_summary": get_partnership_summary,
    "get_beesi_summary": get_beesi_summary,
    "get_contact_financial_summary": get_contact_financial_summary,
    "get_upcoming_payments": get_upcoming_payments,
    "validate_incoming_money": validate_incoming_money,
    "get_data_issues": get_data_issues,
    "get_financial_overview": get_financial_overview,
    "get_recent_transactions": get_recent_transactions,
}

# Gemini function declarations — tells the model what tools are available
TOOL_DECLARATIONS = [
    {
        "name": "get_account_summary",
        "description": "Get all cash/bank accounts with their current balances, credits, and debits.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_loan_summary",
        "description": "Get all loans (given and taken) with outstanding amounts, interest rates, and payment history.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_expense_analysis",
        "description": "Get expense breakdown by category for a given period, including budget limit warnings.",
        "parameters": {
            "type": "object",
            "properties": {
                "period_days": {
                    "type": "integer",
                    "description": "Number of days to look back. Default 30.",
                },
            },
        },
    },
    {
        "name": "get_obligation_summary",
        "description": "Get all money obligations — who owes the user (receivables) and who the user owes (payables), with remaining amounts and due dates.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_property_summary",
        "description": "Get all property/real-estate deals with investment amounts, receipts, and profit/loss.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_partnership_summary",
        "description": "Get all partnerships with member shares, investments, and returns.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_beesi_summary",
        "description": "Get all beesi/chit-fund groups with installment status and withdrawals.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_contact_financial_summary",
        "description": "Look up a specific person/contact by name and get all their financial relationships — loans, obligations, etc.",
        "parameters": {
            "type": "object",
            "properties": {
                "contact_name": {
                    "type": "string",
                    "description": "Full or partial name of the contact to search.",
                },
            },
            "required": ["contact_name"],
        },
    },
    {
        "name": "get_upcoming_payments",
        "description": "Get upcoming due payments and overdue obligations within the next N days.",
        "parameters": {
            "type": "object",
            "properties": {
                "days_ahead": {
                    "type": "integer",
                    "description": "Number of days to look ahead. Default 30.",
                },
            },
        },
    },
    {
        "name": "validate_incoming_money",
        "description": "Verify if a claimed incoming payment is valid — checks if the person has an outstanding debt or loan. Use when user says something like 'X amount from Y person will come by Z date'.",
        "parameters": {
            "type": "object",
            "properties": {
                "person_name": {
                    "type": "string",
                    "description": "Name of the person who will send money.",
                },
                "amount": {
                    "type": "number",
                    "description": "Amount expected to receive.",
                },
                "expected_date": {
                    "type": "string",
                    "description": "Expected date in YYYY-MM-DD format.",
                },
            },
            "required": ["person_name", "amount", "expected_date"],
        },
    },
    {
        "name": "get_data_issues",
        "description": "Scan for data quality problems: uncategorized expenses, stale loans without payments, overdue obligations, negative account balances.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_financial_overview",
        "description": "Get a high-level financial snapshot: total assets, liabilities, net worth, cash, loans, receivables, payables, investments.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "get_recent_transactions",
        "description": "Get the most recent account transactions across all accounts.",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Number of transactions to return. Default 20.",
                },
            },
        },
    },
]
