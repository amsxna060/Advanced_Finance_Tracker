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


def require_write_access(current_user: User = Depends(get_current_user)) -> User:
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
