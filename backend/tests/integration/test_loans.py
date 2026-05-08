"""
Integration tests for /api/loans/* endpoints.
"""

import pytest
from datetime import date


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_contact(client, auth_headers, name="Test Contact"):
    resp = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "individual", "relationship_type": "borrower"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    return resp.json()["id"]


def _interest_only_payload(contact_id):
    return {
        "contact_id": contact_id,
        "loan_direction": "given",
        "loan_type": "interest_only",
        "principal_amount": 100000,
        "disbursed_date": "2024-01-01",
        "interest_rate": 12.0,
        "interest_start_date": "2024-01-01",
    }


def _emi_payload(contact_id):
    return {
        "contact_id": contact_id,
        "loan_direction": "given",
        "loan_type": "emi",
        "principal_amount": 120000,
        "disbursed_date": "2024-01-01",
        "emi_amount": 11000,
        "tenure_months": 12,
    }


def _short_term_payload(contact_id):
    return {
        "contact_id": contact_id,
        "loan_direction": "taken",
        "loan_type": "short_term",
        "principal_amount": 50000,
        "disbursed_date": "2024-01-01",
        "interest_free_till": "2024-06-30",
        "post_due_interest_rate": 18.0,
    }


# ---------------------------------------------------------------------------
# Loan creation
# ---------------------------------------------------------------------------

class TestCreateLoan:
    def test_create_interest_only_loan(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Borrower A")
        resp = client.post("/api/loans", json=_interest_only_payload(cid), headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["loan_type"] == "interest_only"
        assert body["principal_amount"] == "100000.00"

    def test_create_emi_loan(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "EMI Borrower")
        resp = client.post("/api/loans", json=_emi_payload(cid), headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["loan_type"] == "emi"
        assert body["tenure_months"] == 12

    def test_create_short_term_loan(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Short Term Borrower")
        resp = client.post("/api/loans", json=_short_term_payload(cid), headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["loan_type"] == "short_term"

    def test_create_emi_missing_tenure_returns_400(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Bad EMI Borrower")
        payload = {
            "contact_id": cid,
            "loan_direction": "given",
            "loan_type": "emi",
            "principal_amount": 100000,
            "disbursed_date": "2024-01-01",
            "emi_amount": 9000,
            # tenure_months missing
        }
        resp = client.post("/api/loans", json=payload, headers=auth_headers)
        assert resp.status_code in (400, 422)

    def test_create_interest_only_missing_rate_returns_400(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "No Rate Borrower")
        payload = {
            "contact_id": cid,
            "loan_direction": "given",
            "loan_type": "interest_only",
            "principal_amount": 100000,
            "disbursed_date": "2024-01-01",
            # interest_rate missing
        }
        resp = client.post("/api/loans", json=payload, headers=auth_headers)
        assert resp.status_code in (400, 422)

    def test_create_loan_contact_not_found(self, client, admin_user, auth_headers):
        payload = _interest_only_payload(99999)  # non-existent contact
        resp = client.post("/api/loans", json=payload, headers=auth_headers)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Loan list / filter
# ---------------------------------------------------------------------------

class TestListLoans:
    def test_list_loans_returns_200(self, client, admin_user, auth_headers):
        resp = client.get("/api/loans", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_loans_filter_direction(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Filter Contact")
        client.post("/api/loans", json=_interest_only_payload(cid), headers=auth_headers)
        client.post("/api/loans", json=_short_term_payload(cid), headers=auth_headers)

        resp_given = client.get("/api/loans?direction=given", headers=auth_headers)
        assert resp_given.status_code == 200
        for loan in resp_given.json():
            assert loan["loan_direction"] == "given"

        resp_taken = client.get("/api/loans?direction=taken", headers=auth_headers)
        assert resp_taken.status_code == 200
        for loan in resp_taken.json():
            assert loan["loan_direction"] == "taken"


# ---------------------------------------------------------------------------
# Loan detail / outstanding
# ---------------------------------------------------------------------------

class TestLoanDetail:
    def test_get_loan_outstanding_has_required_keys(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Outstanding Test")
        create_resp = client.post("/api/loans", json=_interest_only_payload(cid), headers=auth_headers)
        loan_id = create_resp.json()["id"]

        resp = client.get(f"/api/loans/{loan_id}", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "outstanding" in body
        outstanding = body["outstanding"]
        assert "interest_outstanding" in outstanding
        assert "principal_outstanding" in outstanding


# ---------------------------------------------------------------------------
# Loan payment
# ---------------------------------------------------------------------------

class TestLoanPayment:
    def test_add_payment_to_loan(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Payment Contact")
        create_resp = client.post("/api/loans", json=_interest_only_payload(cid), headers=auth_headers)
        loan_id = create_resp.json()["id"]

        payment_payload = {
            "payment_date": "2024-02-01",
            "amount_paid": 1000,
            "payment_mode": "cash",
        }
        resp = client.post(f"/api/loans/{loan_id}/payments", json=payment_payload, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert float(body["amount_paid"]) == 1000.0


# ---------------------------------------------------------------------------
# Regression tests
# ---------------------------------------------------------------------------

class TestRegressions:
    def test_soft_deleted_loan_not_in_list(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Deleted Loan Contact")
        create_resp = client.post("/api/loans", json=_interest_only_payload(cid), headers=auth_headers)
        loan_id = create_resp.json()["id"]

        del_resp = client.delete(f"/api/loans/{loan_id}", headers=auth_headers)
        assert del_resp.status_code == 200

        list_resp = client.get("/api/loans", headers=auth_headers)
        ids = [l["id"] for l in list_resp.json()]
        assert loan_id not in ids

    def test_closed_loan_outstanding_is_zero(self, client, admin_user, auth_headers, db):
        """Manually close a loan and verify its outstanding returns zeros."""
        from app.models.loan import Loan

        cid = _create_contact(client, auth_headers, "Closed Loan Contact")
        create_resp = client.post("/api/loans", json=_interest_only_payload(cid), headers=auth_headers)
        loan_id = create_resp.json()["id"]

        # Directly close via DB within the test transaction
        loan = db.query(Loan).filter(Loan.id == loan_id).first()
        loan.status = "closed"
        db.flush()

        resp = client.get(f"/api/loans/{loan_id}", headers=auth_headers)
        assert resp.status_code == 200
        outstanding = resp.json()["outstanding"]
        assert float(outstanding["interest_outstanding"]) == 0.0
        assert float(outstanding["total_outstanding"]) == 0.0
