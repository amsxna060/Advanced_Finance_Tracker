"""Cross-screen consistency: the dashboard, analytics and module pages must
tell the same story — especially after voids/deletes."""
from datetime import date

import pytest

from tests.scenarios.helpers import (
    make_account, make_contact, make_loan, pay_loan,
    make_property, make_partnership, add_member, add_partnership_txn,
    months_ago,
)


class TestVoidedDataConsistency:
    def test_v2_interest_earned_excludes_voided_payment(self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(3))
        p = pay_loan(client, auth_headers, loan["id"], 6000, payment_date=months_ago(1))

        v2 = client.get("/api/dashboard/v2", headers=auth_headers).json()
        earned_before = v2["lending"]["total_interest_earned"]
        assert earned_before > 0

        client.delete(f"/api/loans/{loan['id']}/payments/{p['id']}", headers=auth_headers)

        v2 = client.get("/api/dashboard/v2", headers=auth_headers).json()
        assert v2["lending"]["total_interest_earned"] == pytest.approx(0, abs=0.01), (
            "voided payment still counted in dashboard interest earned")
        assert v2["this_month"]["total_collected"] == pytest.approx(0, abs=0.01)

    def test_v2_expenses_exclude_deleted(self, client, admin_user, auth_headers):
        e = client.post("/api/expenses", headers=auth_headers, json={
            "amount": 1500, "expense_date": date.today().isoformat(),
            "category": "Food", "description": "test dinner",
        }).json()

        v2 = client.get("/api/dashboard/v2", headers=auth_headers).json()
        assert v2["expenses"]["this_month_total"] == pytest.approx(1500)

        client.delete(f"/api/expenses/{e['id']}", headers=auth_headers)
        v2 = client.get("/api/dashboard/v2", headers=auth_headers).json()
        assert v2["expenses"]["this_month_total"] == pytest.approx(0), (
            "deleted expense still on the dashboard expense card")

        # Expense analytics agrees
        summary = client.get("/api/expenses/analytics/summary", headers=auth_headers).json()
        assert float(summary["grand_total"]) == pytest.approx(0)

    def test_summary_and_v2_agree_on_outstanding(self, client, db, admin_user, auth_headers):
        """D1: both dashboards must report the same receivable."""
        contact = make_contact(db)
        make_loan(client, auth_headers, contact.id,
                  principal_amount=50000, interest_rate=24, disbursed_date=months_ago(2))

        legacy = client.get("/api/dashboard/summary", headers=auth_headers).json()
        v2 = client.get("/api/dashboard/v2", headers=auth_headers).json()
        assert float(legacy["total_outstanding_receivable"]) == pytest.approx(
            v2["lending"]["total_outstanding"], abs=0.02)


class TestPartnershipCashflowVisibility:
    def test_new_style_partnership_txn_appears_in_v2_cashflow(
            self, client, db, admin_user, auth_headers):
        """D2: advance_to_seller (new vocabulary) must show as outflow."""
        prop = make_property(client, auth_headers)
        p = make_partnership(client, auth_headers, property_id=prop["id"])
        self_m = add_member(client, auth_headers, p["id"], 100, is_self=True)
        add_partnership_txn(client, auth_headers, p["id"], "advance_to_seller", 75000,
                            member_id=self_m["id"])

        v2 = client.get("/api/dashboard/v2", headers=auth_headers).json()
        this_month = date.today().strftime("%b")
        bucket = next(c for c in v2["cashflow"] if c["month"] == this_month)
        assert bucket["outflow"] >= 75000, (
            "new-style partnership transaction missing from dashboard cashflow")

    def test_buyer_money_forwarded_to_seller_not_counted_as_inflow(
            self, client, db, admin_user, auth_headers):
        prop = make_property(client, auth_headers)
        p = make_partnership(client, auth_headers, property_id=prop["id"])
        self_m = add_member(client, auth_headers, p["id"], 100, is_self=True)
        resp = client.post(f"/api/partnerships/{p['id']}/create-buyer",
                           headers=auth_headers,
                           json={"name": "B2", "area_sqft": 500, "rate_per_sqft": 700})
        buyer = resp.json()["plot_buyer"]
        add_partnership_txn(client, auth_headers, p["id"], "buyer_payment", 120000,
                            received_by_member_id=self_m["id"],
                            plot_buyer_id=buyer["id"], paid_to_seller=True)

        v2 = client.get("/api/dashboard/v2", headers=auth_headers).json()
        this_month = date.today().strftime("%b")
        bucket = next(c for c in v2["cashflow"] if c["month"] == this_month)
        assert bucket["inflow"] == pytest.approx(0, abs=0.01), (
            "pass-through buyer→seller money never touched our cash")


class TestLegacyCashflowEndpoint:
    @pytest.mark.xfail(reason="GET /api/dashboard/cashflow uses Postgres-only "
                              "func.to_char — fails on the SQLite dev DB (works on prod PG). "
                              "Needs a dialect-neutral month key to be testable here.")
    def test_legacy_cashflow_endpoint_works_on_dev_db(self, client, admin_user, auth_headers):
        resp = client.get("/api/dashboard/cashflow", headers=auth_headers)
        assert resp.status_code == 200


class TestNetWorthSanity:
    def test_beesi_withdrawal_not_double_counted(self, client, admin_user, auth_headers):
        """D3: after claiming the pot, net worth must not count the cash twice."""
        acct = make_account(client, auth_headers, name="NW Acct", opening_balance=0)
        b = client.post("/api/beesi", headers=auth_headers, json={
            "title": "NW BC", "pot_size": 100000, "member_count": 10,
            "tenure_months": 10, "base_installment": 10000,
            "start_date": months_ago(2), "account_id": acct["id"],
        }).json()
        client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
            "payment_date": months_ago(2), "actual_paid": 10000})
        client.post(f"/api/beesi/{b['id']}/withdraw", headers=auth_headers, json={
            "withdrawal_date": date.today().isoformat(), "net_received": 90000})

        ov = client.get("/api/analytics/overview", headers=auth_headers).json()
        # Cash = −10000 + 90000 = 80000. Beesi already fully withdrawn → no
        # residual beesi asset. Net worth must equal cash here.
        assert ov["total_cash"] == pytest.approx(80000)
        assert ov["net_worth"] == pytest.approx(80000, abs=0.02), (
            f"net worth {ov['net_worth']} double-counts the withdrawn pot")

    def test_active_beesi_counts_as_asset(self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, name="NW Acct 2", opening_balance=50000)
        b = client.post("/api/beesi", headers=auth_headers, json={
            "title": "NW BC 2", "pot_size": 100000, "member_count": 10,
            "tenure_months": 10, "base_installment": 10000,
            "start_date": months_ago(1), "account_id": acct["id"],
        }).json()
        client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
            "payment_date": months_ago(1), "actual_paid": 10000})

        ov = client.get("/api/analytics/overview", headers=auth_headers).json()
        # Cash 40000 + beesi receivable 10000 → net worth unchanged at 50000
        assert ov["total_cash"] == pytest.approx(40000)
        assert ov["net_worth"] == pytest.approx(50000, abs=0.02), (
            "money paid into an active beesi should remain on the balance sheet")
