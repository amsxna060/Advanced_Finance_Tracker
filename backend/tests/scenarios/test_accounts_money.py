"""Account/ledger integrity scenarios: opening-balance edits, transfers,
credit cards, voiding, and cross-screen balance consistency."""
from datetime import date

import pytest

from tests.scenarios.helpers import (
    make_account, account_balance, account_txns, make_contact,
)


class TestOpeningBalance:
    def test_opening_balance_edit_applies_once(self, client, admin_user, auth_headers):
        """A1: editing opening 1000 → 2000 must move the balance by exactly 1000."""
        acct = make_account(client, auth_headers, opening_balance=1000)
        client.post(f"/api/accounts/{acct['id']}/transactions", headers=auth_headers, json={
            "txn_type": "credit", "amount": 500, "txn_date": date.today().isoformat(),
        })
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(1500)

        resp = client.put(f"/api/accounts/{acct['id']}", headers=auth_headers,
                          json={"opening_balance": 2000})
        assert resp.status_code == 200, resp.text
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(2500), (
            "opening-balance delta applied twice (ledger entry + field update)")

    def test_opening_balance_edit_is_idempotent_on_resave(self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=1000)
        client.put(f"/api/accounts/{acct['id']}", headers=auth_headers, json={"opening_balance": 2000})
        client.put(f"/api/accounts/{acct['id']}", headers=auth_headers, json={"opening_balance": 2000})
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(2000)


class TestCreditCards:
    def test_credit_card_includes_opening_owed(self, client, admin_user, auth_headers):
        """A2: opening balance on a credit card = existing dues."""
        card = make_account(client, auth_headers, name="CC", account_type="credit_card",
                            opening_balance=5000, credit_limit=100000)
        assert account_balance(client, auth_headers, card["id"]) == pytest.approx(5000)

        # spend 1000 → owe 6000; pay 2000 → owe 4000
        client.post(f"/api/accounts/{card['id']}/transactions", headers=auth_headers, json={
            "txn_type": "debit", "amount": 1000, "txn_date": date.today().isoformat()})
        client.post(f"/api/accounts/{card['id']}/transactions", headers=auth_headers, json={
            "txn_type": "credit", "amount": 2000, "txn_date": date.today().isoformat()})
        assert account_balance(client, auth_headers, card["id"]) == pytest.approx(4000)


class TestTransfersAndVoids:
    def test_transfer_moves_money_between_accounts(self, client, admin_user, auth_headers):
        a = make_account(client, auth_headers, name="A", opening_balance=10000)
        b = make_account(client, auth_headers, name="B", opening_balance=0)
        resp = client.post("/api/accounts/transfer", headers=auth_headers, json={
            "from_account_id": a["id"], "to_account_id": b["id"],
            "amount": 4000, "txn_date": date.today().isoformat(),
        })
        assert resp.status_code == 200, resp.text
        assert account_balance(client, auth_headers, a["id"]) == pytest.approx(6000)
        assert account_balance(client, auth_headers, b["id"]) == pytest.approx(4000)

    def test_voided_txn_excluded_everywhere(self, client, admin_user, auth_headers):
        """S1/AN1: after voiding, the Accounts page, Analytics overview, Money Flow
        and Forecast must all agree on the balance."""
        acct = make_account(client, auth_headers, name="VoidTest", opening_balance=1000)
        txn = client.post(f"/api/accounts/{acct['id']}/transactions", headers=auth_headers, json={
            "txn_type": "debit", "amount": 400, "txn_date": date.today().isoformat(),
        }).json()
        resp = client.delete(f"/api/accounts/transactions/{txn['id']}", headers=auth_headers)
        assert resp.status_code == 200

        # Accounts page
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(1000)

        # Analytics overview
        overview = client.get("/api/analytics/overview", headers=auth_headers).json()
        ov_balance = next(a["balance"] for a in overview["accounts"] if a["id"] == acct["id"])
        assert ov_balance == pytest.approx(1000), "analytics overview counted a voided txn"

        # Money flow
        flow = client.get("/api/analytics/money-flow", headers=auth_headers,
                          params={"period": "1_month"}).json()
        assert flow["total_out"] == pytest.approx(0), "money-flow counted a voided txn"

        # Forecast starting balances
        fc = client.get("/api/forecast", headers=auth_headers, params={"timeframe": "30d"}).json()
        assert fc["balances"]["total_liquid"] == pytest.approx(1000), (
            "forecast starting balance counted a voided txn")

    def test_accounts_list_matches_analytics_assets(self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, name="Recon", opening_balance=7500)
        client.post(f"/api/accounts/{acct['id']}/transactions", headers=auth_headers, json={
            "txn_type": "credit", "amount": 2500, "txn_date": date.today().isoformat()})

        accounts_total = sum(
            float(a["current_balance"]) for a in
            client.get("/api/accounts", headers=auth_headers).json()
            if a["account_type"] != "credit_card"
        )
        assets = client.get("/api/analytics/assets", headers=auth_headers).json()
        assert assets["assets"]["cash"]["total"] == pytest.approx(accounts_total, abs=0.02), (
            "Accounts page total and Analytics balance-sheet cash disagree")


class TestObligationLedgerDating:
    def test_obligation_initial_ledger_dated_today(self, client, db, admin_user, auth_headers):
        """O1: money moves at creation; the ledger entry must not sit on a future due date."""
        from tests.scenarios.helpers import days_from_today
        acct = make_account(client, auth_headers, name="ObAcct", opening_balance=10000)
        contact = make_contact(db, name="Obligee")
        resp = client.post("/api/obligations", headers=auth_headers, json={
            "obligation_type": "receivable", "contact_id": contact.id,
            "amount": 5000, "reason": "advance",
            "due_date": days_from_today(30), "account_id": acct["id"],
        })
        assert resp.status_code == 200, resp.text
        txns = account_txns(client, auth_headers, acct["id"])
        ob_txn = next(t for t in txns if t["linked_type"] == "obligation")
        assert ob_txn["txn_date"] == date.today().isoformat()
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(5000)
