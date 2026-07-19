"""Module registry — the single source of truth for feature entitlements.

Every feature area ("module") a user can have is declared here. The frontend
mirrors this list (frontend/src/lib/modules.js) for navigation/questionnaire,
but the SERVER is the authority: `users.enabled_modules` is validated against
this registry, and optional-module routers are gated with
`require_module(<key>)` (app/dependencies.py).

Semantics of `users.enabled_modules`:
  - None  -> ALL modules enabled (legacy/grandfathered accounts, incl. the
             platform admin). Explicit lists are only written by signup /
             the questionnaire / the Settings page.
  - list  -> exactly these modules (core modules are always force-included
             by validate_module_keys, so a stored list is never missing them).

Household guests inherit the tenant OWNER's modules — a guest of your books
sees your feature set, not their own.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Module:
    key: str
    label: str
    description: str
    core: bool = False               # core modules are always on for everyone
    suggested_with: tuple = field(default_factory=tuple)  # soft hint for the UI, not enforced


MODULE_REGISTRY: dict[str, Module] = {m.key: m for m in [
    # ── Core: every user gets these ─────────────────────────────────────────
    Module("dashboard", "Dashboard", "Overview of your finances", core=True),
    Module("accounts", "Accounts", "Bank/cash accounts and their ledger", core=True),
    Module("contacts", "Contacts", "People and businesses you deal with", core=True),
    Module("expenses", "Expenses", "Daily expense tracking with categories and limits", core=True),
    Module("obligations", "Money Flow", "Money you owe or are owed (udhaar)", core=True),
    Module("net_worth", "Net Worth", "Combined view of what you own and owe", core=True),
    # ── Optional: chosen at signup / in Settings ────────────────────────────
    Module("loans", "Loans & Lending", "Money lent or borrowed with interest, EMIs, collateral"),
    Module("property", "Property Deals", "Land/plot deals, site plans, buyers and sellers"),
    Module("partnerships", "Partnerships", "Shared ventures with profit/loss splitting",
           suggested_with=("property",)),
    Module("beesi", "Beesi / Committee", "Rotating committee savings (chit funds)"),
    Module("assets", "Assets", "Gold, silver, vehicles, FDs, stocks and other holdings"),
    Module("forecast", "Forecast & Liquidity", "Cash-flow forecasting and recurring transactions"),
    Module("expense_analytics", "Expense Analytics", "Charts and trends over your spending"),
    Module("reconciliation", "Reconciliation", "Cross-check ledgers against module records"),
    Module("reports", "Reports", "PDF / Excel exports of your data"),
    Module("chatbot", "AI Assistant", "Ask questions about your finances in plain language"),
]}

CORE_MODULE_KEYS = frozenset(k for k, m in MODULE_REGISTRY.items() if m.core)
ALL_MODULE_KEYS = frozenset(MODULE_REGISTRY)

# What a fresh signup gets before/without the questionnaire.
DEFAULT_SIGNUP_MODULES = sorted(CORE_MODULE_KEYS | {"assets", "expense_analytics"})


def validate_module_keys(keys: list[str]) -> list[str]:
    """Validate a client-supplied module list against the registry.

    Unknown keys raise ValueError; core modules are force-included so a user
    can never lock themselves out of the basics. Returns a sorted, de-duped
    list ready to store in users.enabled_modules.
    """
    unknown = set(keys) - ALL_MODULE_KEYS
    if unknown:
        raise ValueError(f"Unknown module keys: {sorted(unknown)}")
    return sorted(set(keys) | CORE_MODULE_KEYS)


def effective_modules(owner_enabled: list[str] | None) -> list[str]:
    """Resolve a tenant owner's stored value to the actual enabled set."""
    if owner_enabled is None:
        return sorted(ALL_MODULE_KEYS)
    return sorted(set(owner_enabled) | CORE_MODULE_KEYS)
