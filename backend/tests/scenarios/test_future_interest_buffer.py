"""Future-interest buffer for interest-only loans (end-to-end through the API).

A borrower paying next month's interest in advance must NOT shrink the
principal; only clearly-larger excess reduces principal, after which future
interest accrues on the lower balance.
"""
import pytest

from tests.scenarios.helpers import (
    make_contact, make_loan, pay_loan, loan_detail, months_ago, days_from_today,
)


class TestFutureInterestBuffer:
    def test_prepaid_future_interest_does_not_touch_principal(
            self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(1))
        out = loan_detail(client, auth_headers, loan["id"])["outstanding"]
        accrued = float(out["interest_outstanding"])
        assert accrued > 0

        # Pay accrued + a small extra well within one future month (₹2000/mo here)
        p = pay_loan(client, auth_headers, loan["id"], round(accrued + 800, 2))
        assert float(p["allocated_to_principal"]) == 0, (
            "a small future-interest prepayment must not reduce principal")

        after = loan_detail(client, auth_headers, loan["id"])["outstanding"]
        assert float(after["principal_outstanding"]) == pytest.approx(100000, abs=0.5)

    def test_prepaid_two_months_still_protects_principal(
            self, client, db, admin_user, auth_headers):
        """Default buffer = 2 months, so prepaying ~2 months keeps principal intact."""
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(1))
        out = loan_detail(client, auth_headers, loan["id"])["outstanding"]
        accrued = float(out["interest_outstanding"])
        # monthly on 100k @24% = 2000; ~2 months prepaid = 4000 (leave a margin)
        p = pay_loan(client, auth_headers, loan["id"], round(accrued + 3800, 2))
        assert float(p["allocated_to_principal"]) == 0
        after = loan_detail(client, auth_headers, loan["id"])["outstanding"]
        assert float(after["principal_outstanding"]) == pytest.approx(100000, abs=0.5)

    def test_large_excess_reduces_principal_and_lowers_future_interest(
            self, client, db, admin_user, auth_headers):
        c1 = make_contact(db, name="Paid Down")
        c2 = make_contact(db, name="Reference")
        base = dict(principal_amount=100000, interest_rate=24, disbursed_date=months_ago(2))
        loan_paid = make_loan(client, auth_headers, c1.id, **base)
        loan_ref = make_loan(client, auth_headers, c2.id, **base)

        out = loan_detail(client, auth_headers, loan_paid["id"])["outstanding"]
        accrued = float(out["interest_outstanding"])
        # leftover 50,000 ≫ buffer → a clear principal paydown, all of it to principal
        p = pay_loan(client, auth_headers, loan_paid["id"], round(accrued + 50000, 2))
        assert float(p["allocated_to_principal"]) == pytest.approx(50000, abs=1)

        after = loan_detail(client, auth_headers, loan_paid["id"])["outstanding"]
        assert float(after["principal_outstanding"]) == pytest.approx(50000, abs=1)

        # Future interest now accrues on the lower balance: project ~40 days out
        future = days_from_today(40)
        o_paid = client.get(f"/api/loans/{loan_paid['id']}/outstanding",
                            params={"as_of_date": future}, headers=auth_headers).json()
        o_ref = client.get(f"/api/loans/{loan_ref['id']}/outstanding",
                           params={"as_of_date": future}, headers=auth_headers).json()
        assert float(o_paid["principal_outstanding"]) == pytest.approx(50000, abs=1)
        assert float(o_ref["principal_outstanding"]) == pytest.approx(100000, abs=1)
        # Paid-down loan accrues less future interest (smaller principal + prepaid credit)
        assert float(o_paid["interest_outstanding"]) < float(o_ref["interest_outstanding"])

    def test_explicit_principal_repayment_bypasses_buffer(
            self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(1))
        # Preview with explicit principal_repayment must allocate to principal
        resp = client.get(f"/api/loans/{loan['id']}/payment-preview", headers=auth_headers,
                          params={"amount": 20000, "principal_repayment": 15000})
        assert resp.status_code == 200, resp.text
        assert float(resp.json()["allocated_to_principal"]) == pytest.approx(15000, abs=1)
