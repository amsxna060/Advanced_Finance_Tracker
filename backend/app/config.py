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
from pydantic import field_validator, model_validator
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
    # Gold valuation sources (free, no API key). Overridable if you switch
    # to a paid provider later. See services/gold_price.py.
    GOLD_PRICE_URL: str = "https://api.gold-api.com/price/XAU"   # USD per troy ounce
    FX_RATE_URL: str = "https://open.er-api.com/v6/latest/USD"   # USD→INR
    GOLD_CACHE_TTL_SECONDS: int = 3600
    # Auto-revalue gold assets & collateral on a schedule (default: on).
    # Also flippable at runtime from the admin portal (platform_settings).
    GOLD_AUTO_REFRESH_ENABLED: bool = True
    GOLD_AUTO_REFRESH_HOURS: int = 3
    # Interest-only loans: how many future months of interest a borrower may
    # prepay before any excess is treated as a principal reduction. Protects
    # principal from being touched when a borrower simply pays next month's
    # interest in advance. Set to 0 to disable the buffer (excess → principal).
    LOAN_INTEREST_PREPAY_MONTHS: int = 2
    SEED_ADMIN_USERNAME: str = "admin"
    SEED_ADMIN_EMAIL: str = "admin@finance.local"
    APP_ENV: str = "development"

    # ── Optional features — empty/disabled by default ─────────────────────
    # Both read from env exactly like every other field; no os.environ needed.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # ── Public signup (E3) ────────────────────────────────────────────────
    # Master switch — public signup is ON. Set SIGNUP_ENABLED=false in .env
    # to close it (e.g. during maintenance).
    SIGNUP_ENABLED: bool = True
    # Email verification is intentionally OFF for now (OTP/email flow is on
    # hold): new users can sign up and use the app immediately. Turn on once
    # SMTP is configured.
    REQUIRE_EMAIL_VERIFICATION: bool = False
    # "console" logs emails (dev/tests) · "smtp" sends via the SMTP_* vars.
    EMAIL_BACKEND: str = "console"
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "FinancerBuddy <no-reply@financerbuddy.com>"
    # Base URL used to build links inside emails (verify page, etc.).
    FRONTEND_URL: str = "http://localhost:5173"

    # Admin accounts are managed with scripts/manage_admin.py, never via env
    # (no credentials in .env). The admin support view is read-only by
    # default with a per-request edit toggle (see app/dependencies.py).

    # ── Async backbone (E7). Empty REDIS_URL = no Redis: Celery tasks run
    # eagerly in-process and APScheduler keeps handling recurring items —
    # the app behaves exactly as before, so deploys don't require Redis. ──
    REDIS_URL: str = ""

    # ── Validators ────────────────────────────────────────────────────────

    @field_validator("CORS_ORIGINS")
    @classmethod
    def cors_origins_no_wildcard(cls, v: str) -> str:
        # H-SEC-1: prevent CORS misconfiguration with wildcard + credentials
        # Wildcard '*' with allow_credentials=True is rejected by browsers and is insecure.
        origins = [o.strip() for o in v.split(",")]
        if "*" in origins:
            raise ValueError(
                "CORS_ORIGINS must not include '*' when allow_credentials=True. "
                "Specify explicit origins instead."
            )
        return v

    @model_validator(mode="after")
    def _enforce_production_hardening(self):
        """C-AUTH-3 (FIX): enforce strong secrets in production/staging.

        IMPORTANT — why this is a model-level 'after' validator and not a
        per-field @validator: the previous implementation referenced APP_ENV
        from inside the SECRET_KEY / SEED_ADMIN_PASSWORD field validators via
        the `values` dict. Pydantic populates `values` in field-declaration
        order, and APP_ENV is declared *after* those fields — so `values` did
        not yet contain APP_ENV, `env` always resolved to the "development"
        default, and these guards were silently skipped even in production.
        A `mode="after"` model validator runs once all fields are populated,
        so APP_ENV is always available regardless of declaration order.
        """
        if self.APP_ENV in ("production", "staging"):
            if self.SECRET_KEY == "change-this-secret-key-in-production" or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "SECRET_KEY must be set to a random 32+ character string in production/staging. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
                )
            if self.SEED_ADMIN_PASSWORD == "admin123":
                raise ValueError(
                    "SEED_ADMIN_PASSWORD must be changed from the default in production/staging."
                )
        return self

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
