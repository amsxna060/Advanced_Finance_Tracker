"""Automatic tenant isolation.

Registers two global SQLAlchemy Session listeners (imported once in
app/main.py, same pattern as services/activity_logger.py):

1. `do_orm_execute` — every ORM SELECT / UPDATE / DELETE gets
   `WHERE owner_id = :tenant` injected for all TenantMixin models via
   `with_loader_criteria`. Routers cannot forget the filter because they
   never write it.

2. `before_flush` — new TenantMixin rows are stamped with the session's
   tenant; a row whose owner_id contradicts the session tenant aborts the
   flush (fail-closed against spoofed owner_id values).

The tenant is `session.info["tenant_id"]`, stamped by `get_current_user`
(app/dependencies.py) — the same session.info channel the activity logger
uses for attribution:

    tenant_id = user.tenant_owner_id or user.id

i.e. normal users are their own tenant; household viewer/readonly users
(users.tenant_owner_id set) operate inside their owner's tenant.

Sessions without a tenant (login flow, scheduler, seed scripts, alembic)
get NO automatic filter — code on those paths must scope explicitly and is
audited in FB-1.3. A future platform-admin context (E5) will set the tenant
to the inspected user's id rather than bypassing.

Escape hatch for legitimately cross-tenant queries (admin/platform code):

    db.execute(stmt.execution_options(skip_tenant_filter=True))
"""

import logging

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.models.mixins import TenantMixin

logger = logging.getLogger(__name__)


class TenantViolation(Exception):
    """A row's owner_id contradicts the session's tenant."""


@event.listens_for(Session, "do_orm_execute")
def _apply_tenant_filter(execute_state):
    if not (execute_state.is_select or execute_state.is_update or execute_state.is_delete):
        return
    if execute_state.execution_options.get("skip_tenant_filter"):
        return
    tenant_id = execute_state.session.info.get("tenant_id")
    if tenant_id is None:
        return
    execute_state.statement = execute_state.statement.options(
        with_loader_criteria(
            TenantMixin,
            lambda cls: cls.owner_id == tenant_id,
            include_aliases=True,
        )
    )


@event.listens_for(Session, "before_flush")
def _stamp_tenant_on_new(session, flush_context, instances):
    tenant_id = session.info.get("tenant_id")
    for obj in session.new:
        if not isinstance(obj, TenantMixin):
            continue
        if obj.owner_id is None:
            obj.owner_id = tenant_id
        elif tenant_id is not None and obj.owner_id != tenant_id:
            raise TenantViolation(
                f"Refusing to create {type(obj).__name__} with owner_id="
                f"{obj.owner_id} inside tenant {tenant_id}"
            )
