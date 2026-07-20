"""E6 cut-over provisioning — env-driven, idempotent, runs at startup.

When PLATFORM_ADMIN_USERNAME is configured:
  1. create-or-update that account as the platform admin (role=admin,
     verified). Its writes are blocked HTTP-wide by the read-only middleware
     in main.py when PLATFORM_ADMIN_READ_ONLY is on.
  2. with DEMOTE_OTHER_ADMINS=true, demote every other admin account to a
     normal user (role=viewer). The demoted account keeps ALL its data and
     modules: tenancy owns the rows (owner_id unchanged) and
     enabled_modules NULL still means "all modules".

This is how amolsaxena060 becomes a regular full-featured user and a fresh
read-only support admin takes over — with four lines of .env, no SSH scripts.
"""

import logging

from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=13)


def provision_platform_admin(db: Session) -> dict:
    """Returns a small report dict for logging/tests. No-op unless
    PLATFORM_ADMIN_USERNAME is set."""
    if not settings.PLATFORM_ADMIN_USERNAME:
        return {"skipped": True}
    if not settings.PLATFORM_ADMIN_PASSWORD or len(settings.PLATFORM_ADMIN_PASSWORD) < 12:
        raise ValueError("PLATFORM_ADMIN_PASSWORD must be set (12+ chars)")

    admin = db.query(User).filter(
        User.username == settings.PLATFORM_ADMIN_USERNAME
    ).first()
    created = admin is None
    if created:
        admin = User(
            username=settings.PLATFORM_ADMIN_USERNAME,
            email=settings.PLATFORM_ADMIN_EMAIL
                  or f"{settings.PLATFORM_ADMIN_USERNAME}@financerbuddy.com",
            password_hash=_pwd_context.hash(settings.PLATFORM_ADMIN_PASSWORD),
            full_name="Platform Admin",
            role="admin",
            is_active=True,
            email_verified=True,
        )
        db.add(admin)
        logger.info("Provisioned platform admin '%s'", admin.username)
    else:
        admin.role = "admin"
        admin.is_active = True
        admin.email_verified = True
        admin.password_hash = _pwd_context.hash(settings.PLATFORM_ADMIN_PASSWORD)
    db.flush()

    demoted = []
    if settings.DEMOTE_OTHER_ADMINS:
        for u in db.query(User).filter(User.role == "admin", User.id != admin.id).all():
            u.role = "viewer"
            demoted.append(u.username)
            logger.warning("Demoted '%s' from admin to normal user (cut-over)", u.username)
        if demoted:
            logger.warning(
                "Cut-over complete: %s demoted; '%s' is now the only admin (read_only=%s)",
                demoted, admin.username, settings.PLATFORM_ADMIN_READ_ONLY,
            )
    db.commit()
    return {"skipped": False, "created": created, "admin": admin.username, "demoted": demoted}
