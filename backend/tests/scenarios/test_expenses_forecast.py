"""Expense ledger sync, property stats, and forecast engine scenarios."""
from datetime import date, timedelta

import pytest

from tests.scenarios.helpers import (
    make_account, account_balance, account_txns, make_contact,
    make_property, make_partnership, add_member, add_partnership_txn,
    days_from_today, months_ago,
)


class TestExpenseLedgerSync:
    def test_expense_with_account_debits_ledger(self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=10000)
        client.post("/api/expenses", headers=auth_headers, json={
            "amount": 1000, "expense_date": date.today().isoformat(),
            "category": "Food", "account_id": acct["id"],
        })
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(9000)

    def test_attaching_account_later_creates_ledger_entry(self, client, admin_user, auth_headers):
        """E1: expense created without an account, account attached on edit."""
        acct = make_account(client, auth_headers, opening_balance=10000)
        e = client.post("/api/expenses", headers=auth_headers, json={
            "amount": 2000, "expense_date": date.today().isoformat(),
            "category": "Travel",
        }).json()
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(10000)

        resp = client.put(f"/api/expenses/{e['id']}", headers=auth_headers,
                          json={"account_id": acct["id"]})
        assert resp.status_code == 200, resp.text
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(8000), (
            "attaching an account to an existing expense must create the ledger debit")

    def test_delete_expense_reverses_ledger(self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=10000)
        e = client.post("/api/expenses", headers=auth_headers, json={
            "amount": 1000, "expense_date": date.today().isoformat(),
            "category": "Food", "account_id": acct["id"],
        }).json()
        client.delete(f"/api/expenses/{e['id']}", headers=auth_headers)
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(10000)


class TestPropertyStats:
    def test_liability_clears_when_seller_fully_paid(self, client, db, admin_user, auth_headers):
        """PR2: remaining_to_seller payments must reduce the liability."""
        prop = make_property(client, auth_headers)         # seller value 500k
        p = make_partnership(client, auth_headers, property_id=prop["id"])
        self_m = add_member(client, auth_headers, p["id"], 100, is_self=True)

        add_partnership_txn(client, auth_headers, p["id"], "advance_to_seller", 200000,
                            member_id=self_m["id"])
        stats = client.get("/api/properties/stats", headers=auth_headers).json()
        assert stats["my_liability"] == pytest.approx(300000)

        add_partnership_txn(client, auth_headers, p["id"], "remaining_to_seller", 300000,
                            member_id=self_m["id"])
        stats = client.get("/api/properties/stats", headers=auth_headers).json()
        assert stats["my_liability"] == pytest.approx(0), (
            "seller fully paid but stats still show a liability "
            "(remaining_to_seller ignored)")

    def test_voided_expense_txn_not_in_my_capital(self, client, db, admin_user, auth_headers):
        prop = make_property(client, auth_headers)
        p = make_partnership(client, auth_headers, property_id=prop["id"])
        self_m = add_member(client, auth_headers, p["id"], 100, is_self=True)
        t = add_partnership_txn(client, auth_headers, p["id"], "expense", 25000,
                                member_id=self_m["id"])
        stats = client.get("/api/properties/stats", headers=auth_headers).json()
        cap_with = stats["my_capital"]

        client.delete(f"/api/partnerships/{p['id']}/transactions/{t['id']}",
                      headers=auth_headers)
        stats = client.get("/api/properties/stats", headers=auth_headers).json()
        assert stats["my_capital"] == pytest.approx(cap_with - 25000, abs=0.02)


class TestForecast:
    def test_recurring_monthly_expands_across_window(self, client, admin_user, auth_headers):
        """F2: a monthly item in a 90-day window contributes ~3 occurrences."""
        resp = client.post("/api/recurring-transactions", headers=auth_headers, json={
            "title": "Office rent", "type": "outflow", "amount": 10000,
            "frequency": "monthly", "next_due_date": days_from_today(3),
        })
        assert resp.status_code == 201, resp.text

        fc = client.get("/api/forecast", headers=auth_headers,
                        params={"timeframe": "90d"}).json()
        recurring_items = [
            it for g in fc["outflow_groups"] for it in g["items"]
            if it["kind"] == "recurring"
        ]
        assert len(recurring_items) == 3, (
            f"expected 3 monthly occurrences in 90 days, got {len(recurring_items)}")
        assert fc["totals"]["required_outflow"] >= 30000

    def test_recurring_weekly_expands(self, client, admin_user, auth_headers):
        client.post("/api/recurring-transactions", headers=auth_headers, json={
            "title": "Staff wages", "type": "outflow", "amount": 2000,
            "frequency": "weekly", "next_due_date": days_from_today(2),
        })
        fc = client.get("/api/forecast", headers=auth_headers,
                        params={"timeframe": "30d"}).json()
        recurring_items = [
            it for g in fc["outflow_groups"] for it in g["items"]
            if it["kind"] == "recurring"
        ]
        assert len(recurring_items) == 4, (
            f"expected 4 weekly occurrences in 30 days, got {len(recurring_items)}")

    def test_forecast_principal_ignores_voided_payments(self, client, db, admin_user, auth_headers):
        """F1: voiding a principal payment must restore the forecast inflow."""
        contact = make_contact(db)
        from tests.scenarios.helpers import make_loan, pay_loan
        loan = make_loan(client, auth_headers, contact.id,
                         loan_type="short_term", principal_amount=80000,
                         interest_rate=None,
                         disbursed_date=months_ago(1),
                         interest_free_till=days_from_today(10),
                         expected_end_date=days_from_today(10))
        p = pay_loan(client, auth_headers, loan["id"], 30000)

        fc = client.get("/api/forecast", headers=auth_headers, params={"timeframe": "30d"}).json()
        st_items = [it for g in fc["inflow_groups"] for it in g["items"]
                    if it["id"] == f"loan_st_in:{loan['id']}"]
        assert st_items and st_items[0]["amount"] == pytest.approx(50000)

        client.delete(f"/api/loans/{loan['id']}/payments/{p['id']}", headers=auth_headers)
        fc = client.get("/api/forecast", headers=auth_headers, params={"timeframe": "30d"}).json()
        st_items = [it for g in fc["inflow_groups"] for it in g["items"]
                    if it["id"] == f"loan_st_in:{loan['id']}"]
        assert st_items and st_items[0]["amount"] == pytest.approx(80000), (
            "forecast still using the voided payment's principal allocation")
