from pydantic_settings import BaseSettings
from pydantic import validator
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://admin:secret@localhost:5432/finance_tracker"
    SECRET_KEY: str = "change-this-secret-key-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    CORS_ORIGINS: str = "http://localhost:5173"
    GOLD_API_URL: str = "https://goldpricez.com/api/rates/currency/inr/measure/gram"
    GOLD_CACHE_TTL_SECONDS: int = 3600
    SEED_ADMIN_USERNAME: str = "admin"
    SEED_ADMIN_PASSWORD: str = "admin123"
    SEED_ADMIN_EMAIL: str = "admin@finance.local"
    APP_ENV: str = "development"
    GEMINI_API_KEY: str = ""

    @validator("SECRET_KEY")
    def secret_key_must_be_strong(cls, v, values):
        env = values.get("APP_ENV", "development")
        if env == "production" and (v == "change-this-secret-key-in-production" or len(v) < 32):
            raise ValueError(
                "SECRET_KEY must be set to a random 32+ character string in production. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
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
