from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
from jose import jwt
from passlib.context import CryptContext

from app.database import get_db
from app.config import settings
from app.models.user import User
from app.models.refresh_token import RefreshTokenBlacklist
from app.schemas.auth import (
    UserCreate, UserLogin, UserOut, TokenResponse, RefreshTokenRequest, TokenRefresh,
    SignupRequest, VerifyEmailRequest, ResendVerificationRequest, ModulesUpdate,
)
from app.dependencies import get_current_user, require_admin, resolve_tenant_owner
from app.modules import DEFAULT_SIGNUP_MODULES, effective_modules, validate_module_keys
from app.services.activity_logger import log_auth_event
from app.services.email_service import send_verification_email

router = APIRouter(prefix="/api/auth", tags=["auth"])
# L-SEC-7 (FIX): use bcrypt rounds=13 to match the seed-admin context in main.py
# so user-created accounts get the same brute-force resistance. Existing 12-round
# hashes still verify — the cost factor is embedded in each stored hash.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=13)
limiter = Limiter(key_func=get_remote_address)


def _hash_token(token: str) -> str:
    """Return SHA-256 hex digest of a token for blacklist storage."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: int, role: str = "viewer") -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": str(user_id), "exp": expire, "type": "access", "role": role}
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {"sub": str(user_id), "exp": expire, "type": "refresh"}
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, response: Response, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    # H-AUTH-5: Use a single generic message to prevent username enumeration
    _invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not user or not pwd_context.verify(form_data.password, user.password_hash):
        raise _invalid

    if not user.is_active:
        raise _invalid

    # FB-3.3: public-signup accounts must verify their email first when the
    # deployment requires it (off in development; on in production).
    if settings.REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="email_not_verified",
        )

    access_token = create_access_token(user.id, role=user.role)
    refresh_token = create_refresh_token(user.id)

    # C-AUTH-4: Set refresh token as httpOnly, SameSite=Strict cookie to prevent XSS theft.
    # The access token is still returned in the body for in-memory storage by the client.
    _is_secure = settings.APP_ENV != "development"
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=_is_secure,
        samesite="strict",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth",
    )

    # Re-stamp the session's tenant context to the user who just proved their
    # identity. The login endpoint has no get_current_user dependency, so a
    # session reused across users (tests, future pooling) would otherwise
    # carry a stale tenant — and app/tenancy.py would rightly refuse to write
    # this user's login log into another tenant.
    db.info["tenant_id"] = user.tenant_owner_id or user.id
    db.info["audit_user_id"] = user.id
    db.info["audit_username"] = user.username

    log_auth_event(db, user, "login", request)

    # FIX (refresh-token leak): do NOT return the refresh token in the body.
    # It is already set as an httpOnly SameSite=Strict cookie above; the SPA
    # reads it only via that cookie. Returning it here would expose it to JS.
    return {
        "access_token": access_token,
        "token_type": "bearer",
    }


@router.post("/refresh", response_model=TokenRefresh)
@limiter.limit("10/minute")
def refresh(request: Request, response: Response, body: Optional[RefreshTokenRequest] = None, db: Session = Depends(get_db)):
    # C-AUTH-4: Try httpOnly cookie first (browser SPA path), fall back to request body (API clients)
    raw_token = request.cookies.get("refresh_token") or (body.refresh_token if body else None)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token provided")
    try:
        payload = jwt.decode(raw_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        token_type = payload.get("type")

        if token_type != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

        # C-AUTH-2: Reject tokens that have been explicitly revoked via /logout
        token_hash = _hash_token(raw_token)
        blacklisted = db.query(RefreshTokenBlacklist).filter(
            RefreshTokenBlacklist.token_hash == token_hash
        ).first()
        if blacklisted:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token has been revoked")

        try:
            user = db.query(User).filter(User.id == int(user_id), User.is_active == True).first()
        except (ValueError, TypeError):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        # C-AUTH-1: Pass the user's actual role so it is never silently downgraded
        new_access_token = create_access_token(user.id, role=user.role)
        # C-AUTH-4: Rotate the refresh token cookie on each refresh (refresh token rotation)
        new_refresh_token = create_refresh_token(user.id)
        _is_secure = settings.APP_ENV != "development"
        response.set_cookie(
            key="refresh_token",
            value=new_refresh_token,
            httponly=True,
            secure=_is_secure,
            samesite="strict",
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            path="/api/auth",
        )
        # Blacklist the old token now that we've rotated it
        exp = payload.get("exp")
        if exp:
            expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
            if not db.query(RefreshTokenBlacklist).filter(RefreshTokenBlacklist.token_hash == token_hash).first():
                db.add(RefreshTokenBlacklist(token_hash=token_hash, user_id=user.id, expires_at=expires_at))
                db.commit()
        return {"access_token": new_access_token, "token_type": "bearer"}

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    out = UserOut.model_validate(current_user)
    # Entitlements are resolved from the tenant OWNER (household guests see
    # the owner's feature set) and expanded to the effective list.
    owner = resolve_tenant_owner(current_user, db)
    out.enabled_modules = effective_modules(owner.enabled_modules)
    return out


@router.put("/me/modules", response_model=UserOut)
def update_my_modules(
    body: ModulesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set the caller's enabled modules (questionnaire / Settings page).

    Only the tenant owner may change the household's modules; core modules
    are force-included by validation. Disabling a module hides it — no data
    is ever deleted.
    """
    if current_user.tenant_owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the account owner can change enabled modules",
        )
    try:
        current_user.enabled_modules = validate_module_keys(body.modules)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    db.commit()
    db.refresh(current_user)
    out = UserOut.model_validate(current_user)
    out.enabled_modules = effective_modules(current_user.enabled_modules)
    return out


@router.get("/csrf-token")
def get_csrf_token(response: Response):
    """H-SEC-2: Issue a CSRF token for the double-submit cookie pattern.
    The token is set as a readable (non-httpOnly) cookie AND returned in the
    response body. The frontend should read the cookie and include it as
    X-CSRF-Token in all state-changing requests to /api/admin/* endpoints.
    """
    import secrets as _secrets
    token = _secrets.token_hex(32)
    response.set_cookie(
        key="csrf_token",
        value=token,
        httponly=False,  # Must be readable by JS to implement double-submit
        secure=settings.APP_ENV != "development",
        samesite="strict",
        max_age=3600,  # 1 hour — shorter than the access token to reduce window
        path="/",
    )
    return {"csrf_token": token}


# M-SEC-6: Shared helper to avoid duplicating user-creation logic between /register and /create-readonly
def _create_user(
    *,
    username: str,
    password: str,
    email: str,
    full_name: Optional[str],
    role: str,
    db: Session,
) -> User:
    """Create a user after checking for duplicate username/email. Raises HTTPException on conflict."""
    existing = db.query(User).filter(
        (User.username == username) | (User.email == email)
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")
    new_user = User(
        username=username,
        email=email,
        password_hash=pwd_context.hash(password),
        full_name=full_name or username,
        role=role,
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


def _create_email_verify_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=48)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "email_verify"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
def signup(request: Request, payload: SignupRequest, db: Session = Depends(get_db)):
    """Public self-service signup (FB-3.3).

    Always creates a normal self-owned user (role=viewer) with the default
    module set; the onboarding questionnaire then tailors modules via
    PUT /me/modules. Stricter rate limit than login (abuse surface).
    """
    if not settings.SIGNUP_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Signup is currently disabled",
        )
    user = _create_user(
        username=payload.username,
        password=payload.password,
        email=payload.email,
        full_name=payload.full_name,
        role="viewer",
        db=db,
    )
    user.enabled_modules = DEFAULT_SIGNUP_MODULES
    db.commit()
    db.refresh(user)

    # Best-effort: a mail failure must not fail the signup — the user can
    # request a resend from the login screen.
    send_verification_email(user.email, _create_email_verify_token(user.id))

    out = UserOut.model_validate(user)
    out.enabled_modules = effective_modules(user.enabled_modules)
    return out


@router.post("/verify-email")
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    """Confirm an email address from the token sent at signup."""
    try:
        decoded = jwt.decode(payload.token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification link expired")
    except jwt.JWTError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification link")
    if decoded.get("type") != "email_verify":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification link")

    user = db.query(User).filter(User.id == int(decoded["sub"])).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification link")
    if not user.email_verified:
        user.email_verified = True
        db.commit()
    return {"message": "Email verified — you can log in now"}


@router.post("/resend-verification")
@limiter.limit("5/hour")
def resend_verification(request: Request, payload: ResendVerificationRequest, db: Session = Depends(get_db)):
    """Re-send the verification email. Always returns success (no account
    enumeration): the response never reveals whether the address exists."""
    user = db.query(User).filter(User.email == payload.email).first()
    if user is not None and not user.email_verified:
        send_verification_email(user.email, _create_email_verify_token(user.id))
    return {"message": "If that address has an unverified account, a new link has been sent"}


@router.post("/register", response_model=UserOut)
def register(user_data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return _create_user(
        username=user_data.username,
        password=user_data.password,
        email=user_data.email,
        full_name=user_data.full_name,
        role=user_data.role,
        db=db,
    )


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


@router.post("/clear-cookie")
def clear_cookie(response: Response):
    """Clear the refresh_token cookie without requiring authentication.
    Called when the browser holds a blacklisted/expired cookie so it doesn't
    keep blocking the login flow on next page load.
    """
    response.delete_cookie(key="refresh_token", path="/api/auth")
    return {"message": "Cookie cleared"}


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    body: Optional[LogoutRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """C-AUTH-2: Blacklist the refresh token so it cannot be replayed after logout."""
    # C-AUTH-4: Try cookie first, then request body
    raw_token = request.cookies.get("refresh_token") or (body.refresh_token if body else None)
    if raw_token:
        try:
            payload = jwt.decode(
                raw_token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM],
            )
            exp = payload.get("exp")
            if exp:
                expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
                token_hash = _hash_token(raw_token)
                # Only insert if not already present (idempotent)
                existing = db.query(RefreshTokenBlacklist).filter(
                    RefreshTokenBlacklist.token_hash == token_hash
                ).first()
                if not existing:
                    db.add(RefreshTokenBlacklist(
                        token_hash=token_hash,
                        user_id=current_user.id,
                        expires_at=expires_at,
                    ))
                    db.commit()
        except Exception:
            pass  # Expired / invalid tokens are already harmless
    # C-AUTH-4: Always clear the httpOnly refresh cookie on logout
    response.delete_cookie(key="refresh_token", path="/api/auth")
    log_auth_event(db, current_user, "logout", request)
    return {"message": "Logged out successfully"}


class ReadonlyUserCreate(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None
    note: Optional[str] = None   # e.g. "Shared with accountant"


@router.post("/create-readonly", response_model=UserOut)
def create_readonly_user(
    payload: ReadonlyUserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Admin-only: create a read-only credential.
    The issued token can only perform GET requests — all write operations
    (POST/PUT/PATCH/DELETE) will be rejected with 403.
    """
    # Derive a placeholder email from the username; keep it within the internal domain
    placeholder_email = f"{payload.username}@readonly.internal"
    return _create_user(
        username=payload.username,
        password=payload.password,
        email=placeholder_email,
        full_name=payload.full_name,
        role="readonly",
        db=db,
    )


@router.get("/readonly-users", response_model=list[UserOut])
def list_readonly_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin-only: list all readonly credentials."""
    return db.query(User).filter(User.role == "readonly").all()


@router.delete("/readonly-users/{user_id}")
def revoke_readonly_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin-only: deactivate (revoke) a readonly credential."""
    user = db.query(User).filter(User.id == user_id, User.role == "readonly").first()
    if not user:
        raise HTTPException(status_code=404, detail="Readonly user not found")
    user.is_active = False
    db.commit()
    return {"message": f"Readonly user '{user.username}' has been revoked"}
