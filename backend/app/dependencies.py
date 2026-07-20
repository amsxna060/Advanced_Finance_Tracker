from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import settings
from app.models.user import User
from app.modules import MODULE_REGISTRY, effective_modules

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: int = payload.get("sub")
        token_type: str = payload.get("type")
        if user_id is None or token_type != "access":
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    try:
        user = db.query(User).filter(User.id == int(user_id), User.is_active == True).first()
    except (ValueError, TypeError):
        raise credentials_exception
    if user is None:
        raise credentials_exception

    # Stamp the request's session so the activity logger (services/
    # activity_logger.py flush listeners) can attribute every change made
    # through this session to the acting user + originating request.
    db.info["audit_user_id"] = user.id
    db.info["audit_username"] = user.username
    db.info["audit_request"] = f"{request.method} {request.url.path}"
    # Tenant context (app/tenancy.py): every ORM query in this request is
    # scoped to this tenant; every new row is stamped with it. Household
    # guests (tenant_owner_id set) operate inside their owner's tenant.
    db.info["tenant_id"] = user.tenant_owner_id or user.id

    # E5 support view: a PLATFORM admin may inspect another user's tenant by
    # sending X-Tenant-Context: <user_id>. Strictly read-only (see
    # require_write_access) and audited (see routers/admin.py middleware
    # helper _log_admin_view). Non-admins sending the header get 403 — never
    # silently ignored, an ignored security header is a footgun.
    context_header = request.headers.get("X-Tenant-Context")
    if context_header:
        if user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tenant context is available to platform admins only",
            )
        try:
            target_id = int(context_header)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid X-Tenant-Context")
        target = db.get(User, target_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Tenant user not found")
        db.info["tenant_id"] = target.tenant_owner_id or target.id
        db.info["admin_tenant_context"] = True
        # FB-2.3/E5: every support-view request is audited — actor is the
        # admin, owner is the inspected tenant, so the user can see in their
        # own activity log that (and when) support looked at their books.
        from app.models.activity_log import ActivityLog
        db.add(ActivityLog(
            owner_id=db.info["tenant_id"],
            user_id=user.id,
            username=user.username,
            action="admin_view",
            module="admin",
            entity_type="tenant",
            entity_id=target.id,
            entity_name=target.username,
            description=f"Platform admin '{user.username}' viewed this account (support)",
            request_info=f"{request.method} {request.url.path}",
        ))
        db.commit()
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """PLATFORM admin only (role='admin').

    Since the E2 authorization rework, 'admin' means operator of the
    platform, not owner-of-the-data: domain CRUD uses require_write_access +
    tenant scoping instead. Keep this only on platform surfaces: /api/admin/*,
    user provisioning in auth.py, and legacy one-time migration tools.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user


def require_write_access(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """
    Dependency for any endpoint that mutates domain data.

    Every user has full write access to their OWN tenant's data (isolation is
    enforced by app/tenancy.py, not by roles). The only role blocked is
    'readonly' — household guest credentials. The middleware in main.py
    already enforces this at the HTTP level; this dependency is a
    belt-and-suspenders guard at the route level.
    """
    if current_user.role == "readonly":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Read-only credentials: write operations are not permitted.",
        )
    if db.info.get("admin_tenant_context"):
        # E5: the admin support view is strictly read-only — inspecting a
        # user's books must never be able to change them.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant context is read-only: writes are not permitted while viewing another user's data.",
        )
    return current_user


def resolve_tenant_owner(user: User, db: Session) -> User:
    """The user whose account settings (modules, plan) govern this session:
    household guests defer to their owner, everyone else to themselves."""
    if user.tenant_owner_id:
        owner = db.get(User, user.tenant_owner_id)
        if owner is not None:
            return owner
    return user


def require_module(module_key: str):
    """Router-level entitlement gate (FB-3.2).

    Usage: APIRouter(..., dependencies=[Depends(require_module("loans"))]).
    403 "module_disabled" when the tenant owner hasn't enabled the module.
    This is UX/API hygiene, not a security boundary — tenancy (app/tenancy.py)
    is what isolates data; this just keeps disabled features consistently off.
    """
    if module_key not in MODULE_REGISTRY:
        raise ValueError(f"require_module: unknown module key {module_key!r}")

    def _dep(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        owner = resolve_tenant_owner(current_user, db)
        if module_key not in effective_modules(owner.enabled_modules):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="module_disabled",
            )
        return current_user

    return _dep
