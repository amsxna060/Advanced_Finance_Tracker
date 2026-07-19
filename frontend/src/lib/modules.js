/**
 * Frontend mirror of the backend module registry (backend/app/modules.py).
 *
 * The SERVER is the authority — it validates PUT /api/auth/me/modules and
 * gates routers with require_module. This mirror only drives UI: navigation
 * filtering, the onboarding questionnaire, and the Settings toggles.
 * `user.enabled_modules` arrives already resolved from GET /api/auth/me.
 */

export const MODULES = [
  // Core — always on, not shown as toggles
  { key: "dashboard", label: "Dashboard", core: true },
  { key: "accounts", label: "Accounts", core: true },
  { key: "contacts", label: "Contacts", core: true },
  { key: "expenses", label: "Expenses", core: true },
  { key: "obligations", label: "Money Flow", core: true },
  { key: "net_worth", label: "Net Worth", core: true },
  // Optional
  { key: "loans", label: "Loans & Lending", description: "Money lent or borrowed with interest, EMIs, collateral" },
  { key: "property", label: "Property Deals", description: "Land/plot deals, site plans, buyers and sellers" },
  { key: "partnerships", label: "Partnerships", description: "Shared ventures with profit/loss splitting" },
  { key: "beesi", label: "Beesi / Committee", description: "Rotating committee savings (chit funds)" },
  { key: "assets", label: "Assets", description: "Gold, silver, vehicles, FDs, stocks and other holdings" },
  { key: "forecast", label: "Forecast & Liquidity", description: "Cash-flow forecasting and recurring transactions" },
  { key: "expense_analytics", label: "Expense Analytics", description: "Charts and trends over your spending" },
  { key: "reconciliation", label: "Reconciliation", description: "Cross-check ledgers against module records" },
  { key: "reports", label: "Reports", description: "PDF / Excel exports of your data" },
  { key: "chatbot", label: "AI Assistant", description: "Ask questions about your finances in plain language" },
];

export const OPTIONAL_MODULES = MODULES.filter((m) => !m.core);
export const CORE_KEYS = MODULES.filter((m) => m.core).map((m) => m.key);

/** Does this user have the module? null/undefined enabled_modules = all. */
export function hasModule(user, key) {
  if (!key) return true; // untagged nav items are always visible
  const enabled = user?.enabled_modules;
  if (enabled == null) return true;
  return enabled.includes(key);
}

/**
 * Onboarding questionnaire: plain-language questions -> module keys.
 * Answering "yes" adds the modules; the default set is always included.
 */
export const QUESTIONNAIRE = [
  {
    id: "lending",
    question: "Do you lend money to (or borrow from) people — with interest, EMIs or collateral?",
    modules: ["loans"],
  },
  {
    id: "property",
    question: "Do you deal in property — land, plots, flats — buying or selling?",
    modules: ["property"],
  },
  {
    id: "partners",
    question: "Do you run ventures or deals jointly with partners, splitting profits?",
    modules: ["partnerships", "property"],
  },
  {
    id: "beesi",
    question: "Are you part of a beesi / committee (rotating group savings)?",
    modules: ["beesi"],
  },
  {
    id: "planning",
    question: "Do you want cash-flow forecasting, recurring transactions and downloadable reports?",
    modules: ["forecast", "reports", "reconciliation"],
  },
];

/** Modules every new account starts with (mirror of DEFAULT_SIGNUP_MODULES). */
export const DEFAULT_MODULES = [...CORE_KEYS, "assets", "expense_analytics"];
