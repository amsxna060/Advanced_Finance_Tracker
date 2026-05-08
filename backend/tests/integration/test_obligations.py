"""
Integration tests for /api/obligations/* endpoints.

The actual model uses obligation_type (receivable/payable), not direction.
Schema: ObligationCreate requires obligation_type, contact_id, amount.
"""

import pytest


def _create_contact(client, auth_headers, name="Obligation Contact"):
    resp = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "individual", "relationship_type": "partner"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    return resp.json()["id"]


class TestObligationCreate:
    def test_create_receivable(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Receivable Contact")
        payload = {
            "obligation_type": "receivable",
            "contact_id": cid,
            "amount": 25000,
            "reason": "Loan repayment",
            "due_date": "2024-06-30",
        }
        resp = client.post("/api/obligations", json=payload, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["obligation_type"] == "receivable"
        assert float(body["amount"]) == 25000.0

    def test_create_payable(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Payable Contact")
        payload = {
            "obligation_type": "payable",
            "contact_id": cid,
            "amount": 15000,
            "reason": "Borrowed for emergency",
        }
        resp = client.post("/api/obligations", json=payload, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["obligation_type"] == "payable"

    def test_create_obligation_contact_not_found(self, client, admin_user, auth_headers):
        payload = {
            "obligation_type": "receivable",
            "contact_id": 99999,
            "amount": 5000,
        }
        resp = client.post("/api/obligations", json=payload, headers=auth_headers)
        assert resp.status_code == 404


class TestObligationList:
    def test_list_obligations_returns_200(self, client, admin_user, auth_headers):
        resp = client.get("/api/obligations", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/obligations")
        assert resp.status_code == 401


class TestObligationSettle:
    def test_settle_obligation(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Settlement Contact")
        payload = {
            "obligation_type": "receivable",
            "contact_id": cid,
            "amount": 10000,
        }
        create_resp = client.post("/api/obligations", json=payload, headers=auth_headers)
        ob_id = create_resp.json()["id"]

        settle_payload = {
            "amount": 10000,
            "settlement_date": "2024-04-01",
            "payment_mode": "bank_transfer",
        }
        resp = client.post(f"/api/obligations/{ob_id}/settle", json=settle_payload, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert float(body["amount"]) == 10000.0

    def test_settle_obligation_updates_status(self, client, admin_user, auth_headers):
        """After full settlement the obligation status should be 'settled'."""
        cid = _create_contact(client, auth_headers, "Status Check Contact")
        payload = {
            "obligation_type": "payable",
            "contact_id": cid,
            "amount": 5000,
        }
        create_resp = client.post("/api/obligations", json=payload, headers=auth_headers)
        ob_id = create_resp.json()["id"]

        client.post(
            f"/api/obligations/{ob_id}/settle",
            json={"amount": 5000, "settlement_date": "2024-04-15"},
            headers=auth_headers,
        )

        # Fetch the updated obligation
        get_resp = client.get(f"/api/obligations/{ob_id}", headers=auth_headers)
        assert get_resp.status_code == 200
        ob_data = get_resp.json()["obligation"]
        assert ob_data["status"] == "settled"

    def test_partial_settlement_status_is_partial(self, client, admin_user, auth_headers):
        cid = _create_contact(client, auth_headers, "Partial Settle Contact")
        payload = {
            "obligation_type": "receivable",
            "contact_id": cid,
            "amount": 20000,
        }
        create_resp = client.post("/api/obligations", json=payload, headers=auth_headers)
        ob_id = create_resp.json()["id"]

        client.post(
            f"/api/obligations/{ob_id}/settle",
            json={"amount": 5000, "settlement_date": "2024-04-20"},
            headers=auth_headers,
        )

        get_resp = client.get(f"/api/obligations/{ob_id}", headers=auth_headers)
        ob_data = get_resp.json()["obligation"]
        assert ob_data["status"] == "partial"
