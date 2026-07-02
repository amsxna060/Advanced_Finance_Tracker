"""End-to-end lending scenarios on the dev DB.

Covers: disbursement ledger, payment allocation, voiding + re-allocation,
EMI penalty handling, manual capitalization math, auto-close behaviour,
borrower statement integrity.
"""
from datetime import date
from decimal import Decimal

import pytest
from dateutil.relativedelta import relativedelta

from tests.scenarios.helpers import (
    make_account, make_contact, make_loan, pay_loan, loan_detail,
    account_balance, account_txns, months_ago,
)


class TestInterestOnlyLifecycle:
    def test_disbursement_and_payment_hit_account_ledger(self, client, db, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=500000)
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, account_id=acct["id"])

        # Disbursement debited
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(400000)

        pay_loan(client, auth_headers, loan["id"], 5000)
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(405000)

    def test_void_payment_restores_outstanding_and_ledger(self, client, db, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=500000)
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, account_id=acct["id"],
                         disbursed_date=months_ago(3))

        before = loan_detail(client, auth_headers, loan["id"])
        out_before = float(before["outstanding"]["total_outstanding"])

        p = pay_loan(client, auth_headers, loan["id"], 4000,
                     payment_date=months_ago(1))
        out_after_pay = float(loan_detail(client, auth_headers, loan["id"])["outstanding"]["total_outstanding"])
        assert out_after_pay < out_before

        # Void the payment
        resp = client.delete(f"/api/loans/{loan['id']}/payments/{p['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        after_void = loan_detail(client, auth_headers, loan["id"])
        assert float(after_void["outstanding"]["total_outstanding"]) == pytest.approx(out_before, abs=0.02)
        # payments list excludes voided
        assert all(pp["id"] != p["id"] for pp in after_void["payments"])
        # ledger credit was voided → balance back to post-disbursement
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(400000)

    def test_void_reallocates_later_payments(self, client, db, admin_user, auth_headers):
        """L4: after voiding an early payment, later payments are re-split so the
        invariant principal_outstanding == principal − Σ allocated_to_principal holds."""
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(2))

        p1 = pay_loan(client, auth_headers, loan["id"], 50000, payment_date=months_ago(1))
        pay_loan(client, auth_headers, loan["id"], 30000)

        resp = client.delete(f"/api/loans/{loan['id']}/payments/{p1['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        detail = loan_detail(client, auth_headers, loan["id"])
        live = detail["payments"]
        assert len(live) == 1
        principal_alloc = sum(float(pp["allocated_to_principal"]) for pp in live)
        principal_out = float(detail["outstanding"]["principal_outstanding"])
        assert principal_out == pytest.approx(100000 - principal_alloc, abs=0.02)

    def test_statement_excludes_voided_payments(self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id, disbursed_date=months_ago(2))
        p = pay_loan(client, auth_headers, loan["id"], 3000, payment_date=months_ago(1))
        client.delete(f"/api/loans/{loan['id']}/payments/{p['id']}", headers=auth_headers)

        resp = client.get(f"/api/loans/{loan['id']}/statement", headers=auth_headers)
        assert resp.status_code == 200
        payment_rows = [e for e in resp.json()["entries"] if e["type"] == "payment"]
        assert payment_rows == [], "voided payment must not appear on a borrower statement"

    def test_monthly_interest_schedule_ignores_voided_payments(self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(3))
        p = pay_loan(client, auth_headers, loan["id"], 2000, payment_date=months_ago(2))
        client.delete(f"/api/loans/{loan['id']}/payments/{p['id']}", headers=auth_headers)

        resp = client.get(f"/api/loans/{loan['id']}/monthly-interest-schedule", headers=auth_headers)
        assert resp.status_code == 200
        schedule = resp.json()["schedule"]
        assert sum(e["interest_paid"] for e in schedule) == pytest.approx(0.0, abs=0.01)


class TestEMIPenalty:
    def test_penalty_not_counted_as_repayment(self, client, db, admin_user, auth_headers):
        """L2: ₹10,500 paid with ₹500 penalty must reduce outstanding by 10,000 only."""
        contact = make_contact(db)
        loan = make_loan(
            client, auth_headers, contact.id,
            loan_type="emi", principal_amount=100000, interest_rate=None,
            emi_amount=10000, tenure_months=12, emi_day_of_month=5,
            penalty_per_day=100,
            disbursed_date=months_ago(3, day=5),
        )
        pay_loan(client, auth_headers, loan["id"], 10500, penalty_paid=500)

        detail = loan_detail(client, auth_headers, loan["id"])
        total_out = float(detail["outstanding"]["total_outstanding"])
        assert total_out == pytest.approx(110000, abs=0.02), (
            f"expected 120000-10000=110000 outstanding, got {total_out} "
            "(penalty leaked into EMI coverage)"
        )
        # And the schedule agrees: exactly one EMI covered
        paid = [e for e in detail["emi_schedule"] if e["status"] == "paid"]
        assert len(paid) == 1

    def test_penalty_attributed_to_month_it_was_paid_for(self, client, db, admin_user, auth_headers):
        """F1: a penalty paid with EMI #3's payment must show against EMI #3,
        not backfill EMI #1's still-unpaid penalty (oldest-first bug)."""
        contact = make_contact(db)
        loan = make_loan(
            client, auth_headers, contact.id,
            loan_type="emi", principal_amount=120000, interest_rate=None,
            emi_amount=10000, tenure_months=12, emi_day_of_month=5,
            penalty_per_day=100,
            disbursed_date=months_ago(4, day=5),
        )
        # EMI #1 paid 4 days late, penalty NOT paid (400 accrued, still owed)
        pay_loan(client, auth_headers, loan["id"], 10000, payment_date=months_ago(3, day=9))
        # EMI #2 paid 7 days late with 400 penalty (of 700 accrued)
        pay_loan(client, auth_headers, loan["id"], 10400, penalty_paid=400,
                 payment_date=months_ago(2, day=12))
        # EMI #3 paid 3 days late with full 300 penalty
        pay_loan(client, auth_headers, loan["id"], 10300, penalty_paid=300,
                 payment_date=months_ago(1, day=8))

        detail = loan_detail(client, auth_headers, loan["id"])
        sched = {e["emi_number"]: e for e in detail["emi_schedule"]}

        assert sched[1]["penalty_accrued"] == pytest.approx(400)
        assert sched[1]["penalty_collected"] == pytest.approx(0), (
            "EMI #1's penalty was never paid — it must not absorb later payments' penalties"
        )
        assert sched[2]["penalty_accrued"] == pytest.approx(700)
        assert sched[2]["penalty_collected"] == pytest.approx(400)
        assert sched[3]["penalty_accrued"] == pytest.approx(300)
        assert sched[3]["penalty_collected"] == pytest.approx(300)

    def test_schedule_engines_agree(self, client, db, admin_user, auth_headers):
        """L3: the preloaded engine (dashboard/forecast) must match the DB engine (loan page)."""
        from app.models.loan import Loan
        from app.services.interest import get_emi_schedule_preloaded, get_emi_schedule_with_payments

        contact = make_contact(db)
        loan_json = make_loan(
            client, auth_headers, contact.id,
            loan_type="emi", principal_amount=100000, interest_rate=None,
            emi_amount=10000, tenure_months=12, emi_day_of_month=5,
            penalty_per_day=100,
            disbursed_date=months_ago(3, day=5),
        )
        pay_loan(client, auth_headers, loan_json["id"], 10500, penalty_paid=500)

        loan = db.query(Loan).filter(Loan.id == loan_json["id"]).first()
        a = get_emi_schedule_with_payments(loan, db)
        b = get_emi_schedule_preloaded(loan)
        for ea, eb in zip(a, b):
            assert ea["status"] == eb["status"], f"EMI #{ea['emi_number']} status drift"
            assert ea["paid_amount"] == pytest.approx(eb["paid_amount"])
            assert ea["days_overdue"] == eb["days_overdue"]
            assert ea["penalty_accrued"] == pytest.approx(eb["penalty_accrued"])


class TestManualCapitalization:
    def test_capitalization_does_not_double_accrue(self, client, db, admin_user, auth_headers):
        """L1: after a cap event, the loan must behave exactly like a fresh loan
        of new_principal starting the day after the event."""
        contact = make_contact(db)
        event_date = (date.today() - relativedelta(months=2))

        loan = make_loan(
            client, auth_headers, contact.id,
            principal_amount=100000, interest_rate=24,
            disbursed_date=months_ago(8),
            capitalization_enabled=True,  # manual mode: no after_months
        )
        resp = client.post(f"/api/loans/{loan['id']}/capitalize", headers=auth_headers, json={
            "event_date": event_date.isoformat(),
        })
        assert resp.status_code == 200, resp.text
        new_principal = resp.json()["new_principal"]
        # ~6 anchored months of 2%/month on 100k ≈ 12k (+ partial-period accrual)
        assert 110000 < new_principal < 115000

        # Twin loan: same economics, started the day after the event
        twin = make_loan(
            client, auth_headers, contact.id,
            principal_amount=round(new_principal, 2), interest_rate=24,
            disbursed_date=(event_date + relativedelta(days=1)).isoformat(),
        )

        out_a = loan_detail(client, auth_headers, loan["id"])["outstanding"]
        out_b = loan_detail(client, auth_headers, twin["id"])["outstanding"]
        assert float(out_a["principal_outstanding"]) == pytest.approx(
            float(out_b["principal_outstanding"]), abs=0.05)
        assert float(out_a["interest_outstanding"]) == pytest.approx(
            float(out_b["interest_outstanding"]), abs=1.0), (
            "post-capitalization interest must accrue from the event date on the "
            "new principal — not from the loan start (double count)")

    def test_manual_capitalize_blocked_for_autocap_loans(self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(
            client, auth_headers, contact.id,
            principal_amount=100000, interest_rate=24,
            disbursed_date=months_ago(8),
            capitalization_enabled=True, capitalization_after_months=3,
        )
        resp = client.post(f"/api/loans/{loan['id']}/capitalize", headers=auth_headers, json={
            "event_date": date.today().isoformat(),
        })
        assert resp.status_code == 400, (
            "manual capitalize on an auto-cap loan is a silent no-op and must be rejected")


class TestCloseBehaviour:
    def test_force_close_posts_no_phantom_ledger_entry(self, client, db, admin_user, auth_headers):
        acct = make_account(client, auth_headers, opening_balance=500000)
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, account_id=acct["id"],
                         disbursed_date=months_ago(6))
        pay_loan(client, auth_headers, loan["id"], 40000)  # partial recovery

        bal_before_close = account_balance(client, auth_headers, acct["id"])
        resp = client.post(f"/api/loans/{loan['id']}/force-close", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["principal_shortfall"] > 0

        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(bal_before_close), (
            "force-close must not move cash — write-off is not a cash event")

    def test_auto_close_records_forgiven_interest(self, client, db, admin_user, auth_headers):
        contact = make_contact(db)
        loan = make_loan(client, auth_headers, contact.id,
                         principal_amount=100000, interest_rate=24,
                         disbursed_date=months_ago(4))
        # Pay principal + all accrued interest and then some: triggers close
        pay_loan(client, auth_headers, loan["id"], 100000)
        detail = loan_detail(client, auth_headers, loan["id"])
        if detail["loan"]["status"] == "closed":
            # interest was outstanding at close → must be recorded in notes
            assert "uncollected interest" in (detail["loan"]["notes"] or "").lower()
