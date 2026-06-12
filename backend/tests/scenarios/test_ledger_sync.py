"""Ledger source-link + two-way sync scenarios (migration 042).

Every auto-created ledger row is stamped with the exact record that created
it; reversals match on that stamp; and voiding from the Accounts page cascades
back to the source record (or is blocked with guidance when unsafe).
"""
from datetime import date

import pytest

from tests.scenarios.helpers import (
    make_account, make_contact, make_loan, pay_loan, loan_detail,
    account_balance, account_txns,
    make_property, make_partnership, add_member, add_partnership_txn,
    months_ago,
)


class TestSourceStamping:
    def test_loan_entries_are_source_stamped(self, client, db, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=500000)
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, account_id=acct["id"])
        p = pay_loan(client, auth_headers, loan["id"], 5000)

        txns = account_txns(client, auth_headers, acct["id"])
        disb = next(t for t in txns if t["source_type"] == "loan_disbursement")
        pay = next(t for t in txns if t["source_type"] == "loan_payment")
        assert disb["source_id"] == loan["id"]
        assert pay["source_id"] == p["id"]

    def test_exact_reversal_spares_same_amount_same_day_rows(
            self, client, db, admin_user, auth_headers):
        """The old heuristic matched by (amount, date) and could void the wrong
        row. With the source link, only the payment's own entry is voided."""
        acct = make_account(client, auth_headers, opening_balance=0)
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, account_id=acct["id"],
                         disbursed_date=months_ago(2))
        p = pay_loan(client, auth_headers, loan["id"], 5000)
        # Manual credit: same account, same amount, same day
        client.post(f"/api/accounts/{acct['id']}/transactions", headers=auth_headers, json={
            "txn_type": "credit", "amount": 5000, "txn_date": date.today().isoformat(),
            "description": "unrelated manual credit",
        })

        client.delete(f"/api/loans/{loan['id']}/payments/{p['id']}", headers=auth_headers)

        live = account_txns(client, auth_headers, acct["id"])
        manual = [t for t in live if (t["description"] or "").startswith("unrelated")]
        assert len(manual) == 1, "exact reversal must not touch the unrelated manual row"
        assert all(t["source_type"] != "loan_payment" for t in live)


class TestTwoWayVoid:
    def test_voiding_payment_ledger_row_cascades_to_loan(
            self, client, db, admin_user, auth_headers):
        """Admin deletes the entry from the Accounts page → the loan payment is
        voided too, outstanding restored."""
        acct = make_account(client, auth_headers, opening_balance=0)
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, account_id=acct["id"],
                         disbursed_date=months_ago(2))
        out_before = float(loan_detail(client, auth_headers, loan["id"])["outstanding"]["total_outstanding"])
        pay_loan(client, auth_headers, loan["id"], 4000)

        txns = account_txns(client, auth_headers, acct["id"])
        ledger_row = next(t for t in txns if t["source_type"] == "loan_payment")

        resp = client.delete(f"/api/accounts/transactions/{ledger_row['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json().get("cascaded") == "loan_payment"

        detail = loan_detail(client, auth_headers, loan["id"])
        assert detail["payments"] == [], "payment must be voided via the ledger-side delete"
        assert float(detail["outstanding"]["total_outstanding"]) == pytest.approx(out_before, abs=0.02)

    def test_voiding_expense_ledger_row_cascades_to_expense(
            self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=10000)
        e = client.post("/api/expenses", headers=auth_headers, json={
            "amount": 1500, "expense_date": date.today().isoformat(),
            "category": "Food", "account_id": acct["id"],
        }).json()
        ledger_row = next(t for t in account_txns(client, auth_headers, acct["id"])
                          if t["source_type"] == "expense")

        resp = client.delete(f"/api/accounts/transactions/{ledger_row['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json().get("cascaded") == "expense"
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(10000)

        listed = client.get("/api/expenses", headers=auth_headers).json()
        assert all(x["id"] != e["id"] for x in listed), "expense must be soft-deleted"

    def test_voiding_disbursement_row_is_blocked_with_guidance(
            self, client, db, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=500000)
        contact = make_contact(db)
        make_loan(client, auth_headers, contact.id,
                  principal_amount=100000, account_id=acct["id"])
        disb = next(t for t in account_txns(client, auth_headers, acct["id"])
                    if t["source_type"] == "loan_disbursement")

        resp = client.delete(f"/api/accounts/transactions/{disb['id']}", headers=auth_headers)
        assert resp.status_code == 409
        assert "Loans page" in resp.json()["detail"]

        # force=true overrides for emergency cleanup
        resp = client.delete(f"/api/accounts/transactions/{disb['id']}",
                             headers=auth_headers, params={"force": True})
        assert resp.status_code == 200
        assert resp.json()["forced"] is True

    def test_manual_rows_void_normally(self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=1000)
        t = client.post(f"/api/accounts/{acct['id']}/transactions", headers=auth_headers, json={
            "txn_type": "debit", "amount": 200, "txn_date": date.today().isoformat(),
        }).json()
        resp = client.delete(f"/api/accounts/transactions/{t['id']}", headers=auth_headers)
        assert resp.status_code == 200
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(1000)


class TestProfitBasisLabels:
    def test_summary_exposes_both_profit_views(self, client, db, admin_user, auth_headers):
        """PR3: projected (committed cost) vs realized (cash so far) — and the
        property page agrees with the partnership page on both."""
        prop = make_property(client, auth_headers)       # committed seller 500k
        p = make_partnership(client, auth_headers, property_id=prop["id"])
        self_m = add_member(client, auth_headers, p["id"], 100, is_self=True)
        resp = client.post(f"/api/partnerships/{p['id']}/create-buyer",
                           headers=auth_headers,
                           json={"name": "PB Buyer", "area_sqft": 1000, "rate_per_sqft": 800})
        buyer = resp.json()["plot_buyer"]

        add_partnership_txn(client, auth_headers, p["id"], "advance_to_seller", 200000,
                            member_id=self_m["id"])
        add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 300000,
                            received_by_member_id=self_m["id"], plot_buyer_id=buyer["id"])

        psum = client.get(f"/api/partnerships/{p['id']}", headers=auth_headers).json()["summary"]
        # projected: 300k in − 500k committed = −200k; realized: 300k − 200k paid = +100k
        assert float(psum["projected_pnl"]) == pytest.approx(-200000)
        assert float(psum["realized_pnl"]) == pytest.approx(100000)

        prop_sum = client.get(f"/api/properties/{prop['id']}", headers=auth_headers).json()["summary"]
        assert float(prop_sum["realized_pnl"]) == pytest.approx(100000)
        # property projected uses committed buyer value (800k) − committed seller (500k)
        assert float(prop_sum["projected_pnl"]) == pytest.approx(300000)
