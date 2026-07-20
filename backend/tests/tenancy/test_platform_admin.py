"""E6 — Read-only platform admin + cut-over provisioning."""

import pytest

from app.config import settings
from app.services.provisioning import provision_platform_admin


@pytest.fixture()
def readonly_platform(monkeypatch):
    monkeypatch.setattr(settings, "PLATFORM_ADMIN_USERNAME", "fbadmin")
    monkeypatch.setattr(settings, "PLATFORM_ADMIN_PASSWORD", "SuperSecret123!")
    monkeypatch.setattr(settings, "PLATFORM_ADMIN_READ_ONLY", True)


class TestReadOnlyAdminMiddleware:
    def test_admin_writes_blocked_when_active(self, client, admin_user,
                                              auth_headers, readonly_platform):
        resp = client.post("/api/contacts", headers=auth_headers, json={
            "name": "X", "contact_type": "individual",
            "relationship_type": "borrower",
        })
        assert resp.status_code == 403
        assert "read-only" in resp.json()["detail"].lower()

    def test_admin_reads_still_work(self, client, admin_user, auth_headers,
                                    readonly_platform):
        assert client.get("/api/contacts", headers=auth_headers).status_code == 200
        assert client.get("/api/admin/stats", headers=auth_headers).status_code == 200

    def test_admin_can_still_logout(self, client, admin_user, auth_headers,
                                    readonly_platform):
        # auth endpoints are exempt — otherwise the admin could never log out
        assert client.post("/api/auth/logout", headers=auth_headers).status_code == 200

    def test_normal_users_unaffected(self, client, tenant_a, headers_a,
                                     readonly_platform):
        resp = client.post("/api/contacts", headers=headers_a, json={
            "name": "Mine", "contact_type": "individual",
            "relationship_type": "borrower",
        })
        assert resp.status_code == 200

    def test_inert_until_cutover_configured(self, client, admin_user,
                                            auth_headers, monkeypatch):
        # PLATFORM_ADMIN_USERNAME empty -> legacy admin keeps full write access
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_USERNAME", "")
        resp = client.post("/api/contacts", headers=auth_headers, json={
            "name": "Legacy", "contact_type": "individual",
            "relationship_type": "borrower",
        })
        assert resp.status_code == 200


class TestProvisioning:
    def test_noop_without_config(self, db, monkeypatch):
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_USERNAME", "")
        assert provision_platform_admin(db) == {"skipped": True}

    def test_creates_admin_and_demotes_legacy(self, db, admin_user, monkeypatch):
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_USERNAME", "fbadmin")
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_PASSWORD", "SuperSecret123!")
        monkeypatch.setattr(settings, "DEMOTE_OTHER_ADMINS", True)

        report = provision_platform_admin(db)
        assert report["created"] is True
        assert report["admin"] == "fbadmin"
        assert admin_user.username in report["demoted"]

        db.refresh(admin_user)
        assert admin_user.role == "viewer"          # demoted…
        assert admin_user.enabled_modules is None   # …but keeps all modules
        assert admin_user.is_active is True

        # idempotent: second run demotes nobody new, keeps the admin
        report2 = provision_platform_admin(db)
        assert report2["created"] is False
        assert report2["demoted"] == []

    def test_weak_password_refused(self, db, monkeypatch):
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_USERNAME", "fbadmin")
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_PASSWORD", "short")
        with pytest.raises(ValueError):
            provision_platform_admin(db)

    def test_demoted_user_still_owns_their_data(self, client, db, seeded_a,
                                                tenant_a, admin_user, monkeypatch):
        """The cut-over story end-to-end: a user with data gets demoted-like
        treatment (role change) and still sees everything they own."""
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_USERNAME", "fbadmin")
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_PASSWORD", "SuperSecret123!")
        monkeypatch.setattr(settings, "DEMOTE_OTHER_ADMINS", True)
        provision_platform_admin(db)

        # tenant_a (role=viewer, owns seeded data) — unchanged by cut-over
        login = client.post("/api/auth/login", data={
            "username": "tenant_alice", "password": "tenantpass123"})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        contacts = client.get("/api/contacts", headers=headers).json()
        assert [c["name"] for c in contacts] == ["Alice Borrower"]
        me = client.get("/api/auth/me", headers=headers).json()
        assert len(me["enabled_modules"]) >= 6
