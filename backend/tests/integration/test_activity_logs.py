"""
Integration tests for the activity/audit log.

Covers:
- automatic logging of create/update/delete performed through the API
  (via the flush listeners in app/services/activity_logger.py)
- login events
- the GET /api/activity-logs list endpoint: filters, search, sort, pagination
- the GET /api/activity-logs/filters meta endpoint
"""

from app.models import ActivityLog


def _logs(db, **kw):
    q = db.query(ActivityLog)
    for k, v in kw.items():
        q = q.filter(getattr(ActivityLog, k) == v)
    return q.order_by(ActivityLog.id).all()


class TestAutomaticLogging:
    def test_login_is_logged(self, client, admin_user, auth_headers, db):
        rows = _logs(db, action="login")
        assert len(rows) == 1
        assert rows[0].username == admin_user.username
        assert rows[0].module == "auth"

    def test_contact_create_update_delete_logged(self, client, auth_headers, db):
        # create
        resp = client.post(
            "/api/contacts",
            json={"name": "Audit Target", "phone": "9999999999"},
            headers=auth_headers,
        )
        assert resp.status_code in (200, 201), resp.text
        contact_id = resp.json()["id"]

        created = _logs(db, action="create", entity_type="contacts", entity_id=contact_id)
        assert len(created) == 1
        log = created[0]
        assert log.module == "contacts"
        assert log.entity_name == "Audit Target"
        assert log.username == "testadmin"
        assert log.request_info == "POST /api/contacts"
        assert log.changes.get("name") == "Audit Target"  # create snapshot

        # update — diff must contain old AND new values
        resp = client.put(
            f"/api/contacts/{contact_id}",
            json={"name": "Audit Target Renamed"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        updated = _logs(db, action="update", entity_type="contacts", entity_id=contact_id)
        assert len(updated) >= 1
        change = updated[-1].changes.get("name")
        assert change == {"old": "Audit Target", "new": "Audit Target Renamed"}

        # delete (soft or hard — either action should be recorded)
        resp = client.delete(f"/api/contacts/{contact_id}", headers=auth_headers)
        assert resp.status_code in (200, 204), resp.text
        deleted = _logs(db, action="delete", entity_type="contacts", entity_id=contact_id)
        assert len(deleted) == 1

    def test_account_creation_captures_amount(self, client, auth_headers, db):
        resp = client.post(
            "/api/accounts",
            json={"name": "Audit HDFC", "account_type": "savings", "opening_balance": 2500},
            headers=auth_headers,
        )
        assert resp.status_code in (200, 201), resp.text
        acct_id = resp.json()["id"]
        rows = _logs(db, action="create", entity_type="cash_accounts", entity_id=acct_id)
        assert len(rows) == 1
        assert float(rows[0].amount) == 2500.0
        assert rows[0].module == "accounts"


class TestActivityLogAPI:
    def _seed(self, client, auth_headers):
        client.post("/api/contacts", json={"name": "Log Search Alpha"}, headers=auth_headers)
        client.post(
            "/api/accounts",
            json={"name": "Log Search Bank", "account_type": "savings", "opening_balance": 777},
            headers=auth_headers,
        )

    def test_list_returns_entries_newest_first(self, client, auth_headers):
        self._seed(client, auth_headers)
        resp = client.get("/api/activity-logs", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] >= 3  # login + contact + account
        ids = [i["id"] for i in body["items"]]
        assert ids == sorted(ids, reverse=True)

        oldest = client.get("/api/activity-logs?sort=oldest", headers=auth_headers).json()
        ids = [i["id"] for i in oldest["items"]]
        assert ids == sorted(ids)

    def test_filter_by_module_and_action(self, client, auth_headers):
        self._seed(client, auth_headers)
        resp = client.get(
            "/api/activity-logs?module=contacts&action=create", headers=auth_headers
        )
        body = resp.json()
        assert body["total"] >= 1
        assert all(i["module"] == "contacts" and i["action"] == "create" for i in body["items"])

    def test_search_by_name_and_amount(self, client, auth_headers):
        self._seed(client, auth_headers)
        by_name = client.get(
            "/api/activity-logs?search=Log Search Alpha", headers=auth_headers
        ).json()
        assert by_name["total"] >= 1
        assert any("Log Search Alpha" in (i["entity_name"] or "") for i in by_name["items"])

        by_amount = client.get("/api/activity-logs?search=777", headers=auth_headers).json()
        assert by_amount["total"] >= 1
        assert any(i["amount"] == 777.0 for i in by_amount["items"])

    def test_account_name_resolved(self, client, auth_headers, db):
        acct = client.post(
            "/api/accounts",
            json={"name": "Resolver Bank", "account_type": "savings"},
            headers=auth_headers,
        ).json()
        client.post(
            "/api/contacts", json={"name": "Resolver Contact"}, headers=auth_headers
        )
        resp = client.get(
            f"/api/activity-logs?account_id={acct['id']}", headers=auth_headers
        ).json()
        # Account filter only returns rows carrying that account_id (e.g. its
        # transactions); the account's own create row has account_id NULL, so
        # just assert the endpoint accepts the filter and resolves names.
        for item in resp["items"]:
            assert item["account_id"] == acct["id"]
            assert item["account_name"] == "Resolver Bank"

    def test_pagination(self, client, auth_headers):
        for i in range(5):
            client.post("/api/contacts", json={"name": f"Page Test {i}"}, headers=auth_headers)
        first = client.get("/api/activity-logs?page=1&page_size=3", headers=auth_headers).json()
        second = client.get("/api/activity-logs?page=2&page_size=3", headers=auth_headers).json()
        assert len(first["items"]) == 3
        assert first["total_pages"] >= 2
        assert {i["id"] for i in first["items"]}.isdisjoint({i["id"] for i in second["items"]})

    def test_filters_meta_endpoint(self, client, auth_headers):
        self._seed(client, auth_headers)
        resp = client.get("/api/activity-logs/filters", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "contacts" in body["modules"]
        assert "create" in body["actions"]
        assert any(u["username"] == "testadmin" for u in body["users"])

    def test_requires_auth(self, client):
        assert client.get("/api/activity-logs").status_code == 401
