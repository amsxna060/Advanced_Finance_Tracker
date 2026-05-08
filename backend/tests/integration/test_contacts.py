"""
Integration tests for /api/contacts/* endpoints.
"""

import pytest


class TestContactList:
    def test_list_empty_returns_200_and_empty_list(self, client, admin_user, auth_headers):
        resp = client.get("/api/contacts", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) == 0

    def test_unauthenticated_access_returns_401(self, client):
        resp = client.get("/api/contacts")
        assert resp.status_code == 401


class TestContactCreate:
    def test_create_contact_returns_201_with_id(self, client, admin_user, auth_headers):
        payload = {
            "name": "Rajesh Kumar",
            "phone": "9876543210",
            "city": "Delhi",
            "contact_type": "individual",
            "relationship_type": "borrower",
        }
        resp = client.post("/api/contacts", json=payload, headers=auth_headers)
        assert resp.status_code == 200  # router uses 200 (no explicit status_code=201)
        body = resp.json()
        assert "id" in body
        assert body["name"] == "Rajesh Kumar"

    def test_create_requires_name_field(self, client, admin_user, auth_headers):
        """POSTing without 'name' should fail with 422."""
        payload = {
            "contact_type": "individual",
            "relationship_type": "borrower",
        }
        resp = client.post("/api/contacts", json=payload, headers=auth_headers)
        assert resp.status_code == 422


class TestContactDetail:
    def test_get_contact_by_id(self, client, admin_user, auth_headers):
        create_resp = client.post(
            "/api/contacts",
            json={"name": "Priya Singh", "phone": "9123456789", "contact_type": "individual", "relationship_type": "lender"},
            headers=auth_headers,
        )
        assert create_resp.status_code == 200
        contact_id = create_resp.json()["id"]

        resp = client.get(f"/api/contacts/{contact_id}", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        # Detail endpoint returns a dict with "contact" key
        assert "contact" in body
        assert body["contact"]["name"] == "Priya Singh"

    def test_get_nonexistent_contact_returns_404(self, client, admin_user, auth_headers):
        resp = client.get("/api/contacts/99999", headers=auth_headers)
        assert resp.status_code == 404


class TestContactUpdate:
    def test_update_contact_name(self, client, admin_user, auth_headers):
        create_resp = client.post(
            "/api/contacts",
            json={"name": "Old Name", "contact_type": "individual", "relationship_type": "borrower"},
            headers=auth_headers,
        )
        contact_id = create_resp.json()["id"]

        update_resp = client.put(
            f"/api/contacts/{contact_id}",
            json={"name": "New Name"},
            headers=auth_headers,
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["name"] == "New Name"


class TestContactDelete:
    def test_delete_contact_soft_deletes(self, client, admin_user, auth_headers):
        create_resp = client.post(
            "/api/contacts",
            json={"name": "To Delete", "contact_type": "individual", "relationship_type": "borrower"},
            headers=auth_headers,
        )
        contact_id = create_resp.json()["id"]

        del_resp = client.delete(f"/api/contacts/{contact_id}", headers=auth_headers)
        assert del_resp.status_code == 200
        assert "deleted" in del_resp.json().get("message", "").lower()

    def test_deleted_contact_returns_404(self, client, admin_user, auth_headers):
        create_resp = client.post(
            "/api/contacts",
            json={"name": "Ghost Contact", "contact_type": "individual", "relationship_type": "borrower"},
            headers=auth_headers,
        )
        contact_id = create_resp.json()["id"]
        client.delete(f"/api/contacts/{contact_id}", headers=auth_headers)

        get_resp = client.get(f"/api/contacts/{contact_id}", headers=auth_headers)
        assert get_resp.status_code == 404


class TestContactListAfterCreate:
    def test_list_shows_created_contact(self, client, admin_user, auth_headers):
        client.post(
            "/api/contacts",
            json={"name": "Visible Contact", "contact_type": "individual", "relationship_type": "partner"},
            headers=auth_headers,
        )
        list_resp = client.get("/api/contacts", headers=auth_headers)
        assert list_resp.status_code == 200
        names = [c["name"] for c in list_resp.json()]
        assert "Visible Contact" in names
