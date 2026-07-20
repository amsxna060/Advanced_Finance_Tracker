"""Tenancy mixin — the single place the `owner_id` tenant column is defined.

Every domain table (everything except `users` and `refresh_token_blacklist`)
inherits TenantMixin. `owner_id` answers "whose data is this?" and is the
column all tenant isolation is enforced against.

`owner_id` vs `created_by`: `created_by` remains the audit stamp (who typed
it in); `owner_id` is the tenant boundary (whose books it belongs to). They
are equal today, but diverge once shared/household access exists — e.g. a
viewer added to your tenant creates a row with created_by=viewer,
owner_id=you.

Enforcement lives in app/tenancy.py:
  - SELECT/UPDATE/DELETE against TenantMixin models are automatically
    filtered to session.info["tenant_id"] via with_loader_criteria.
  - New instances are stamped with the session's tenant on flush.
"""

from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.orm import declared_attr


class TenantMixin:
    @declared_attr
    def owner_id(cls):
        return Column(
            Integer,
            ForeignKey("users.id"),
            nullable=False,
            index=True,
        )
