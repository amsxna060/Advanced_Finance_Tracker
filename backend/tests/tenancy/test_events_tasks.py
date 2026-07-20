"""E7/E8 — Celery eager mode, transactional outbox, event handlers."""

from unittest.mock import patch

import pytest

from app.events import MAX_ATTEMPTS, dispatch_pending, emit_event
from app.models.outbox_event import OutboxEvent


class TestCeleryEagerMode:
    def test_tasks_run_inline_without_redis(self):
        from app.celery_app import celery_app
        assert celery_app.conf.task_always_eager is True

    def test_send_email_task_eager(self):
        from app.tasks import send_email
        with patch("app.services.email_service.send_email", return_value=True) as mock:
            result = send_email.delay("x@y.com", "Hi", "Body")
        assert result.successful()
        mock.assert_called_once_with("x@y.com", "Hi", "Body")


class TestOutbox:
    def test_signup_emits_and_processes_user_signed_up(self, client, db):
        sent = []
        with patch("app.services.email_service.send_email",
                   side_effect=lambda to, s, b: sent.append((to, s)) or True):
            resp = client.post("/api/auth/signup", json={
                "username": "eventuser", "email": "event@x.com",
                "password": "Str0ngPass1", "full_name": "Event User",
            })
        assert resp.status_code == 201, resp.text

        ev = db.query(OutboxEvent).filter(
            OutboxEvent.event_type == "user.signed_up").first()
        assert ev is not None
        assert ev.processed_at is not None          # delivered inline (eager)
        assert ev.owner_id == resp.json()["id"]
        # Both mails went out: verification + welcome (handler)
        subjects = [s for (_, s) in sent]
        assert any("Verify" in s for s in subjects)
        assert any("Welcome" in s for s in subjects)

    def test_event_commits_with_the_change(self, db, tenant_a):
        db.info["tenant_id"] = tenant_a.id
        ev = emit_event(db, "expense.created", {"x": 1})
        assert ev.owner_id == tenant_a.id           # stamped from session tenant
        db.rollback()                               # change rolls back → event too
        assert db.query(OutboxEvent).count() == 0
        db.info.pop("tenant_id", None)

    def test_failing_handler_records_attempts_and_parks(self, db, monkeypatch):
        import app.events as events_mod
        calls = {"n": 0}

        def boom(db_, ev):
            calls["n"] += 1
            raise RuntimeError("handler exploded")

        monkeypatch.setitem(events_mod.HANDLERS, "test.boom", [boom])
        emit_event(db, "test.boom", {}, owner_id=1)
        db.commit()

        for _ in range(MAX_ATTEMPTS + 2):           # extra runs must not retry past cap
            dispatch_pending(db)

        ev = db.query(OutboxEvent).filter(OutboxEvent.event_type == "test.boom").first()
        assert ev.processed_at is None
        assert ev.attempts == MAX_ATTEMPTS          # parked, not retried forever
        assert "handler exploded" in ev.last_error
        assert calls["n"] == MAX_ATTEMPTS


class TestCategoryLimitAlert:
    @pytest.fixture()
    def limit_100(self, client, headers_a):
        resp = client.post("/api/category-limits", headers=headers_a, json={
            "category": "food", "monthly_limit": 100,
        })
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    def _expense(self, client, headers, amount, date="2026-07-05"):
        return client.post("/api/expenses", headers=headers, json={
            "category": "food", "amount": amount, "expense_date": date,
        })

    def test_alert_when_limit_exceeded(self, client, db, tenant_a, headers_a, limit_100):
        assert self._expense(client, headers_a, 60).status_code == 200
        assert self._expense(client, headers_a, 70).status_code == 200  # total 130 > 100

        from app.models.activity_log import ActivityLog
        alert = (
            db.query(ActivityLog)
            .execution_options(skip_tenant_filter=True)
            .filter(ActivityLog.action == "alert",
                    ActivityLog.owner_id == tenant_a.id)
            .first()
        )
        assert alert is not None
        assert "food" in alert.description
        assert "limit exceeded" in alert.description.lower()

    def test_alert_is_idempotent_per_month(self, client, db, tenant_a, headers_a, limit_100):
        for amount in (60, 70, 80):                 # exceeds twice
            self._expense(client, headers_a, amount)
        from app.models.activity_log import ActivityLog
        alerts = (
            db.query(ActivityLog)
            .execution_options(skip_tenant_filter=True)
            .filter(ActivityLog.action == "alert",
                    ActivityLog.owner_id == tenant_a.id)
            .count()
        )
        assert alerts == 1                          # at-least-once ≠ duplicate alerts

    def test_no_alert_under_limit(self, client, db, tenant_a, headers_a, limit_100):
        self._expense(client, headers_a, 40)
        from app.models.activity_log import ActivityLog
        assert (
            db.query(ActivityLog)
            .execution_options(skip_tenant_filter=True)
            .filter(ActivityLog.action == "alert").count()
        ) == 0
