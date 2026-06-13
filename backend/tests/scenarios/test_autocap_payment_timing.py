"""Regression for production loan #41 (Ram Prakash Mall).

A loan with auto-capitalization received ONE lump payment long after the
capitalization date. The old engine applied that payment retroactively to the
oldest months, shrinking the already-happened capitalization — principal
"dropped" below the payment's principal allocation and the loan auto-closed
even though ~₹5k was genuinely still owed.

The fix (L8): payments only offset interest accrued by their payment date;
capitalizations that occurred before the payment are immutable.
"""
import pytest

from tests.scenarios.helpers import (
    make_contact, make_loan, pay_loan, loan_detail, months_ago,
)


class TestAutoCapPaymentTiming:
    def _make_autocap_loan(self, client, db, headers):
        contact = make_contact(db, name="Ram Prakash Mall Repro")
        return make_loan(
            client, headers, contact.id,
            principal_amount=240000, interest_rate=18,
            capitalization_enabled=True, capitalization_after_months=12,
            disbursed_date=months_ago(15),
        )

    def test_late_payment_cannot_rewrite_capitalization(self, client, db, admin_user, auth_headers):
        loan = self._make_autocap_loan(client, db, auth_headers)

        # With zero payments, month-12 capitalization = 12 × ₹3,600 = ₹43,200
        before = loan_detail(client, auth_headers, loan["id"])["outstanding"]
        assert float(before["principal_outstanding"]) == pytest.approx(283200, abs=1)
        total_before = float(before["total_outstanding"])

        # Borrower pays everything EXCEPT ₹5,000 — loan must stay open
        pay_loan(client, auth_headers, loan["id"], round(total_before - 5000, 2))

        detail = loan_detail(client, auth_headers, loan["id"])
        assert detail["loan"]["status"] == "active", (
            "loan auto-closed even though ₹5,000 is still owed — the payment "
            "retroactively rewrote the month-12 capitalization")
        after = detail["outstanding"]
        assert float(after["total_outstanding"]) == pytest.approx(5000, abs=2)

        # Identity: principal after = principal before − principal allocated
        alloc_principal = sum(float(p["allocated_to_principal"]) for p in detail["payments"])
        assert float(after["principal_outstanding"]) == pytest.approx(
            283200 - alloc_principal, abs=1)

    def test_schedule_capitalization_amount_is_payment_date_aware(
            self, client, db, admin_user, auth_headers):
        loan = self._make_autocap_loan(client, db, auth_headers)
        before = loan_detail(client, auth_headers, loan["id"])["outstanding"]
        pay_loan(client, auth_headers, loan["id"],
                 round(float(before["total_outstanding"]) - 5000, 2))

        sched = client.get(f"/api/loans/{loan['id']}/monthly-interest-schedule",
                           headers=auth_headers).json()["schedule"]
        caps = [e for e in sched if e.get("capitalized")]
        assert caps, "capitalization banner missing from schedule"
        assert caps[0]["capitalized_amount"] == pytest.approx(43200, abs=1), (
            "schedule shows a shrunken capitalization — today's payment must not "
            "rewrite last year's capitalization")
        # Pre-cap months were NOT paid at the time → their interest rolled into
        # principal, so they show 'capitalized' (not a misleading red 'Unpaid',
        # and not a false 'paid') with zero interest outstanding.
        pre_cap_rows = sched[:12]
        assert all(r["status"] == "capitalized" for r in pre_cap_rows)
        assert all(r["interest_outstanding"] == 0 for r in pre_cap_rows)
        # The June-style lump payment covers the post-cap months instead
        post_cap_rows = [r for r in sched[12:] if not r["is_current_month"]]
        assert post_cap_rows and all(r["status"] == "paid" for r in post_cap_rows)

    def test_payment_made_before_cap_still_reduces_capitalization(
            self, client, db, admin_user, auth_headers):
        """Symmetry check: money paid BEFORE the cap date must keep reducing it."""
        contact = make_contact(db, name="Early Payer")
        loan = make_loan(
            client, auth_headers, contact.id,
            principal_amount=240000, interest_rate=18,
            capitalization_enabled=True, capitalization_after_months=12,
            disbursed_date=months_ago(15),
        )
        # Pays in month 2 — well before the cap. (The 2x allocation rule sends
        # part to interest, surplus to principal.)
        pay_loan(client, auth_headers, loan["id"], 10800, payment_date=months_ago(13))

        detail = loan_detail(client, auth_headers, loan["id"])
        p = detail["payments"][0]
        interest_paid = (float(p["allocated_to_current_interest"])
                         + float(p["allocated_to_overdue_interest"]))
        principal_paid = float(p["allocated_to_principal"])
        assert interest_paid > 0

        sched = client.get(f"/api/loans/{loan['id']}/monthly-interest-schedule",
                           headers=auth_headers).json()["schedule"]
        caps = [e for e in sched if e.get("capitalized")]
        assert caps, "capitalization banner missing"
        cap_amount = caps[0]["capitalized_amount"]
        # An early payment must reduce the capitalization below the no-payment 43,200
        assert cap_amount < 43200 - interest_paid + 1
        # Identity: capitalized = interest accrued in the first 12 rows − interest paid
        accrued_12 = sum(r["interest_due"] for r in sched[:12])
        assert cap_amount == pytest.approx(accrued_12 - interest_paid, abs=1)

        # Identity: outstanding principal = original − principal repaid + capitalized
        out = detail["outstanding"]
        assert float(out["principal_outstanding"]) == pytest.approx(
            240000 - principal_paid + cap_amount, abs=1)
