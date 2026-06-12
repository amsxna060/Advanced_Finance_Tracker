from pydantic import BaseModel, EmailStr
from typing import Optional
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


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool
    created_at: datetime

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
