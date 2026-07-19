from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import settings
from app.models.user import User

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
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user


def require_write_access(current_user: User = Depends(get_current_user)) -> User:
    """
    Dependency for any endpoint that mutates data.
    Blocks users with role='readonly'.
    The middleware in main.py already enforces this at the HTTP level;
    this dependency is a belt-and-suspenders guard at the route level.
    """
    if current_user.role == "readonly":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Read-only credentials: write operations are not permitted.",
        )
    return current_user
