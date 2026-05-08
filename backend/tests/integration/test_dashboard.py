"""
Integration tests for /api/dashboard/* endpoints.
"""

import pytest


class TestDashboardSummary:
    def test_summary_returns_200(self, client, admin_user, auth_headers):
        resp = client.get("/api/dashboard/summary", headers=auth_headers)
        assert resp.status_code == 200

    def test_summary_has_financial_keys(self, client, admin_user, auth_headers):
        """
        The dashboard summary should include at minimum the total_given /
        total_taken family of keys (or equivalent top-level financial keys).
        """
        resp = client.get("/api/dashboard/summary", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        # At least one of these top-level financial summary keys must be present
        financial_keys = {
            "total_given", "total_taken", "total_lent", "total_borrowed",
            "loans_given_outstanding", "loans_taken_outstanding",
            "total_outstanding", "loans_given", "loans_taken",
        }
        assert financial_keys & set(body.keys()), (
            f"Expected at least one of {financial_keys} in dashboard summary, got: {list(body.keys())}"
        )

    def test_summary_unauthenticated_returns_401(self, client):
        resp = client.get("/api/dashboard/summary")
        assert resp.status_code == 401
