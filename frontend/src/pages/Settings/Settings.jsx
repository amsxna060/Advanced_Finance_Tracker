import React, { useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import api from "../../lib/api";
import { OPTIONAL_MODULES, CORE_KEYS, hasModule } from "../../lib/modules";
import { cn } from "../../lib/utils";

/**
 * FB-3.6 — Settings: manage enabled modules.
 * Disabling a module hides its pages and API; it never deletes data.
 * Only the account owner (not household guests) can change modules.
 */
export default function Settings() {
  const { user, refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // {kind: "ok"|"err", text}

  const isOwner = !user?.tenant_owner_id;
  const enabled = new Set(
    user?.enabled_modules ?? [...CORE_KEYS, ...OPTIONAL_MODULES.map((m) => m.key)]
  );

  const toggle = async (key) => {
    if (!isOwner || saving) return;
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSaving(true);
    setMessage(null);
    try {
      await api.put("/api/auth/me/modules", { modules: [...next] });
      await refreshUser();
      setMessage({ kind: "ok", text: "Modules updated." });
    } catch (err) {
      setMessage({
        kind: "err",
        text: err.response?.data?.detail || "Could not update modules.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Settings</h1>
      <p className="text-sm text-slate-500 mb-8">
        Choose which features appear in your workspace.
      </p>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Modules</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Turning a module off hides it — your data is kept and comes back
            when you re-enable it.
            {!isOwner && " Only the account owner can change these."}
          </p>
        </div>

        {message && (
          <div
            className={cn(
              "mx-6 mt-4 px-4 py-2.5 rounded-lg text-sm",
              message.kind === "ok"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200",
            )}
          >
            {message.text}
          </div>
        )}

        <ul className="divide-y divide-slate-100">
          {OPTIONAL_MODULES.map((m) => {
            const on = hasModule(user, m.key);
            return (
              <li key={m.key} className="flex items-center justify-between px-6 py-4">
                <div className="pr-4">
                  <p className="text-sm font-medium text-slate-800">{m.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`Toggle ${m.label}`}
                  disabled={!isOwner || saving}
                  onClick={() => toggle(m.key)}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-colors shrink-0",
                    on ? "bg-indigo-500" : "bg-slate-300",
                    (!isOwner || saving) && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                      on ? "translate-x-[22px]" : "translate-x-0.5",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs text-slate-400 mt-6">
        Core features (Dashboard, Accounts, Contacts, Expenses, Money Flow,
        Net Worth) are always on.
      </p>
    </div>
  );
}
