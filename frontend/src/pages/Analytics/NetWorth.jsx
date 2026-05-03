import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

/* ── palette ─────────────────────────────────────────────────────────────── */

const ASSET_PALETTE  = ["#6366f1","#10b981","#8b5cf6","#06b6d4","#f59e0b","#ec4899","#14b8a6","#a855f7"];
const LIAB_PALETTE   = ["#ef4444","#f97316","#e11d48","#d946ef","#dc2626"];
const BAR_PALETTE    = ["#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#a855f7","#14b8a6"];

const CATEGORY_META = {
  real_estate:   { label: "Real Estate",   icon: "🏠" },
  gold:          { label: "Gold",          icon: "🪙" },
  vehicle:       { label: "Vehicle",       icon: "🚗" },
  equipment:     { label: "Equipment",     icon: "⚙️" },
  business:      { label: "Business",      icon: "💼" },
  fixed_deposit: { label: "Fixed Deposit", icon: "🏦" },
  other:         { label: "Other",         icon: "📦" },
};

const SECTION_META = {
  cash:                { label: "Cash & Accounts",          icon: "💰", link: (id) => `/accounts/${id}` },
  loans_given:         { label: "Loans Given",              icon: "📤", link: (id) => `/loans/${id}` },
  properties:          { label: "Property Investments",     icon: "🏠", link: (id) => `/properties/${id}` },
  partnerships:        { label: "Partnership Investments",  icon: "🤝", link: (id) => `/partnerships/${id}` },
  receivables:         { label: "Receivables",              icon: "📋" },
  unencumbered_assets: { label: "Standalone Assets",        icon: "🔑" },
  collateral_pledged:  { label: "Collateral Pledged",       icon: "🏦", link: (id) => `/loans/${id}` },
  loans_taken:         { label: "Loans Taken",              icon: "📥", link: (id) => `/loans/${id}` },
  payables:            { label: "Payables",                 icon: "📋" },
  self_payables:       { label: "Over-Withdrawals (Owed to Pot)", icon: "⚠️" },
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

/* ── helpers ─────────────────────────────────────────────────────────────── */

function pct(part, total) {
  if (!total || !part) return "0";
  return ((part / total) * 100).toFixed(1);
}

function fmtShort(v) {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

/* ── Recharts tooltip ───────────────────────────────────────────────────── */

function SmallTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-xl text-xs pointer-events-none">
      <p className="font-semibold text-slate-800">{payload[0].name}</p>
      <p className="text-slate-500 mt-0.5">{formatCurrency(payload[0].value)}</p>
    </div>
  );
}

/* ── Unencumbered Asset Modal ────────────────────────────────────────────── */

const EMPTY_FORM = { title: "", category: "other", estimated_value: "", date_acquired: "", notes: "" };

function UnencumberedModal({ item, onClose, onSave }) {
  const [form, setForm] = useState(
    item
      ? { ...item, estimated_value: String(item.estimated_value), date_acquired: item.date_acquired || "" }
      : { ...EMPTY_FORM }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  function field(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required"); return; }
    if (!form.estimated_value || isNaN(Number(form.estimated_value))) {
      setError("Enter a valid estimated value"); return;
    }
    setSaving(true); setError("");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md ring-1 ring-slate-900/5">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            {item ? "Edit Asset" : "Add Standalone Asset"}
          </h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition text-sm">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 border border-rose-100">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Title *</label>
            <input value={form.title} onChange={(e) => field("title", e.target.value)}
              placeholder="e.g. Gold jewellery, Honda City, LIC policy"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Category *</label>
              <select value={form.category} onChange={(e) => field("category", e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white outline-none transition">
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Estimated Value (₹) *</label>
              <input type="number" step="0.01" value={form.estimated_value}
                onChange={(e) => field("estimated_value", e.target.value)}
                placeholder="2500000"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Date Acquired</label>
            <input type="date" value={form.date_acquired} onChange={(e) => field("date_acquired", e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Notes</label>
            <textarea value={form.notes || ""} onChange={(e) => field("notes", e.target.value)}
              rows={2} placeholder="Optional description…"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition resize-none" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
              {saving ? "Saving…" : item ? "Update" : "Add Asset"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Bento Donut Card ────────────────────────────────────────────────────── */

function DonutCard({ title, data, total, palette, label }) {
  if (!data.length) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-4">{title}</p>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="w-36 h-36">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={42} outerRadius={68}
                  paddingAngle={2} dataKey="value" stroke="none">
                  {data.map((d, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
                </Pie>
                <Tooltip content={<SmallTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wide">{label}</span>
            <span className="text-sm font-bold text-slate-800 leading-tight">{fmtShort(total)}</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center gap-2 text-xs min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
              <span className="text-slate-600 truncate flex-1 min-w-0">{d.name}</span>
              <span className="text-slate-400 shrink-0 text-[10px]">{pct(d.value, total)}%</span>
              <span className="font-semibold text-slate-800 shrink-0 text-right">{fmtShort(d.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Bento Bar Card ──────────────────────────────────────────────────────── */

function BarCard({ propItems, partItems }) {
  const data = useMemo(() => {
    const rows = [
      ...propItems.map((p, i) => ({
        name: p.title.length > 14 ? p.title.slice(0, 13) + "…" : p.title,
        fullName: p.title,
        value: p.invested || p.current_value || 0,
        color: BAR_PALETTE[i % BAR_PALETTE.length],
        kind: "property",
      })),
      ...partItems.map((p, i) => ({
        name: p.title.length > 14 ? p.title.slice(0, 13) + "…" : p.title,
        fullName: p.title,
        value: p.invested || 0,
        color: BAR_PALETTE[(propItems.length + i) % BAR_PALETTE.length],
        kind: "partnership",
      })),
    ].sort((a, b) => b.value - a.value);
    return rows;
  }, [propItems, partItems]);

  if (!data.length) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-4">Invested Capital per Deal</p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 28, left: 0 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8" }}
              interval={0} angle={-30} textAnchor="end" />
            <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={fmtShort} width={34} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-xl text-xs pointer-events-none">
                  <p className="font-semibold text-slate-800">{d.fullName}</p>
                  <p className="text-slate-400 text-[10px] capitalize">{d.kind}</p>
                  <p className="text-indigo-700 font-bold mt-0.5">{formatCurrency(d.value)}</p>
                </div>
              );
            }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={32}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Standalone Assets Card ──────────────────────────────────────────────── */

function StandaloneCard({ items, onAdd, onEdit, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(null);
  const total = items.reduce((s, i) => s + i.estimated_value, 0);

  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-200/70 shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-600/80">Standalone Assets</p>
          <p className="text-2xl font-bold text-amber-900 mt-0.5">{formatCurrency(total)}</p>
          <p className="text-xs text-amber-700/70 mt-0.5">{items.length} asset{items.length !== 1 ? "s" : ""} · not linked to any deal</p>
        </div>
        <button onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-xl text-xs font-semibold hover:bg-amber-700 transition shadow-sm">
          + Add
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-amber-700/60">No standalone assets yet.</p>
          <button onClick={onAdd} className="mt-1.5 text-xs text-amber-600 font-medium hover:underline">
            Add your first asset →
          </button>
        </div>
      ) : (
        <div className="px-3 pb-3 space-y-1.5">
          {items.map((item) => {
            const cm = CATEGORY_META[item.category] || CATEGORY_META.other;
            return (
              <div key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 bg-white/70 backdrop-blur-sm rounded-xl hover:bg-white/90 transition group border border-amber-100/50">
                <span className="text-xl shrink-0">{cm.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-800 truncate">{item.title}</span>
                    <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                      {cm.label}
                    </span>
                  </div>
                  {item.date_acquired && (
                    <p className="text-[10px] text-slate-400 mt-0.5">Acquired {item.date_acquired}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-amber-800">{formatCurrency(item.estimated_value)}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => onEdit(item)}
                      className="text-[10px] px-2 py-0.5 rounded-lg border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 bg-white transition">
                      Edit
                    </button>
                    {confirmDel === item.id ? (
                      <span className="flex items-center gap-1">
                        <button onClick={() => { onDelete(item.id); setConfirmDel(null); }}
                          className="text-[10px] px-2 py-0.5 rounded-lg border border-rose-300 text-rose-600 bg-rose-50 hover:bg-rose-100 transition">
                          Confirm
                        </button>
                        <button onClick={() => setConfirmDel(null)}
                          className="text-[10px] px-2 py-0.5 rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50 transition">
                          ×
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDel(item.id)}
                        className="text-[10px] px-2 py-0.5 rounded-lg border border-slate-200 text-slate-400 bg-white hover:border-rose-300 hover:text-rose-500 transition">
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

/* ── Section accordion ───────────────────────────────────────────────────── */

function SectionCard({ sectionKey, section, navigate, isLiability }) {
  const [open, setOpen] = useState(false);
  const meta  = SECTION_META[sectionKey] || { label: sectionKey, icon: "📦" };
  const items = section.items || [];
  if (section.total <= 0 && items.length === 0) return null;

  const shown = open ? items : items.slice(0, 4);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50/70 transition">
        <div className="flex items-center gap-2.5">
          <span className="text-base">{meta.icon}</span>
          <span className="text-sm font-semibold text-slate-700">{meta.label}</span>
          {items.length > 0 && (
            <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full font-medium">
              {items.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <span className={`text-sm font-bold ${isLiability ? "text-rose-600" : "text-emerald-600"}`}>
            {formatCurrency(section.total)}
          </span>
          <span className={`text-slate-300 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
        </div>
      </button>

      {open && items.length > 0 && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {shown.map((item) => {
            const link = meta.link ? meta.link(item.id) : null;
            const val  = item.total_outstanding ?? item.pending ?? item.net_value ?? item.balance ?? item.current_value ?? item.estimated_value ?? 0;
            const subtitle = item.institution || item.reason || item.location || null;
            const hasZeroInvestment = sectionKey === "properties" && item.invested === 0 && item.total_deal_value > 0;
            return (
              <div key={item.id}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50/60 transition cursor-default">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {item.contact || item.title || item.description || item.name || "—"}
                    </span>
                    {item.loan_type && (
                      <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded capitalize">
                        {item.loan_type}
                      </span>
                    )}
                    {item.property_type && (
                      <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded capitalize">
                        {item.property_type}
                      </span>
                    )}
                    {item.type && sectionKey === "collateral_pledged" && (
                      <span className="text-[9px] bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded capitalize">
                        {item.type}
                      </span>
                    )}
                    {hasZeroInvestment && (
                      <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">
                        ₹0 invested
                      </span>
                    )}
                  </div>
                  {subtitle && <p className="text-[10px] text-slate-400 truncate mt-0.5">{subtitle}</p>}
                  {hasZeroInvestment && item.total_deal_value > 0 && (
                    <p className="text-[10px] text-slate-400 mt-0.5">Deal value: {formatCurrency(item.total_deal_value)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold ${isLiability ? "text-rose-600" : "text-emerald-600"}`}>
                    {formatCurrency(val)}
                  </span>
                  {link && (
                    <button onClick={() => navigate(link)}
                      className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium hover:underline">
                      View →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {items.length > 4 && (
            <button onClick={() => setOpen(true)}
              className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition text-center">
              {open ? "" : `+${items.length - 4} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export default function NetWorth() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const [modal, setModal] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["net-worth-assets"],
    queryFn: () => api.get("/api/analytics/assets").then((r) => r.data),
  });

  const { data: unencItems = [] } = useQuery({
    queryKey: ["unencumbered-assets"],
    queryFn: () => api.get("/api/unencumbered-assets").then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (p) => api.post("/api/unencumbered-assets", p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unencumbered-assets"] });
      qc.invalidateQueries({ queryKey: ["net-worth-assets"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...p }) => api.put(`/api/unencumbered-assets/${id}`, p),
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
  const hasCollateral = (collateral_info?.total || 0) > 0;

  const assetDonutData = Object.entries(assets)
    .filter(([, v]) => v.total > 0)
    .map(([k, v]) => ({ name: SECTION_META[k]?.label || k, value: v.total }));

  const liabDonutData = Object.entries(liabilities)
    .filter(([, v]) => v.total > 0)
    .map(([k, v]) => ({ name: SECTION_META[k]?.label || k, value: v.total }));

  const propItems  = assets?.properties?.items   || [];
  const partItems  = assets?.partnerships?.items || [];

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

      <div className="min-h-screen bg-[#f5f5f7]">
        <div className="max-w-7xl mx-auto px-4 py-7 space-y-4">

          {/* ── Header ── */}
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Net Worth &amp; Assets</h1>
              <p className="text-xs text-slate-400 mt-0.5">Balance sheet · As of {data.as_of_date}</p>
            </div>
            <button onClick={() => setModal({ mode: "add" })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition shadow-sm">
              + Add Asset
            </button>
          </div>

          {/* ── HERO ── */}
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950 rounded-3xl p-6 shadow-xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30 mb-5">Balance Sheet</p>
            <div className="grid grid-cols-3 gap-4 items-start">
              <div>
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-medium">Total Assets</p>
                <p className="text-2xl font-bold text-white mt-1">{formatCurrency(total_assets)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-medium">Net Worth</p>
                <p className={`text-4xl font-extrabold mt-1 ${net_worth >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {formatCurrency(net_worth)}
                </p>
                <p className="text-[10px] text-white/25 mt-1">assets − liabilities</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-medium">Total Liabilities</p>
                <p className="text-2xl font-bold text-rose-400 mt-1">{formatCurrency(total_liabilities)}</p>
              </div>
            </div>

            {/* proportion bar */}
            {(total_assets + total_liabilities) > 0 && (
              <div className="mt-5">
                <div className="h-2 bg-white/10 rounded-full overflow-hidden flex">
                  <div className="bg-emerald-400/80 h-full rounded-l-full transition-all"
                    style={{ width: `${(total_assets / (total_assets + total_liabilities)) * 100}%` }} />
                  <div className="bg-rose-400/80 h-full rounded-r-full transition-all"
                    style={{ width: `${(total_liabilities / (total_assets + total_liabilities)) * 100}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-white/25 mt-1.5">
                  <span>Assets {pct(total_assets, total_assets + total_liabilities)}%</span>
                  <span>Liabilities {pct(total_liabilities, total_assets + total_liabilities)}%</span>
                </div>
              </div>
            )}
          </div>

          {/* ── BENTO ROW 1: donuts ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DonutCard
              title="Assets Breakdown"
              data={assetDonutData}
              total={total_assets}
              palette={ASSET_PALETTE}
              label="Assets"
            />
            <DonutCard
              title="Liabilities Breakdown"
              data={liabDonutData}
              total={total_liabilities}
              palette={LIAB_PALETTE}
              label="Liabilities"
            />
          </div>

          {/* ── BENTO ROW 2: bar + standalone ── */}
          {(propItems.length > 0 || partItems.length > 0 || unencItems.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BarCard propItems={propItems} partItems={partItems} />
              <StandaloneCard
                items={unencItems}
                onAdd={() => setModal({ mode: "add" })}
                onEdit={(item) => setModal({ mode: "edit", item })}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            </div>
          )}

          {/* If no deals but assets exist, show standalone card full-width */}
          {propItems.length === 0 && partItems.length === 0 && (
            <StandaloneCard
              items={unencItems}
              onAdd={() => setModal({ mode: "add" })}
              onEdit={(item) => setModal({ mode: "edit", item })}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          )}

          {/* ── Assets sections ── */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3 px-0.5">Assets</p>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {Object.entries(assets)
                .filter(([k]) => k !== "unencumbered_assets")
                .map(([key, section]) => (
                  <SectionCard key={key} sectionKey={key} section={section} navigate={navigate} />
                ))}
            </div>
          </div>

          {/* ── Liabilities sections ── */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3 px-0.5">Liabilities</p>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {Object.entries(liabilities).map(([key, section]) => (
                <SectionCard key={key} sectionKey={key} section={section} navigate={navigate} isLiability />
              ))}
            </div>
          </div>

          {/* ── Collateral info banner ── */}
          {hasCollateral && (
            <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3">
              <span className="text-xl shrink-0">🔒</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  Collateral Held — {formatCurrency(collateral_info.total)}
                </p>
                <p className="text-xs text-amber-700/80 mt-0.5">
                  Belongs to your borrowers and held as security only.{" "}
                  <strong>Not counted</strong> in total assets.
                </p>
                <div className="mt-2 space-y-1">
                  {(collateral_info.items || []).map((c) => (
                    <div key={c.id} className="text-xs text-amber-800 flex justify-between gap-4">
                      <span className="truncate">{c.description || c.type} — {c.contact}</span>
                      <span className="font-semibold shrink-0">{formatCurrency(c.estimated_value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
