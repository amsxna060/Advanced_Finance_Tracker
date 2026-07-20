"""E5 — Admin console: tenant-context support view, user management, stats.

The support view reuses every existing endpoint: the admin sends
X-Tenant-Context: <user_id> and reads that tenant's data. It must be
strictly read-only, admin-only, and audited into the inspected tenant's
own activity log.
"""


def _csrf(client):
    resp = client.get("/api/auth/csrf-token")
    return {"X-CSRF-Token": resp.json()["csrf_token"]}


class TestTenantContextView:
    def test_admin_sees_target_tenant_data(self, client, seeded_a, tenant_a,
                                           auth_headers):
        # Without context: admin's own (empty) tenant
        assert client.get("/api/contacts", headers=auth_headers).json() == []
        # With context: tenant A's data, through the ordinary endpoint
        resp = client.get("/api/contacts",
                          headers={**auth_headers, "X-Tenant-Context": str(tenant_a.id)})
        assert resp.status_code == 200
        assert [c["name"] for c in resp.json()] == ["Alice Borrower"]

    def test_context_read_only_by_default(self, client, seeded_a, tenant_a, auth_headers):
        # No X-Tenant-Edit → writes blocked, prompt to turn on edit mode
        resp = client.post(
            "/api/contacts",
            headers={**auth_headers, "X-Tenant-Context": str(tenant_a.id)},
            json={"name": "Injected", "contact_type": "individual",
                  "relationship_type": "borrower"},
        )
        assert resp.status_code == 403
        assert "edit mode" in resp.json()["detail"].lower()

    def test_edit_mode_allows_writes_into_target_tenant(self, client, db, seeded_a,
                                                        tenant_a, admin_user, auth_headers):
        ctx = {"X-Tenant-Context": str(tenant_a.id), "X-Tenant-Edit": "1"}
        resp = client.post("/api/contacts", headers={**auth_headers, **ctx},
                           json={"name": "Fixed by support",
                                 "contact_type": "individual",
                                 "relationship_type": "borrower"})
        assert resp.status_code == 200, resp.text
        # the new row belongs to the USER's tenant, not the admin's
        assert resp.json()["id"]
        listed = client.get("/api/contacts", headers={**auth_headers, **ctx}).json()
        assert "Fixed by support" in [c["name"] for c in listed]

        # …and the edit is audited into the user's log, marked as support
        from app.models.activity_log import ActivityLog
        row = (db.query(ActivityLog).execution_options(skip_tenant_filter=True)
               .filter(ActivityLog.owner_id == tenant_a.id,
                       ActivityLog.action == "create",
                       ActivityLog.entity_type == "contacts")
               .order_by(ActivityLog.id.desc()).first())
        assert row is not None
        assert row.user_id == admin_user.id
        assert "support admin" in row.description

    def test_context_rejected_for_non_admin(self, client, tenant_a, headers_b):
        resp = client.get("/api/contacts",
                          headers={**headers_b, "X-Tenant-Context": str(tenant_a.id)})
        assert resp.status_code == 403

    def test_context_view_is_audited_into_target_tenant(self, client, db,
                                                        seeded_a, tenant_a,
                                                        admin_user, auth_headers):
        client.get("/api/contacts",
                   headers={**auth_headers, "X-Tenant-Context": str(tenant_a.id)})
        from app.models.activity_log import ActivityLog
        row = (
            db.query(ActivityLog)
            .execution_options(skip_tenant_filter=True)
            .filter(ActivityLog.action == "admin_view")
            .order_by(ActivityLog.id.desc())
            .first()
        )
        assert row is not None
        assert row.user_id == admin_user.id       # who looked
        assert row.owner_id == tenant_a.id        # whose books — visible to them
        assert row.entity_id == tenant_a.id

    def test_legacy_bulk_tools_blocked_in_context(self, client, tenant_a,
                                                  auth_headers):
        resp = client.post(
            "/api/admin/mark-legacy",
            headers={**auth_headers, "X-Tenant-Context": str(tenant_a.id), **_csrf(client)},
        )
        assert resp.status_code == 403

    def test_invalid_context_values(self, client, auth_headers):
        assert client.get("/api/contacts",
                          headers={**auth_headers, "X-Tenant-Context": "abc"}
                          ).status_code == 400
        assert client.get("/api/contacts",
                          headers={**auth_headers, "X-Tenant-Context": "99999"}
                          ).status_code == 404


class TestUserManagement:
    def test_list_users_with_search(self, client, tenant_a, tenant_b, auth_headers):
        users = client.get("/api/admin/users", headers=auth_headers).json()
        names = {u["username"] for u in users}
        assert {"testadmin", "tenant_alice", "tenant_bob"} <= names

        filtered = client.get("/api/admin/users?search=alice", headers=auth_headers).json()
        assert [u["username"] for u in filtered] == ["tenant_alice"]

    def test_users_endpoint_admin_only(self, client, headers_a):
        assert client.get("/api/admin/users", headers=headers_a).status_code == 403

    def test_deactivate_blocks_login(self, client, tenant_a, auth_headers):
        resp = client.put(f"/api/admin/users/{tenant_a.id}/active",
                          headers={**auth_headers, **_csrf(client)},
                          json={"is_active": False})
        assert resp.status_code == 200, resp.text
        login = client.post("/api/auth/login",
                            data={"username": "tenant_alice",
                                  "password": "tenantpass123"})
        assert login.status_code == 401

    def test_cannot_deactivate_self(self, client, admin_user, auth_headers):
        resp = client.put(f"/api/admin/users/{admin_user.id}/active",
                          headers={**auth_headers, **_csrf(client)},
                          json={"is_active": False})
        assert resp.status_code == 400


class TestPlatformStats:
    def test_stats_shape(self, client, seeded_a, tenant_a, tenant_b, auth_headers):
        resp = client.get("/api/admin/stats", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        s = resp.json()
        assert s["total_users"] >= 3
        assert s["tenant_owners"] >= 3
        assert "loans" in s["module_adoption"]
        # tenant A seeded real rows — they must appear in rows_per_tenant
        assert s["rows_per_tenant"].get(str(tenant_a.id)) or \
               s["rows_per_tenant"].get(tenant_a.id)
        assert isinstance(s["recent_activity"], list)
