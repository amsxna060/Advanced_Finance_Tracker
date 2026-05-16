"""
Application configuration loaded via pydantic-settings.

How values are resolved (highest priority first):
  1. Real environment variables  (export DATABASE_URL=... or Docker env)
  2. .env file in the working directory
  3. Python default declared below  (only for fields that have one)

Fields marked "Required" have NO Python default.  If they are absent from
both the environment and the .env file, pydantic-settings raises a
ValidationError at import time — the app refuses to start rather than
silently using wrong/insecure values.

Fields marked "Safe default" are non-sensitive tunables; the hardcoded
value is sensible for local development and can be overridden via env.

Fields marked "Optional feature" default to empty/disabled; the feature
degrades gracefully when not configured.
"""
from pydantic_settings import BaseSettings
from pydantic import validator
from typing import List


class Settings(BaseSettings):
    # ── Required — no default, app won't start without these in env ──────
    DATABASE_URL: str
    SECRET_KEY: str
    SEED_ADMIN_PASSWORD: str

    # ── Safe defaults (override via env for production tweaks) ────────────
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30   # was 15 — now matches .env.example
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    CORS_ORIGINS: str = "http://localhost:5173"
    GOLD_API_URL: str = "https://goldpricez.com/api/rates/currency/inr/measure/gram"
    GOLD_CACHE_TTL_SECONDS: int = 3600
    SEED_ADMIN_USERNAME: str = "admin"
    SEED_ADMIN_EMAIL: str = "admin@finance.local"
    APP_ENV: str = "development"

    # ── Optional features — empty/disabled by default ─────────────────────
    # Both read from env exactly like every other field; no os.environ needed.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # ── Validators ────────────────────────────────────────────────────────

    @validator("SECRET_KEY")
    def secret_key_must_be_strong(cls, v, values):
        env = values.get("APP_ENV", "development")
        # C-AUTH-3: enforce strong key in both production AND staging
        if env in ("production", "staging") and (v == "change-this-secret-key-in-production" or len(v) < 32):
            raise ValueError(
                "SECRET_KEY must be set to a random 32+ character string in production/staging. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return v

    @validator("CORS_ORIGINS")
    def cors_origins_no_wildcard(cls, v, values):
        # H-SEC-1: prevent CORS misconfiguration with wildcard + credentials
        # Wildcard '*' with allow_credentials=True is rejected by browsers and is insecure.
        origins = [o.strip() for o in v.split(",")]
        if "*" in origins:
            raise ValueError(
                "CORS_ORIGINS must not include '*' when allow_credentials=True. "
                "Specify explicit origins instead."
            )
        return v

    @validator("SEED_ADMIN_PASSWORD")
    def admin_password_must_not_be_default(cls, v, values):
        env = values.get("APP_ENV", "development")
        if env == "production" and v == "admin123":
            raise ValueError("SEED_ADMIN_PASSWORD must be changed from the default in production.")
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
