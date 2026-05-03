import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

/* ── constants ──────────────────────────────────────────────────────────── */

const ASSET_COLORS  = ["#10b981", "#6366f1", "#8b5cf6", "#06b6d4", "#f59e0b", "#ec4899", "#14b8a6", "#a855f7"];
const LIAB_COLORS   = ["#ef4444", "#f97316", "#e11d48", "#d946ef", "#dc2626"];
const PROPERTY_BAR_COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#a855f7", "#14b8a6"];

const CATEGORY_META = {
  real_estate:     { label: "Real Estate",    icon: "🏠" },
  gold:            { label: "Gold",           icon: "🪙" },
  vehicle:         { label: "Vehicle",        icon: "🚗" },
  equipment:       { label: "Equipment",      icon: "⚙️" },
  business:        { label: "Business",       icon: "💼" },
  fixed_deposit:   { label: "Fixed Deposit",  icon: "🏦" },
  other:           { label: "Other",          icon: "📦" },
};

const SECTION_META = {
  cash:               { label: "Cash & Bank Accounts",      icon: "💰", link: (id) => `/accounts/${id}` },
  loans_given:        { label: "Loans Given (Receivable)",  icon: "📤", link: (id) => `/loans/${id}` },
  properties:         { label: "Property Investments",      icon: "🏠", link: (id) => `/properties/${id}` },
  partnerships:       { label: "Partnership Investments",   icon: "🤝", link: (id) => `/partnerships/${id}` },
  receivables:        { label: "Receivables",               icon: "📋" },
  unencumbered_assets:{ label: "Standalone Assets",         icon: "🔑" },
  loans_taken:        { label: "Loans Taken (Owed)",        icon: "📥", link: (id) => `/loans/${id}` },
  payables:           { label: "Payables",                  icon: "📋" },
  partner_payables:   { label: "Partner Payables",          icon: "🤝" },
  self_payables:      { label: "Over-Withdrawals (Owed to Pot)", icon: "⚠️" },
};

const CATEGORY_OPTIONS = [
  { value: "real_estate",   label: "Real Estate" },
  { value: "gold",          label: "Gold" },
  { value: "vehicle",       label: "Vehicle" },
  { value: "equipment",     label: "Equipment" },
  { value: "business",      label: "Business" },
  { value: "fixed_deposit", label: "Fixed Deposit" },
  { value: "other",         label: "Other" },
];

/* ── helpers ────────────────────────────────────────────────────────────── */

function pct(part, total) {
  if (!total || !part) return "0";
  return ((part / total) * 100).toFixed(1);
}

/* ── custom tooltip for recharts ────────────────────────────────────────── */
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-slate-800 mb-0.5">{payload[0].name}</p>
      <p className="text-slate-600">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

/* ── Unencumbered Asset Modal ───────────────────────────────────────────── */

const EMPTY_FORM = { title: "", category: "other", estimated_value: "", date_acquired: "", notes: "" };

function UnencumberedModal({ item, onClose, onSave }) {
  const [form, setForm] = useState(item
    ? { ...item, estimated_value: String(item.estimated_value), date_acquired: item.date_acquired || "" }
    : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  function field(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required"); return; }
    if (!form.estimated_value || isNaN(Number(form.estimated_value))) {
      setError("Enter a valid estimated value"); return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ ...form, estimated_value: Number(form.estimated_value) });
      onClose();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">
            {item ? "Edit Asset" : "Add Standalone Asset"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input value={form.title} onChange={(e) => field("title", e.target.value)}
              placeholder="e.g. Gold jewellery, Plot #5, Honda City"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Category *</label>
              <select value={form.category} onChange={(e) => field("category", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white">
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Estimated Value (₹) *</label>
              <input type="number" step="0.01" value={form.estimated_value}
                onChange={(e) => field("estimated_value", e.target.value)}
                placeholder="e.g. 2500000"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date Acquired</label>
            <input type="date" value={form.date_acquired} onChange={(e) => field("date_acquired", e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea value={form.notes || ""} onChange={(e) => field("notes", e.target.value)}
              rows={2} placeholder="Optional description…"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition">
              {saving ? "Saving…" : item ? "Update" : "Add Asset"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Unencumbered Assets Section ────────────────────────────────────────── */

function UnencumberedSection({ items, onAdd, onEdit, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(null);
  const total = items.reduce((s, i) => s + i.estimated_value, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-base">🔑</span>
          <span className="text-sm font-semibold text-slate-800">Standalone Assets</span>
          <span className="text-xs text-slate-400">({items.length})</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-emerald-700">{formatCurrency(total)}</span>
          <button onClick={onAdd}
            className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition">
            + Add
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">
          <p>No standalone assets yet.</p>
          <button onClick={onAdd} className="mt-2 text-indigo-600 text-xs hover:underline">
            Add your first asset →
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {items.map((item) => {
            const cm = CATEGORY_META[item.category] || CATEGORY_META.other;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition group">
                <span className="text-lg shrink-0">{cm.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-800 truncate">{item.title}</span>
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium capitalize">
                      {cm.label}
                    </span>
                  </div>
                  {item.date_acquired && (
                    <p className="text-[10px] text-slate-400 mt-0.5">Acquired: {item.date_acquired}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-emerald-700">{formatCurrency(item.estimated_value)}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => onEdit(item)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition">
                      Edit
                    </button>
                    {confirmDel === item.id ? (
                      <span className="flex items-center gap-1">
                        <button onClick={() => { onDelete(item.id); setConfirmDel(null); }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-rose-300 text-rose-600 bg-rose-50 hover:bg-rose-100 transition">
                          Confirm
                        </button>
                        <button onClick={() => setConfirmDel(null)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition">
                          ×
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDel(item.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-500 transition">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Property Charts ────────────────────────────────────────────────────── */

function PropertyCharts({ assets, totalAssets }) {
  const propItems    = assets?.properties?.items     || [];
  const partItems    = assets?.partnerships?.items   || [];
  const unencItems   = assets?.unencumbered_assets?.items || [];
  const loanItems    = assets?.loans_given           || {};
  const cashTotal    = assets?.cash?.total           || 0;

  // Allocation donut: property investment vs other asset classes
  const allocationData = useMemo(() => {
    const propTotal = assets?.properties?.total     || 0;
    const partTotal = assets?.partnerships?.total   || 0;
    const unencTotal= assets?.unencumbered_assets?.total || 0;
    const loanTotal = loanItems?.total || 0;
    const recvTotal = assets?.receivables?.total    || 0;

    return [
      propTotal  > 0 && { name: "Properties",      value: propTotal,  color: "#6366f1" },
      partTotal  > 0 && { name: "Partnerships",     value: partTotal,  color: "#8b5cf6" },
      unencTotal > 0 && { name: "Standalone Assets",value: unencTotal, color: "#f59e0b" },
      loanTotal  > 0 && { name: "Loans Given",      value: loanTotal,  color: "#10b981" },
      cashTotal  > 0 && { name: "Cash & Accounts",  value: cashTotal,  color: "#06b6d4" },
      recvTotal  > 0 && { name: "Receivables",      value: recvTotal,  color: "#ec4899" },
    ].filter(Boolean);
  }, [assets, cashTotal]);

  // Per-property/partnership invested capital bar chart
  const barData = useMemo(() => {
    const rows = [
      ...propItems.map((p, i) => ({
        name: p.title.length > 18 ? p.title.slice(0, 16) + "…" : p.title,
        fullName: p.title,
        value: p.invested || p.current_value || 0,
        color: PROPERTY_BAR_COLORS[i % PROPERTY_BAR_COLORS.length],
        kind: "property",
      })),
      ...partItems.map((p, i) => ({
        name: p.title.length > 18 ? p.title.slice(0, 16) + "…" : p.title,
        fullName: p.title,
        value: p.invested || 0,
        color: PROPERTY_BAR_COLORS[(propItems.length + i) % PROPERTY_BAR_COLORS.length],
        kind: "partnership",
      })),
    ].sort((a, b) => b.value - a.value);
    return rows;
  }, [propItems, partItems]);

  if (allocationData.length === 0 && barData.length === 0) return null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* Allocation Donut */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Asset Allocation</h3>
        </div>
        {allocationData.length === 0 ? (
          <div className="flex items-center justify-center h-44 text-slate-400 text-sm">No data</div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-44 h-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={allocationData} cx="50%" cy="50%"
                    innerRadius={48} outerRadius={78} paddingAngle={3} dataKey="value" stroke="none">
                    {allocationData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {allocationData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-slate-600 truncate flex-1">{d.name}</span>
                  <span className="text-slate-400 shrink-0 w-10 text-right">{pct(d.value, totalAssets)}%</span>
                  <span className="font-semibold text-slate-800 shrink-0 w-24 text-right">{formatCurrency(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Per-property bar chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-violet-500" />
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Invested Capital per Deal</h3>
        </div>
        {barData.length === 0 ? (
          <div className="flex items-center justify-center h-44 text-slate-400 text-sm">No deals found</div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 24, left: 0 }}
                barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8" }}
                  interval={0} angle={-25} textAnchor="end" />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={(v) => {
                  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
                  if (v >= 1e5) return `${(v / 1e5).toFixed(0)}L`;
                  return `${(v / 1e3).toFixed(0)}K`;
                }} width={36} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-xs">
                      <p className="font-semibold text-slate-800 mb-0.5">{d.fullName}</p>
                      <p className="text-slate-500 capitalize text-[10px]">{d.kind}</p>
                      <p className="text-indigo-700 font-bold">{formatCurrency(d.value)}</p>
                    </div>
                  );
                }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────── */

export default function NetWorth() {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const [modal, setModal] = useState(null); // null | { mode: "add" | "edit", item?: {} }

  const { data, isLoading } = useQuery({
    queryKey: ["net-worth-assets"],
    queryFn: () => api.get("/api/analytics/assets").then((r) => r.data),
  });

  const { data: unencItems = [] } = useQuery({
    queryKey: ["unencumbered-assets"],
    queryFn: () => api.get("/api/unencumbered-assets").then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => api.post("/api/unencumbered-assets", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unencumbered-assets"] });
      qc.invalidateQueries({ queryKey: ["net-worth-assets"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }) => api.put(`/api/unencumbered-assets/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unencumbered-assets"] });
      qc.invalidateQueries({ queryKey: ["net-worth-assets"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/unencumbered-assets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unencumbered-assets"] });
      qc.invalidateQueries({ queryKey: ["net-worth-assets"] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }
  if (!data) return null;

  const { net_worth, total_assets, total_liabilities, assets, liabilities, collateral_info } = data;

  const assetDonut = Object.entries(assets)
    .filter(([, v]) => v.total > 0)
    .map(([k, v], i) => ({
      name: SECTION_META[k]?.label || k,
      value: v.total,
      color: ASSET_COLORS[i % ASSET_COLORS.length],
    }));

  const liabilityDonut = Object.entries(liabilities)
    .filter(([, v]) => v.total > 0)
    .map(([k, v], i) => ({
      name: SECTION_META[k]?.label || k,
      value: v.total,
      color: LIAB_COLORS[i % LIAB_COLORS.length],
    }));

  const hasCollateral = (collateral_info?.total || 0) > 0;

  return (
    <>
      {modal && (
        <UnencumberedModal
          item={modal.item || null}
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            if (modal.mode === "add") {
              await createMutation.mutateAsync(payload);
            } else {
              await updateMutation.mutateAsync({ id: modal.item.id, ...payload });
            }
          }}
        />
      )}

      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Net Worth &amp; Assets</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Balance sheet · As of {data.as_of_date}
              </p>
            </div>
            <button
              onClick={() => setModal({ mode: "add" })}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition shadow-sm">
              + Add Standalone Asset
            </button>
          </div>

          {/* Net Worth Hero */}
          <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 text-white">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className="text-center md:text-left">
                <p className="text-xs uppercase tracking-wider text-white/60 font-medium">Total Assets</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(total_assets)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs uppercase tracking-wider text-white/60 font-medium">Net Worth</p>
                <p className="text-4xl font-extrabold mt-1">{formatCurrency(net_worth)}</p>
                <p className="text-xs text-white/50 mt-1">assets − liabilities</p>
              </div>
              <div className="text-center md:text-right">
                <p className="text-xs uppercase tracking-wider text-white/60 font-medium">Total Liabilities</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(total_liabilities)}</p>
              </div>
            </div>
            {/* Proportion bar */}
            <div className="mt-4">
              <div className="h-3 bg-white/20 rounded-full overflow-hidden flex">
                {total_assets + total_liabilities > 0 && (
                  <>
                    <div className="bg-emerald-400 h-full rounded-l-full transition-all"
                      style={{ width: `${(total_assets / (total_assets + total_liabilities)) * 100}%` }} />
                    <div className="bg-red-400 h-full rounded-r-full transition-all"
                      style={{ width: `${(total_liabilities / (total_assets + total_liabilities)) * 100}%` }} />
                  </>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-white/50 mt-1">
                <span>Assets ({pct(total_assets, total_assets + total_liabilities)}%)</span>
                <span>Liabilities ({pct(total_liabilities, total_assets + total_liabilities)}%)</span>
              </div>
            </div>
          </div>

          {/* Donut Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <DonutSection title="Assets Breakdown" data={assetDonut} total={total_assets} />
            <DonutSection title="Liabilities Breakdown" data={liabilityDonut} total={total_liabilities} />
          </div>

          {/* Property & Investment Charts */}
          <PropertyCharts assets={assets} totalAssets={total_assets} />

          {/* Unencumbered Assets (managed separately for CRUD) */}
          <UnencumberedSection
            items={unencItems}
            onAdd={() => setModal({ mode: "add" })}
            onEdit={(item) => setModal({ mode: "edit", item })}
            onDelete={(id) => deleteMutation.mutate(id)}
          />

          {/* Asset sections */}
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-3">Assets</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {Object.entries(assets)
                .filter(([k]) => k !== "unencumbered_assets") // shown separately above
                .map(([key, section]) => (
                  <ItemSection key={key} sectionKey={key} section={section} navigate={navigate} />
                ))}
            </div>
          </div>

          {/* Liability sections */}
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-3">Liabilities</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {Object.entries(liabilities).map(([key, section]) => (
                <ItemSection key={key} sectionKey={key} section={section} navigate={navigate} isLiability />
              ))}
            </div>
          </div>

          {/* Collateral Info (informational — NOT counted in assets) */}
          {hasCollateral && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">🔒</span>
                <div>
                  <h3 className="text-sm font-semibold text-amber-800">
                    Collateral Held — {formatCurrency(collateral_info.total)}
                  </h3>
                  <p className="text-xs text-amber-700 mt-0.5">
                    This collateral belongs to your borrowers and is held as security only.
                    It is <strong>not counted</strong> in your total assets.
                  </p>
                  <div className="mt-2 space-y-1">
                    {(collateral_info.items || []).map((c) => (
                      <div key={c.id} className="text-xs text-amber-800 flex justify-between">
                        <span>{c.description || c.type} — {c.contact}</span>
                        <span className="font-medium">{formatCurrency(c.estimated_value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── DonutSection ────────────────────────────────────────────────────────── */

function DonutSection({ title, data, total }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${title.includes("Asset") ? "bg-emerald-500" : "bg-rose-500"}`} />
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">{title}</h3>
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-44 text-slate-400 text-sm">No data</div>
      ) : (
        <div className="flex items-center gap-5">
          <div className="w-44 h-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={48} outerRadius={80}
                  paddingAngle={2} dataKey="value" nameKey="name" stroke="none">
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {data.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                <span className="text-slate-600 truncate flex-1">{d.name}</span>
                <span className="text-slate-400 shrink-0 w-10 text-right">{pct(d.value, total)}%</span>
                <span className="font-semibold text-slate-800 shrink-0 w-24 text-right">{formatCurrency(d.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ItemSection ─────────────────────────────────────────────────────────── */

function ItemSection({ sectionKey, section, navigate, isLiability }) {
  const [expanded, setExpanded] = useState(false);
  const meta  = SECTION_META[sectionKey] || { label: sectionKey, icon: "📦" };
  const items = section.items || [];
  if (section.total <= 0 && items.length === 0) return null;

  const displayItems = expanded ? items : items.slice(0, 5);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition">
        <div className="flex items-center gap-2">
          <span className="text-lg">{meta.icon}</span>
          <span className="text-sm font-semibold text-slate-800">{meta.label}</span>
          <span className="text-xs text-slate-400">({items.length})</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-base font-bold ${isLiability ? "text-rose-700" : "text-emerald-700"}`}>
            {formatCurrency(section.total)}
          </span>
          <span className="text-slate-400 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {!expanded && section.principal !== undefined && (
        <div className="px-4 pb-3 flex gap-4 text-xs text-slate-500">
          <span>Principal: {formatCurrency(section.principal)}</span>
          <span>Interest: {formatCurrency(section.interest)}</span>
        </div>
      )}

      {expanded && items.length > 0 && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {displayItems.map((item, i) => (
            <ItemRow key={i} item={item} sectionKey={sectionKey} navigate={navigate} isLiability={isLiability} />
          ))}
          {items.length > 5 && expanded && (
            <div className="px-4 py-2 text-center text-xs text-slate-400">
              Showing all {items.length} items
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── ItemRow ─────────────────────────────────────────────────────────────── */

function ItemRow({ item, sectionKey, navigate, isLiability }) {
  const meta   = SECTION_META[sectionKey];
  const linkFn = meta?.link;
  const primary = item.name || item.contact || item.title || item.partner || "—";
  const amount  = item.total_outstanding || item.balance || item.current_value
    || item.net_value || item.pending || item.estimated_value || 0;
  const sub = item.loan_type || item.property_type || item.type || item.reason
    || item.description || item.category || "";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-800 truncate">{primary}</span>
          {sub && <span className="text-[10px] text-slate-400 capitalize truncate">{sub}</span>}
          {item.status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              item.status === "active"   ? "bg-green-50 text-green-700" :
              item.status === "settled"  ? "bg-blue-50 text-blue-700"  :
              "bg-slate-100 text-slate-600"
            }`}>{item.status}</span>
          )}
          {item.rate > 0 && <span className="text-[10px] text-slate-400">{item.rate}%</span>}
        </div>
        {item.due_date && <p className="text-[10px] text-slate-400 mt-0.5">Due: {item.due_date}</p>}
        {item.principal_outstanding !== undefined && (
          <p className="text-[10px] text-slate-400 mt-0.5">
            P: {formatCurrency(item.principal_outstanding)} · I: {formatCurrency(item.interest_outstanding)}
          </p>
        )}
        {item.invested !== undefined && (
          <p className="text-[10px] text-slate-400 mt-0.5">
            Invested: {formatCurrency(item.invested)}
            {item.received !== undefined && ` · Received: ${formatCurrency(item.received)}`}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 flex items-center gap-2">
        <span className={`text-sm font-bold ${isLiability ? "text-rose-700" : "text-emerald-700"}`}>
          {formatCurrency(amount)}
        </span>
        {linkFn && item.id && (
          <button onClick={() => navigate(linkFn(item.id))}
            className="text-xs text-indigo-600 hover:text-indigo-800 transition">→</button>
        )}
      </div>
    </div>
  );
}
