"""
Integration tests for /api/auth/* endpoints.
"""

import pytest
from passlib.context import CryptContext

from app.models.user import User

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


class TestLogin:
    def test_login_success(self, client, admin_user):
        resp = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["token_type"] == "bearer"

    def test_login_wrong_password(self, client, admin_user):
        resp = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "wrongpassword"},
        )
        assert resp.status_code == 401

    def test_login_wrong_username(self, client):
        resp = client.post(
            "/api/auth/login",
            data={"username": "nouser", "password": "testpass123"},
        )
        assert resp.status_code == 401

    def test_login_inactive_user(self, client, db):
        """Disabled user should receive 403 after attempting login."""
        inactive = User(
            username="inactiveuser",
            email="inactive@test.local",
            password_hash=_pwd.hash("somepass123"),
            full_name="Inactive",
            role="viewer",
            is_active=False,
        )
        db.add(inactive)
        db.flush()

        resp = client.post(
            "/api/auth/login",
            data={"username": "inactiveuser", "password": "somepass123"},
        )
        assert resp.status_code == 403


class TestRefreshToken:
    def test_refresh_token_returns_new_access_token(self, client, admin_user):
        login = client.post(
            "/api/auth/login",
            data={"username": admin_user.username, "password": "testpass123"},
        )
        refresh_token = login.json()["refresh_token"]

        resp = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
        assert resp.status_code == 200
        assert "access_token" in resp.json()
        assert resp.json()["token_type"] == "bearer"

    def test_refresh_invalid_token(self, client):
        resp = client.post("/api/auth/refresh", json={"refresh_token": "garbage.token.here"})
        assert resp.status_code == 401


class TestGetMe:
    def test_get_me_authenticated(self, client, admin_user, auth_headers):
        resp = client.get("/api/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["username"] == admin_user.username

    def test_get_me_unauthenticated(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401


class TestRegister:
    def test_register_as_admin_creates_user(self, client, auth_headers):
        payload = {
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "newpass123",
            "full_name": "New User",
            "role": "viewer",
        }
        resp = client.post("/api/auth/register", json=payload, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["username"] == "newuser"

    def test_register_as_non_admin_forbidden(self, client, viewer_user, viewer_auth_headers):
        payload = {
            "username": "anotheruser",
            "email": "anotheruser@example.com",
            "password": "pass123456",
            "full_name": "Another",
            "role": "viewer",
        }
        resp = client.post("/api/auth/register", json=payload, headers=viewer_auth_headers)
        assert resp.status_code == 403

    def test_create_readonly_user_as_admin(self, client, auth_headers):
        resp = client.post(
            "/api/auth/create-readonly",
            json={"username": "myreadonly", "password": "readonly123", "full_name": "Readonly Person"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "readonly"


class TestReadonlyEnforcement:
    def test_readonly_user_blocked_on_write(self, client, readonly_user, readonly_auth_headers):
        """readonly token on POST /api/contacts → 403."""
        payload = {
            "name": "SomeContact",
            "contact_type": "individual",
            "relationship_type": "borrower",
        }
        resp = client.post("/api/contacts", json=payload, headers=readonly_auth_headers)
        assert resp.status_code == 403

    def test_readonly_user_allowed_on_read(self, client, readonly_user, readonly_auth_headers):
        """readonly token on GET /api/contacts → 200."""
        resp = client.get("/api/contacts", headers=readonly_auth_headers)
        assert resp.status_code == 200
