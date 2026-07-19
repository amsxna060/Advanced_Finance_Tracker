import re
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import List, Optional
from datetime import datetime


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    role: str = "viewer"


class UserLogin(BaseModel):
    username: str
    password: str


class SignupRequest(BaseModel):
    """Public self-service signup (FB-3.3). No role field — the server
    always assigns 'viewer' (a normal, self-owned tenant)."""
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: Optional[str] = Field(default=None, max_length=255)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("Password must contain at least one letter and one digit")
        return v


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ModulesUpdate(BaseModel):
    modules: List[str]


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool
    created_at: datetime
    email_verified: bool = False
    # Effective entitlements (resolved server-side; None only on legacy
    # serialization paths that don't compute it).
    enabled_modules: Optional[List[str]] = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    # FIX (refresh-token leak): the refresh token is delivered ONLY through the
    # httpOnly, SameSite=Strict cookie set by the backend — it is never echoed
    # in the response body where JS/extensions/logs/proxies could capture it.
    # Kept Optional for backward compatibility with the response schema; it is
    # always None on /login now.
    refresh_token: Optional[str] = None
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = None


class TokenRefresh(BaseModel):
    access_token: str
    token_type: str = "bearer"
