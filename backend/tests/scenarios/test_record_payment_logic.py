"""record_payment logic guards: closed-loan zero-allocation trap,
future-dated payments, and backdated payments re-allocating later ones."""
from datetime import date, timedelta

import pytest

from tests.scenarios.helpers import (
    make_contact, make_loan, pay_loan, loan_detail, months_ago, days_from_today,
)


class TestRecordPaymentGuards:
    def test_payment_on_closed_loan_rejected(self, client, db, admin_user, auth_headers):
        """A closed loan reports zero outstanding → allocation would be all-zero
        and the money would vanish from interest stats. Must 400 instead."""
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=50000, interest_rate=24,
                         disbursed_date=months_ago(2))
        # Overpay → auto-closes
        pay_loan(client, auth_headers, loan["id"], 60000)
        assert loan_detail(client, auth_headers, loan["id"])["loan"]["status"] == "closed"

        resp = client.post(f"/api/loans/{loan['id']}/payments", headers=auth_headers, json={
            "amount_paid": 5000, "payment_date": date.today().isoformat(),
        })
        assert resp.status_code == 400, (
            f"expected 400 on closed loan, got {resp.status_code}: {resp.text}")
        assert "closed" in resp.json()["detail"].lower()

    def test_future_dated_payment_rejected(self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id, disbursed_date=months_ago(1))
        resp = client.post(f"/api/loans/{loan['id']}/payments", headers=auth_headers, json={
            "amount_paid": 1000, "payment_date": days_from_today(5),
        })
        assert resp.status_code == 400
        assert "future" in resp.json()["detail"].lower()

    def test_backdated_payment_reallocates_later_payments(self, client, db, admin_user, auth_headers):
        """Inserting a payment with an older date must re-split payments that
        were recorded earlier but dated later — same invariant as voiding."""
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(3))
        # First record today's payment...
        pay_loan(client, auth_headers, loan["id"], 30000)
        # ...then a BACKDATED one from two months ago
        pay_loan(client, auth_headers, loan["id"], 50000, payment_date=months_ago(2))

        detail = loan_detail(client, auth_headers, loan["id"])
        live = detail["payments"]
        assert len(live) == 2
        principal_alloc = sum(float(p["allocated_to_principal"]) for p in live)
        # Identity: outstanding principal == principal − Σ allocated principal
        assert float(detail["outstanding"]["principal_outstanding"]) == pytest.approx(
            100000 - principal_alloc, abs=0.05), (
            "later payment kept its stale split after a backdated payment was inserted")
