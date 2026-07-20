"""Read/write runtime settings backed by the platform_settings table, with
config (.env) values as defaults and a short in-process cache.

Registry below defines every runtime-editable setting: its type and the
config attribute that supplies the default. To expose a new toggle, add one
row here — the admin API and UI iterate this registry.
"""
import logging
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models.platform_setting import PlatformSetting

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SettingDef:
    key: str
    type: str          # "bool" | "int" | "str"
    config_attr: str   # attribute on `settings` giving the default
    label: str
    help: str


REGISTRY: dict[str, SettingDef] = {s.key: s for s in [
    SettingDef("signup_enabled", "bool", "SIGNUP_ENABLED",
               "Public signup open", "Allow new users to create accounts."),
    SettingDef("require_email_verification", "bool", "REQUIRE_EMAIL_VERIFICATION",
               "Require email verification", "New users must verify email before login."),
    SettingDef("gold_auto_refresh_enabled", "bool", "GOLD_AUTO_REFRESH_ENABLED",
               "Auto-refresh gold value", "Periodically revalue gold assets & collateral from the live rate."),
]}

_CACHE: dict[str, tuple[float, Any]] = {}
_TTL = 30  # seconds — short so admin changes take effect almost immediately


def _coerce(type_: str, raw: str) -> Any:
    if type_ == "bool":
        return str(raw).lower() in ("1", "true", "yes", "on")
    if type_ == "int":
        return int(raw)
    return raw


def get_setting(db: Session, key: str) -> Any:
    """Effective value: DB override if present, else the config default."""
    d = REGISTRY[key]
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < _TTL:
        return cached[1]
    row = (
        db.query(PlatformSetting)
        .execution_options(skip_tenant_filter=True)
        .filter(PlatformSetting.key == key)
        .first()
    )
    value = _coerce(d.type, row.value) if row is not None else getattr(settings, d.config_attr)
    _CACHE[key] = (now, value)
    return value


def set_setting(db: Session, key: str, value: Any) -> Any:
    if key not in REGISTRY:
        raise ValueError(f"Unknown setting: {key}")
    d = REGISTRY[key]
    stored = "true" if (d.type == "bool" and value in (True, "true", "1", 1, "on", "yes")) \
        else "false" if d.type == "bool" else str(value)
    row = (
        db.query(PlatformSetting)
        .execution_options(skip_tenant_filter=True)
        .filter(PlatformSetting.key == key)
        .first()
    )
    if row is None:
        db.add(PlatformSetting(key=key, value=stored))
    else:
        row.value = stored
    db.commit()
    _CACHE.pop(key, None)
    return _coerce(d.type, stored)


def all_settings(db: Session) -> list[dict]:
    return [
        {
            "key": d.key, "type": d.type, "label": d.label, "help": d.help,
            "value": get_setting(db, d.key),
            "default": getattr(settings, d.config_attr),
        }
        for d in REGISTRY.values()
    ]
