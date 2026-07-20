import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";

/* E4 — Assets module UI: everything you own, valued.
   Gold assets can refresh from the live rate; FDs/RDs show projected
   maturity. One-page CRUD with a modal form. */

const TYPE_META = {
  gold:              { label: "Gold",             icon: "🪙" },
  silver:            { label: "Silver",           icon: "🥈" },
  vehicle:           { label: "Vehicles",         icon: "🚗" },
  real_estate:       { label: "Real Estate",      icon: "🏠" },
  stock:             { label: "Stocks",           icon: "📈" },
  mutual_fund:       { label: "Mutual Funds",     icon: "📊" },
  fixed_deposit:     { label: "Fixed Deposits",   icon: "🏦" },
  recurring_deposit: { label: "Recurring Deposits", icon: "🔁" },
  equipment:         { label: "Equipment",        icon: "🛠️" },
  business:          { label: "Business",         icon: "💼" },
  other:             { label: "Other",            icon: "📦" },
};

const DEPOSIT_TYPES = ["fixed_deposit", "recurring_deposit"];

const EMPTY = {
  name: "", asset_type: "gold", quantity: "", unit: "grams", gold_carat: "24",
  purchase_price: "", purchase_date: "", current_value: "",
  interest_rate: "", monthly_installment: "", start_date: "", maturity_date: "",
  compounding: "quarterly", notes: "",
};

const fmt = (v) =>
  "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

function buildPayload(form) {
  const p = {
    name: form.name.trim(),
    asset_type: form.asset_type,
    current_value: Number(form.current_value),
    notes: form.notes || null,
    purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
    purchase_date: form.purchase_date || null,
  };
  if (form.asset_type === "gold") {
    p.quantity = form.quantity ? Number(form.quantity) : null;
    p.unit = "grams";
    p.gold_carat = form.gold_carat ? Number(form.gold_carat) : null;
  } else if (form.quantity) {
    p.quantity = Number(form.quantity);
    p.unit = form.unit || null;
  }
  if (DEPOSIT_TYPES.includes(form.asset_type)) {
    p.interest_rate = form.interest_rate ? Number(form.interest_rate) : null;
    p.start_date = form.start_date || null;
    p.maturity_date = form.maturity_date || null;
    p.compounding = form.compounding || "quarterly";
    if (form.asset_type === "recurring_deposit") {
      p.monthly_installment = form.monthly_installment
        ? Number(form.monthly_installment) : null;
    }
  }
  return p;
}

function AssetModal({ item, onClose, onSave }) {
  const [form, setForm] = useState(
    item
      ? {
          ...EMPTY,
          ...Object.fromEntries(
            Object.entries(item).map(([k, v]) => [k, v == null ? "" : String(v)])
          ),
        }
      : { ...EMPTY }
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isDeposit = DEPOSIT_TYPES.includes(form.asset_type);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Name is required");
    if (!form.current_value || isNaN(Number(form.current_value)))
      return setError("Enter a valid current value");
    setSaving(true);
    setError("");
    try {
      await onSave(buildPayload(form));
      onClose();
    } catch (err) {
      const d = err?.response?.data?.detail;
      setError(Array.isArray(d) ? d[0]?.msg : d || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition";
  const label = "block text-xs font-medium text-slate-500 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg ring-1 ring-slate-900/5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            {item ? "Edit Asset" : "Add Asset"}
          </h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition text-sm">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 border border-rose-100">{error}</p>}

          <div>
            <label className={label}>Name *</label>
            <input value={form.name} onChange={set("name")} className={input}
                   placeholder="e.g. Wedding gold, SBI FD, Honda City" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Type *</label>
              <select value={form.asset_type} onChange={set("asset_type")} className={`${input} bg-white`}>
                {Object.entries(TYPE_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Current Value (₹) *</label>
              <input type="number" step="0.01" value={form.current_value}
                     onChange={set("current_value")} className={input} placeholder="150000" />
            </div>
          </div>

          {form.asset_type === "gold" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Weight (grams)</label>
                <input type="number" step="0.001" value={form.quantity}
                       onChange={set("quantity")} className={input} placeholder="20" />
              </div>
              <div>
                <label className={label}>Carat</label>
                <select value={form.gold_carat} onChange={set("gold_carat")} className={`${input} bg-white`}>
                  <option value="24">24k</option>
                  <option value="22">22k</option>
                  <option value="18">18k</option>
                </select>
              </div>
            </div>
          )}

          {isDeposit && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Interest Rate (% p.a.)</label>
                  <input type="number" step="0.01" value={form.interest_rate}
                         onChange={set("interest_rate")} className={input} placeholder="7.1" />
                </div>
                {form.asset_type === "recurring_deposit" ? (
                  <div>
                    <label className={label}>Monthly Installment (₹) *</label>
                    <input type="number" step="0.01" value={form.monthly_installment}
                           onChange={set("monthly_installment")} className={input} placeholder="5000" />
                  </div>
                ) : (
                  <div>
                    <label className={label}>Compounding</label>
                    <select value={form.compounding} onChange={set("compounding")} className={`${input} bg-white`}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="half_yearly">Half-yearly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Start Date</label>
                  <input type="date" value={form.start_date} onChange={set("start_date")} className={input} />
                </div>
                <div>
                  <label className={label}>Maturity Date</label>
                  <input type="date" value={form.maturity_date} onChange={set("maturity_date")} className={input} />
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Purchase Price (₹)</label>
              <input type="number" step="0.01" value={form.purchase_price}
                     onChange={set("purchase_price")} className={input} placeholder="100000" />
            </div>
            <div>
              <label className={label}>Purchase Date</label>
              <input type="date" value={form.purchase_date} onChange={set("purchase_date")} className={input} />
            </div>
          </div>

          <div>
            <label className={label}>Notes</label>
            <textarea value={form.notes} onChange={set("notes")} rows={2} className={input} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-50">
              {saving ? "Saving..." : item ? "Save Changes" : "Add Asset"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AssetList() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [refreshingId, setRefreshingId] = useState(null);
  const [toast, setToast] = useState(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.get("/api/assets").then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["assets"] });

  const createMutation = useMutation({
    mutationFn: (p) => api.post("/api/assets", p), onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...p }) => api.put(`/api/assets/${id}`, p), onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/assets/${id}`), onSuccess: invalidate,
  });

  async function refreshGold(id) {
    setRefreshingId(id);
    try {
      await api.post(`/api/assets/${id}/refresh-value`);
      invalidate();
      setToast({ kind: "ok", text: "Updated from live gold rate" });
    } catch (err) {
      setToast({ kind: "err", text: err?.response?.data?.detail || "Refresh failed" });
    } finally {
      setRefreshingId(null);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const total = assets.reduce((s, a) => s + Number(a.current_value || 0), 0);
  const byType = assets.reduce((acc, a) => {
    (acc[a.asset_type] = acc[a.asset_type] || []).push(a);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <>
      {modal && (
        <AssetModal
          item={modal.item || null}
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            if (modal.mode === "add") await createMutation.mutateAsync(payload);
            else await updateMutation.mutateAsync({ id: modal.item.id, ...payload });
          }}
        />
      )}

      <div className="min-h-screen bg-[#f5f5f7]">
        <div className="max-w-5xl mx-auto px-4 py-7 space-y-5">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Assets</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {assets.length} asset{assets.length === 1 ? "" : "s"} · Total {fmt(total)}
              </p>
            </div>
            <button onClick={() => setModal({ mode: "add" })}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition shadow-sm">
              + Add Asset
            </button>
          </div>

          {toast && (
            <div className={`px-4 py-2.5 rounded-xl text-sm border ${
              toast.kind === "ok"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-rose-50 text-rose-700 border-rose-200"}`}>
              {toast.text}
            </div>
          )}

          {assets.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
              <p className="text-3xl mb-2">💎</p>
              <p className="text-sm font-medium text-slate-700">No assets yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Log your gold, vehicles, FDs, stocks — anything you own.
              </p>
            </div>
          )}

          {Object.entries(byType).map(([type, items]) => (
            <section key={type} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">
                  {TYPE_META[type]?.icon} {TYPE_META[type]?.label || type}
                </h2>
                <span className="text-xs font-semibold text-slate-500">
                  {fmt(items.reduce((s, a) => s + Number(a.current_value || 0), 0))}
                </span>
              </div>
              <ul className="divide-y divide-slate-50">
                {items.map((a) => (
                  <li key={a.id} className="px-5 py-3.5 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 space-x-2">
                        {a.quantity && <span>{Number(a.quantity)} {a.unit}</span>}
                        {a.gold_carat && <span>{a.gold_carat}k</span>}
                        {a.gain != null && (
                          <span className={Number(a.gain) >= 0 ? "text-emerald-600" : "text-rose-600"}>
                            {Number(a.gain) >= 0 ? "▲" : "▼"} {fmt(Math.abs(a.gain))} ({Number(a.gain_pct).toFixed(1)}%)
                          </span>
                        )}
                        {a.projected_maturity_value && (
                          <span className="text-indigo-500">
                            matures at {fmt(a.projected_maturity_value)}
                            {a.days_to_maturity > 0 && ` in ${a.days_to_maturity}d`}
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{fmt(a.current_value)}</p>
                    <div className="flex items-center gap-1">
                      {a.asset_type === "gold" && a.quantity && a.gold_carat && (
                        <button
                          onClick={() => refreshGold(a.id)}
                          disabled={refreshingId === a.id}
                          title="Refresh from live gold rate"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition text-sm disabled:opacity-50"
                        >
                          {refreshingId === a.id ? "…" : "⟳"}
                        </button>
                      )}
                      <button onClick={() => setModal({ mode: "edit", item: a })}
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition text-sm">
                        ✎
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete "${a.name}"?`)) deleteMutation.mutate(a.id);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition text-sm">
                        🗑
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
