"""
Activity / audit log — one row per action taken anywhere in the app.

Rows are written automatically by the SQLAlchemy flush listeners in
app/services/activity_logger.py: every ORM create / update / delete on any
model becomes a log entry with a field-level before→after diff. Auth events
(login/logout) are written explicitly by the auth router.

The table is append-only from the app's perspective: nothing updates or
deletes rows (the audit service skips its own table to avoid recursion).
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, Numeric, JSON, Index
from sqlalchemy.sql import func
from app.database import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Who did it. username is denormalized so the log stays readable even if
    # the user row is later deactivated/removed. NULL user = background job.
    user_id = Column(Integer, index=True)
    username = Column(String(100))

    action = Column(String(20), nullable=False, index=True)   # create | update | delete | login | logout
    module = Column(String(30), nullable=False, index=True)   # loans | accounts | obligations | ... (sidebar-level grouping)
    entity_type = Column(String(60), nullable=False, index=True)  # exact table: loans, loan_payments, ...
    entity_id = Column(Integer, index=True)
    entity_name = Column(String(255))                         # human label of the record, when derivable

    description = Column(Text)                                # plain-English one-liner
    changes = Column(JSON)                                    # update: {field: {old, new}} · create/delete: snapshot

    # Denormalized "what was involved" columns so the log page can filter/search
    # without joining every module table.
    amount = Column(Numeric(15, 2))
    account_id = Column(Integer, index=True)
    contact_id = Column(Integer, index=True)
    loan_id = Column(Integer, index=True)

    # The HTTP request that caused the change, e.g. "POST /api/loans/18/payments"
    request_info = Column(String(255))

    __table_args__ = (
        Index("ix_activity_logs_created_desc", created_at.desc()),
    )
