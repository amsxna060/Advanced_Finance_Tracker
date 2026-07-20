"""Transactional outbox (E8, trimmed to in-app scope).

Domain events are written to this table IN THE SAME TRANSACTION as the
change that caused them — so an event exists if and only if the change
committed. A relay (app/tasks.dispatch_outbox, or inline in eager mode)
delivers each event to its handlers at least once; handlers are idempotent.

Deliberately NOT a TenantMixin: the relay processes all tenants' events in
one sweep and the table is never exposed through a user-facing endpoint.
owner_id records whose tenant the event belongs to; handlers scope their
queries with it explicitly.
"""
from sqlalchemy import Column, DateTime, Integer, JSON, String, Text
from sqlalchemy.sql import func

from app.database import Base


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(60), nullable=False, index=True)   # e.g. "user.signed_up"
    owner_id = Column(Integer, nullable=True, index=True)          # tenant the event belongs to
    payload = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
