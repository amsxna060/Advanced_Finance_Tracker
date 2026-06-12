"""Beesi (BC/chit fund) lifecycle: sequential months, late payments,
withdrawal, ledger reversal discipline, validation."""
from datetime import date

import pytest

from tests.scenarios.helpers import (
    make_account, account_balance, account_txns, months_ago,
)


def _make_beesi(client, headers, account_id=None, **overrides):
    payload = {
        "title": "Scenario BC",
        "pot_size": 200000,
        "member_count": 20,
        "tenure_months": 20,
        "base_installment": 10000,
        "start_date": months_ago(4),
    }
    if account_id:
        payload["account_id"] = account_id
    payload.update(overrides)
    resp = client.post("/api/beesi", headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestInstallmentMonths:
    def test_months_are_sequential_even_when_paid_late(self, client, admin_user, auth_headers):
        """B1: paying late must not skip a month and block the real one."""
        b = _make_beesi(client, auth_headers)

        # Months 1 and 2 paid on time
        for n in (4, 3):
            resp = client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
                "payment_date": months_ago(n), "actual_paid": 9500,
            })
            assert resp.status_code == 200, resp.text

        # Month 3's installment paid TODAY (2 months late by calendar)
        resp = client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
            "payment_date": date.today().isoformat(), "actual_paid": 9400,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["month_number"] == 3, (
            "late payment must default to the next unpaid month, not the calendar month")

        # Explicit duplicate must 409
        resp = client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
            "payment_date": date.today().isoformat(), "actual_paid": 9400, "month_number": 3,
        })
        assert resp.status_code == 409

    def test_negative_and_garbage_amounts_rejected(self, client, admin_user, auth_headers):
        b = _make_beesi(client, auth_headers)
        resp = client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
            "payment_date": months_ago(4), "actual_paid": -100,
        })
        assert resp.status_code == 422
        resp = client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
            "payment_date": "not-a-date", "actual_paid": 100,
        })
        assert resp.status_code == 422


class TestLedgerDiscipline:
    def test_lifecycle_ledger_and_pnl(self, client, admin_user, auth_headers):
        acct = make_account(client, auth_headers, name="BC Acct", opening_balance=0)
        b = _make_beesi(client, auth_headers, account_id=acct["id"])

        inst_ids = []
        for n in (4, 3, 2):
            resp = client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
                "payment_date": months_ago(n), "actual_paid": 9500,
            })
            inst_ids.append(resp.json()["id"])
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(-28500)

        # Claim the pot
        resp = client.post(f"/api/beesi/{b['id']}/withdraw", headers=auth_headers, json={
            "withdrawal_date": date.today().isoformat(), "net_received": 180000,
        })
        assert resp.status_code == 200, resp.text
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(151500)

        # P&L view
        summary = client.get(f"/api/beesi/{b['id']}/summary", headers=auth_headers).json()
        assert float(summary["total_invested"]) == pytest.approx(28500)
        assert float(summary["total_withdrawn"]) == pytest.approx(180000)
        assert float(summary["profit_loss"]) == pytest.approx(151500)

    def test_delete_installment_voids_exactly_one_ledger_row(self, client, admin_user, auth_headers):
        """B2: two same-amount same-date rows — deleting one installment must
        leave the other ledger entry alive."""
        acct = make_account(client, auth_headers, name="BC Acct 2", opening_balance=0)
        b = _make_beesi(client, auth_headers, account_id=acct["id"])

        i1 = client.post(f"/api/beesi/{b['id']}/installments", headers=auth_headers, json={
            "payment_date": months_ago(4), "actual_paid": 9500,
        }).json()
        # Manual unrelated entry: same amount, same date
        client.post(f"/api/accounts/{acct['id']}/transactions", headers=auth_headers, json={
            "txn_type": "debit", "amount": 9500, "txn_date": months_ago(4),
            "description": "unrelated manual debit",
        })
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(-19000)

        resp = client.delete(f"/api/beesi/{b['id']}/installments/{i1['id']}",
                             headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert account_balance(client, auth_headers, acct["id"]) == pytest.approx(-9500), (
            "deleting the installment must reverse only ITS ledger row")
