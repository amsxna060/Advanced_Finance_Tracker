"""
Integration tests for /api/beesi/* endpoints.

The Beesi model (in the actual codebase) uses: title, pot_size, member_count,
tenure_months, base_installment, start_date.
Installments require: payment_date, actual_paid.
Withdrawals require: withdrawal_date, gross_amount, net_received, month_number.
"""

import pytest


_BASE_BEESI = {
    "title": "Test BC 2024",
    "pot_size": 200000,
    "member_count": 20,
    "tenure_months": 20,
    "base_installment": 10000,
    "start_date": "2024-01-01",
}


class TestBeesiCreate:
    def test_create_beesi_returns_200(self, client, admin_user, auth_headers):
        resp = client.post("/api/beesi", json=_BASE_BEESI, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert body["title"] == "Test BC 2024"

    def test_unauthenticated_create_returns_401(self, client):
        resp = client.post("/api/beesi", json=_BASE_BEESI)
        assert resp.status_code == 401


class TestBeesiGet:
    def test_get_beesi_detail(self, client, admin_user, auth_headers):
        create_resp = client.post("/api/beesi", json=_BASE_BEESI, headers=auth_headers)
        beesi_id = create_resp.json()["id"]

        resp = client.get(f"/api/beesi/{beesi_id}", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == beesi_id
        assert "installments" in body
        assert "withdrawals" in body

    def test_get_nonexistent_beesi_returns_404(self, client, admin_user, auth_headers):
        resp = client.get("/api/beesi/99999", headers=auth_headers)
        assert resp.status_code == 404

    def test_list_beesi_returns_200(self, client, admin_user, auth_headers):
        resp = client.get("/api/beesi", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestBeesiInstallment:
    def test_add_installment_returns_200(self, client, admin_user, auth_headers):
        create_resp = client.post("/api/beesi", json=_BASE_BEESI, headers=auth_headers)
        beesi_id = create_resp.json()["id"]

        payload = {
            "payment_date": "2024-01-15",
            "actual_paid": 10000,
        }
        resp = client.post(f"/api/beesi/{beesi_id}/installments", json=payload, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert float(body["actual_paid"]) == 10000.0


class TestBeesiWithdrawal:
    def test_add_withdrawal_returns_200(self, client, admin_user, auth_headers):
        create_resp = client.post("/api/beesi", json=_BASE_BEESI, headers=auth_headers)
        beesi_id = create_resp.json()["id"]

        payload = {
            "withdrawal_date": "2024-03-01",
            "gross_amount": 200000,
            "discount_offered": 5000,
            "net_received": 195000,
            "month_number": 3,
        }
        resp = client.post(f"/api/beesi/{beesi_id}/withdraw", json=payload, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert float(body["net_received"]) == 195000.0
