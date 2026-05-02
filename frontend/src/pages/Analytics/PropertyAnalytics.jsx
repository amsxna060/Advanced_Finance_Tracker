import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const TXN_LABELS = {
  advance_to_seller: "Advance → Seller",
  payment_to_seller: "Payment → Seller",
  remaining_to_seller: "Remaining → Seller",
  received_from_buyer: "Received ← Buyer",
  buyer_advance: "Buyer Advance",
  buyer_payment: "Buyer Payment",
  buyer_payment_received: "Buyer Payment",
  commission_paid: "Broker Commission",
  broker_commission: "Broker Commission",
  expense: "Expense",
  other_expense: "Other Expense",
  refund: "Refund",
  sale_proceeds: "Sale Proceeds",
  partner_transfer: "Partner Transfer",
  invested: "Invested",
  advance_given: "Advance Given",
  broker_paid: "Broker Paid",
};

const STATUS_BADGE = {
  payment_done:     { label: "Payment Done",    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  fully_paid:       { label: "Fully Paid",       cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  registered:       { label: "Registered",       cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  registry_done:    { label: "Registry Done",    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  sold:             { label: "Sold",             cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  advance_received: { label: "Advance Received", cls: "bg-amber-50  text-amber-700  ring-amber-600/20"   },
  negotiating:      { label: "Negotiating",      cls: "bg-slate-50  text-slate-600  ring-slate-500/20"   },
  available:        { label: "Available",        cls: "bg-blue-50   text-blue-700   ring-blue-600/20"    },
};

const ANOMALY_SEVERITY = {
  critical: { icon: "🔴" },
  warning:  { icon: "🟡" },
  info:     { icon: "🔵" },
};

function txnLabel(t) { return TXN_LABELS[t] || (t || "Other").replace(/_/g, " "); }
function formatArea(sqft) {
  if (sqft == null) return "—";
  return `${new Intl.NumberFormat("en-IN").format(Math.round(sqft))} sqft`;
}
function normalizeName(n) { return (n || "").trim().toLowerCase().replace(/\s+/g, " "); }

// ─────────────────────────────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}
export function exportAnalyticsCSV(blocks, combinedMembers, combinedSellers, filename = "property_analytics.csv") {
  const sections = [];
  sections.push("=== MONEY FLOW PER PROPERTY ===");
  sections.push(["Property", "Seller", "Total Seller Value", "Paid to Seller", "Advance Paid",
    "Remaining to Seller", "Collected from Buyers", "Buyers Still to Pay", "Partner Capital"].join(","));
  for (const b of blocks) {
    const bk = b.buckets || {};
    sections.push([b.title || b.label, b.seller_name || "", bk.total_seller_value || 0,
      bk.paid_to_seller || 0, bk.paid_to_seller_advance || 0, bk.to_pay_to_seller || 0,
      bk.already_received || 0, bk.to_receive_from_buyers || 0, bk.partner_advances || 0,
    ].map(escapeCsv).join(","));
  }
  sections.push("\n=== PARTNER TOTALS ===");
  sections.push(["Partner", "Self?", "Advance Given", "Collected from Buyers", "Sent to Seller",
    "Expenses Paid", "Transferred Out", "Transferred In", "Current Holding"].join(","));
  for (const m of (combinedMembers || [])) {
    sections.push([m.name, m.is_self ? "Yes" : "No", m.own_invested || 0,
      m.collected_from_buyers || 0, m.paid_to_seller || 0, m.expenses_paid || 0,
      m.transferred_out || 0, m.transferred_in || 0, m.current_holding || 0,
    ].map(escapeCsv).join(","));
  }
  sections.push("\n=== SELLER TOTALS ===");
  sections.push(["Seller", "Properties", "Total Deal Value", "Advance Received",
    "Further Payments", "Pending Balance"].join(","));
  for (const s of (combinedSellers || [])) {
    sections.push([s.name, (s.property_titles || []).join("; "), s.total_value || 0,
      s.advance_received || 0, s.remaining_received || 0, s.pending_balance || 0,
    ].map(escapeCsv).join(","));
  }
  const blob = new Blob([sections.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE AGGREGATIONS
// ─────────────────────────────────────────────────────────────────────────────
function aggregateSellerData(blocks) {
  const map = {};
  for (const block of blocks) {
    const rawName = block.seller_name || "Unknown Seller";
    const key = normalizeName(rawName);
    if (!map[key]) map[key] = { name: rawName, advance_received: 0, remaining_received: 0, pending_balance: 0, total_value: 0, seller_events: [], property_titles: [] };
    const s = map[key];
    const b = block.buckets || {};
    s.advance_received   += b.paid_to_seller_advance    || 0;
    s.remaining_received += b.paid_to_seller_additional || 0;
    s.pending_balance    += b.to_pay_to_seller          || 0;
    s.total_value        += b.total_seller_value        || 0;
    s.property_titles.push(block.title || block.label || "");
    for (const member of block.members || []) {
      const evts = member.events?.items ?? member.events ?? [];
      for (const event of evts) {
        if (event.kind === "paid_to_seller") s.seller_events.push({ ...event, property: block.title });
      }
    }
  }
  for (const s of Object.values(map)) s.seller_events.sort((a, b) => (b.date || "") > (a.date || "") ? 1 : -1);
  return Object.values(map);
}

function aggregatePartnerData(blocks) {
  const map = {};
  for (const block of blocks) {
    for (const member of block.members || []) {
      const key = normalizeName(member.name);
      if (!map[key]) map[key] = {
        name: member.name, is_self: member.is_self,
        own_invested: 0, collected_from_buyers: 0, paid_to_seller: 0,
        expenses_paid: 0, transferred_out: 0, transferred_in: 0, current_holding: 0,
        events: { items: [], total: 0, has_more: false }, property_titles: [],
      };
      const p = map[key];
      p.is_self               = p.is_self || member.is_self;
      p.own_invested          += member.own_invested          || 0;
      p.collected_from_buyers += member.collected_from_buyers || 0;
      p.paid_to_seller        += member.paid_to_seller        || 0;
      p.expenses_paid         += member.expenses_paid         || 0;
      p.transferred_out       += member.transferred_out       || 0;
      p.transferred_in        += member.transferred_in        || 0;
      p.current_holding       += member.current_holding       || 0;
      const evts = member.events?.items ?? member.events ?? [];
      p.events.items.push(...evts);
      p.events.total   += member.events?.total ?? evts.length;
      p.events.has_more = p.events.has_more || (member.events?.has_more ?? false);
      if (block.title) p.property_titles.push(block.title);
    }
  }
  return Object.values(map).sort((a, b) => {
    if (a.is_self !== b.is_self) return a.is_self ? -1 : 1;
    return (b.collected_from_buyers || 0) - (a.collected_from_buyers || 0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI ATOMS
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (!status) return null;
  const meta = STATUS_BADGE[status] || { label: status.replace(/_/g, " "), cls: "bg-slate-50 text-slate-600 ring-slate-500/20" };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset capitalize ${meta.cls}`}>{meta.label}</span>;
}
function Pill({ children }) {
  return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold bg-slate-100 text-slate-600">{children}</span>;
}
function EventDot({ direction }) {
  return <span className={`shrink-0 w-2.5 h-2.5 rounded-full mt-0.5 ${direction === "in" ? "bg-emerald-500" : "bg-rose-400"}`} />;
}
function ProgressBar({ value, total, color = "emerald" }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const colorMap = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-400" };
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full transition-all ${colorMap[color] || colorMap.emerald}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
function SectionLabel({ children, extra }) {
  return (
    <div className="flex items-center gap-1 mb-3">
      <h4 className="text-sm font-semibold text-slate-700">{children}</h4>
      {extra}
    </div>
  );
}
function ChevronIcon({ open }) {
  return (
    <svg className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ANOMALY BANNER
// ─────────────────────────────────────────────────────────────────────────────
function AnomalyBanner({ anomalies }) {
  const [open, setOpen] = useState(false);
  if (!anomalies?.length) return null;
  const critical = anomalies.filter((a) => a.severity === "critical");
  const warnings = anomalies.filter((a) => a.severity === "warning");
  return (
    <div className={`rounded-xl border ${critical.length ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"} overflow-hidden`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg leading-none">{critical.length ? "🔴" : "🟡"}</span>
          <div className="text-left">
            <span className={`text-sm font-semibold ${critical.length ? "text-red-800" : "text-amber-800"}`}>
              {anomalies.length} financial anomal{anomalies.length === 1 ? "y" : "ies"} detected
            </span>
            <span className="text-xs text-slate-500 ml-2">
              {critical.length > 0 && `${critical.length} critical`}
              {critical.length > 0 && warnings.length > 0 && " · "}
              {warnings.length > 0 && `${warnings.length} warning`}
            </span>
          </div>
        </div>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="border-t border-current border-opacity-20 divide-y divide-slate-200/60">
          {anomalies.map((a) => {
            const cfg = ANOMALY_SEVERITY[a.severity] || ANOMALY_SEVERITY.warning;
            return (
              <div key={a.id} className="px-5 py-3 flex items-start gap-3">
                <span className="text-sm leading-none mt-0.5">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-800">{a.scope_title}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${a.severity === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{a.anomaly_type.replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{a.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECHARTS: LAND DONUT
// ─────────────────────────────────────────────────────────────────────────────
const DONUT_COLORS = { sold: "#10b981", remaining: "#f59e0b", none: "#e2e8f0" };
function LandDonutChart({ buckets }) {
  const sold      = buckets?.sold_area      || 0;
  const remaining = buckets?.remaining_area || 0;
  const total     = buckets?.total_land_area || 0;
  if (!total) return null;
  const data = (sold || remaining)
    ? [{ name: "Sold", value: sold, fill: DONUT_COLORS.sold }, { name: "Remaining", value: remaining, fill: DONUT_COLORS.remaining }]
    : [{ name: "No data", value: 1, fill: DONUT_COLORS.none }];
  const pct = total > 0 ? Math.round((sold / total) * 100) : 0;
  const customLabel = ({ cx, cy }) => (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
      <tspan x={cx} dy="-0.4em" fontSize="18" fontWeight="700" fill="#1e293b">{pct}%</tspan>
      <tspan x={cx} dy="1.3em" fontSize="10" fill="#94a3b8">sold</tspan>
    </text>
  );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-700 mb-3">Land Area</div>
      <div className="flex items-center gap-6">
        <PieChart width={130} height={130}>
          <Pie data={data} cx={60} cy={60} innerRadius={42} outerRadius={60} dataKey="value" labelLine={false} label={customLabel} stroke="none">
            {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          </Pie>
        </PieChart>
        <div className="space-y-2.5 flex-1 min-w-0">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS.sold }} /><span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600">Sold</span></div>
            <div className="text-base font-bold text-emerald-800 tabular-nums">{formatArea(sold)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS.remaining }} /><span className="text-[10px] uppercase tracking-wider font-semibold text-amber-600">Remaining</span></div>
            <div className="text-base font-bold text-amber-800 tabular-nums">{formatArea(remaining)}</div>
          </div>
          <div className="text-[10px] text-slate-400">Total: {formatArea(total)}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECHARTS: MONEY FLOW STACKED BAR
// ─────────────────────────────────────────────────────────────────────────────
const INR_COMPACT = (v) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(0)}K`;
  return `₹${v}`;
};
function MoneyFlowBarChart({ blocks }) {
  if (!blocks?.length) return null;
  const data = blocks.map((b) => {
    const bk = b.buckets || {};
    return {
      name: (b.title || b.label || "").slice(0, 20),
      "Collected": bk.already_received || 0,
      "Paid to Seller": bk.paid_to_seller || 0,
      "Remaining to Seller": bk.to_pay_to_seller || 0,
      "Still from Buyers": bk.to_receive_from_buyers || 0,
    };
  });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-700 mb-4">Money Flow Comparison</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} angle={-25} textAnchor="end" interval={0} />
          <YAxis tickFormatter={INR_COMPACT} tick={{ fontSize: 10, fill: "#94a3b8" }} width={52} />
          <RTooltip formatter={(v) => formatCurrency(v)} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
          <Bar dataKey="Collected"           stackId="a" fill="#10b981" radius={[0,0,0,0]} />
          <Bar dataKey="Still from Buyers"   stackId="a" fill="#fbbf24" radius={[0,0,0,0]} />
          <Bar dataKey="Paid to Seller"      stackId="b" fill="#f43f5e" radius={[0,0,0,0]} />
          <Bar dataKey="Remaining to Seller" stackId="b" fill="#fb923c" radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY SELECTOR
// ─────────────────────────────────────────────────────────────────────────────
function PropertySelector({ options, pending, setPending, onApply, isLoading }) {
  const properties = options?.properties || [];
  const toggle = (id) => setPending((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Select Properties</h2>
          <p className="text-xs text-slate-500 mt-0.5">Choose one or more properties, then click Apply.</p>
        </div>
        <div className="flex items-center gap-2">
          {properties.length > 0 && (
            <>
              <button onClick={() => setPending(properties.map((p) => p.id))} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">All</button>
              <button onClick={() => setPending([])} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">Clear</button>
            </>
          )}
          <button onClick={onApply} disabled={pending.length === 0 || isLoading} className="px-5 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm">
            {isLoading ? "Loading…" : "Apply"}
          </button>
        </div>
      </div>
      <div className="px-6 py-4">
        {properties.length === 0
          ? <p className="text-xs text-slate-400 italic">No properties found.</p>
          : (
            <div className="flex flex-wrap gap-2">
              {properties.map((p) => {
                const active = pending.includes(p.id);
                return (
                  <button key={p.id} onClick={() => toggle(p.id)} className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${active ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "bg-white text-slate-700 border-slate-300 hover:border-indigo-400 hover:text-indigo-700"}`}>
                    {active && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>}
                    {p.title}
                    {p.status && <span className={`text-[9px] font-semibold uppercase tracking-wider ${active ? "text-indigo-200" : "text-slate-400"}`}>{p.status}</span>}
                  </button>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY FLOW METRIC CARDS
// ─────────────────────────────────────────────────────────────────────────────
function MoneyFlowBar({ buckets }) {
  const paidToSeller = buckets.paid_to_seller ?? buckets.already_paid_out ?? 0;
  const metrics = [
    { label: "Collected from Buyers",  value: formatCurrency(buckets.already_received),       sub: null, accent: "emerald" },
    { label: "Buyers Still to Pay",    value: formatCurrency(buckets.to_receive_from_buyers),  sub: null, accent: "amber"   },
    { label: "Total Paid to Seller",   value: formatCurrency(paidToSeller),                    sub: buckets.paid_to_seller_advance > 0 ? `Adv: ${formatCurrency(buckets.paid_to_seller_advance)}` : null, accent: "rose" },
    { label: "Remaining to Seller",    value: formatCurrency(buckets.to_pay_to_seller),        sub: null, accent: "red"     },
    { label: "Partner Capital",        value: formatCurrency(buckets.partner_advances),        sub: null, accent: "purple"  },
  ];
  const accentMap = { emerald: "border-emerald-200 bg-emerald-50 text-emerald-800", amber: "border-amber-200 bg-amber-50 text-amber-800", rose: "border-rose-200 bg-rose-50 text-rose-800", red: "border-red-200 bg-red-50 text-red-800", purple: "border-purple-200 bg-purple-50 text-purple-800" };
  const labelMap  = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", red: "text-red-600", purple: "text-purple-600" };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className={`rounded-xl border p-4 shadow-sm ${accentMap[m.accent]}`}>
          <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${labelMap[m.accent]}`}>{m.label}</div>
          <div className="text-base font-bold tabular-nums">{m.value}</div>
          {m.sub && <div className={`text-[10px] mt-1 ${labelMap[m.accent]}`}>{m.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER CARD
// ─────────────────────────────────────────────────────────────────────────────
function SellerCard({ seller, isMultiProperty }) {
  const [open, setOpen] = useState(false);
  const totalPaid = (seller.advance_received || 0) + (seller.remaining_received || 0);
  const pct = seller.total_value > 0 ? Math.min(100, (totalPaid / seller.total_value) * 100) : 0;
  const events = seller.seller_events || [];
  return (
    <div className="rounded-2xl border border-rose-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-rose-100 bg-rose-50/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 truncate">{seller.name}</div>
              <div className="text-[10px] text-rose-600 font-semibold uppercase tracking-wider mt-0.5">Seller</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Total Deal</div>
            <div className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(seller.total_value)}</div>
            <div className="text-[10px] text-slate-400">{pct.toFixed(0)}% paid</div>
          </div>
        </div>
        {isMultiProperty && (seller.property_titles || []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {seller.property_titles.map((t, i) => <span key={i} className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{t}</span>)}
          </div>
        )}
      </div>
      <div className="px-5 pt-3">
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
          <span>Payment progress</span><span>{formatCurrency(totalPaid)} of {formatCurrency(seller.total_value)}</span>
        </div>
        <ProgressBar value={totalPaid} total={seller.total_value} color={pct >= 100 ? "emerald" : pct >= 50 ? "amber" : "rose"} />
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 mt-4">
        <div className="px-4 py-4"><div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 mb-1">Advance Received</div><div className="text-sm font-bold text-rose-800 tabular-nums">{formatCurrency(seller.advance_received)}</div><div className="text-[10px] text-slate-400 mt-0.5">Initial token paid</div></div>
        <div className="px-4 py-4"><div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 mb-1">Further Payments</div><div className="text-sm font-bold text-rose-800 tabular-nums">{formatCurrency(seller.remaining_received)}</div>{events.length > 0 && <div className="text-[10px] text-slate-400 mt-0.5">{events.length} payment{events.length !== 1 ? "s" : ""}</div>}</div>
        <div className="px-4 py-4"><div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1">Pending Balance</div><div className={`text-sm font-bold tabular-nums ${seller.pending_balance > 0 ? "text-amber-800" : "text-emerald-700"}`}>{formatCurrency(seller.pending_balance)}</div><div className="text-[10px] text-slate-400 mt-0.5">{seller.pending_balance > 0 ? "Still owed" : "Fully settled"}</div></div>
      </div>
      {events.length > 0 && (
        <>
          <div className="border-t border-slate-100">
            <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50/60 flex items-center justify-between transition-colors">
              <span>Payment history ({events.length})</span><ChevronIcon open={open} />
            </button>
          </div>
          {open && (
            <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100">
              {events.map((e, i) => (
                <div key={i} className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
                  <EventDot direction="out" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-rose-700 tabular-nums">{formatCurrency(e.amount)}</span>
                      {e.payment_mode && <Pill>{e.payment_mode}</Pill>}
                      {isMultiProperty && e.property && <span className="text-[10px] text-indigo-600 font-medium bg-indigo-50 px-1.5 py-0.5 rounded">{e.property}</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{formatDate(e.date)}</div>
                    {e.description && <div className="text-[10px] text-slate-400 italic mt-0.5 truncate">{e.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTNER CARD — paginated events + Expenses Paid metric
// ─────────────────────────────────────────────────────────────────────────────
function PartnerTimeline({ events }) {
  if (!events?.length) return <div className="text-xs text-slate-400 italic py-3 text-center">No events recorded.</div>;
  return (
    <div>
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
          <EventDot direction={e.direction} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold tabular-nums ${e.direction === "in" ? "text-emerald-700" : "text-rose-700"}`}>{e.direction === "in" ? "+" : "−"}{formatCurrency(e.amount)}</span>
              <span className="text-[11px] text-slate-600">{txnLabel(e.type)}</span>
              {e.payment_mode && <Pill>{e.payment_mode}</Pill>}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{formatDate(e.date)}</span>
              {e.counterparty && <span className="text-slate-500">{e.direction === "in" ? "from" : "to"} <strong>{e.counterparty}</strong></span>}
            </div>
            {e.description && <div className="text-[10px] text-slate-400 italic mt-0.5 truncate">{e.description}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PartnerCard({ member, isMultiProperty, onLoadMore }) {
  const [open, setOpen] = useState(false);

  // Support both paginated {items, total, has_more} and plain array
  const eventsPayload = member.events ?? { items: [], total: 0, has_more: false };
  const eventItems    = Array.isArray(eventsPayload) ? eventsPayload : (eventsPayload.items ?? []);
  const eventsTotal   = eventsPayload.total ?? eventItems.length;
  const hasMore       = eventsPayload.has_more ?? false;
  const hasEvents     = eventsTotal > 0 || eventItems.length > 0;

  const expensesPaid  = member.expenses_paid || 0;
  const hasExpenses   = expensesPaid > 0.01;

  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${member.is_self ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200"}`}>
      {/* Header */}
      <div className={`px-5 py-4 border-b ${member.is_self ? "bg-indigo-50/60 border-indigo-100" : "bg-slate-50/60 border-slate-100"}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${member.is_self ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"}`}>{(member.name || "?")[0].toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 truncate">{member.name}</span>
              {member.is_self && <span className="text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded uppercase tracking-wider">You</span>}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider font-medium">Partner</div>
          </div>
        </div>
        {isMultiProperty && member.property_titles?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {[...new Set(member.property_titles)].map((t, i) => <span key={i} className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{t}</span>)}
          </div>
        )}
      </div>

      {/* Metrics grid — 2×2 + expenses row */}
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-100">
        <div className="px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-600 mb-1">Advance Given</div>
          <div className="text-sm font-bold text-purple-900 tabular-nums">{formatCurrency(member.own_invested)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Capital from their pocket</div>
        </div>
        <div className="px-4 py-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1">Current Holding</div>
          <div className={`text-sm font-bold tabular-nums ${member.current_holding > 0.5 ? "text-amber-700" : member.current_holding < -0.5 ? "text-blue-700" : "text-slate-400"}`}>{formatCurrency(member.current_holding)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{member.current_holding > 0.5 ? "Pot money with them" : member.current_holding < -0.5 ? "Pot owes them" : "Settled"}</div>
        </div>
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-1.5 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /><div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Collected from Buyers</div></div>
          <div className="text-sm font-bold text-emerald-800 tabular-nums">{formatCurrency(member.collected_from_buyers)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Inflow they received</div>
        </div>
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-1.5 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" /><div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">Sent to Seller</div></div>
          <div className="text-sm font-bold text-rose-800 tabular-nums">{formatCurrency(member.paid_to_seller)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Outflow to seller</div>
        </div>
      </div>

      {/* Expenses Paid row — only shown when non-zero */}
      {hasExpenses && (
        <div className="px-4 py-3.5 border-b border-slate-100 bg-orange-50/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
              <div className="text-[10px] font-semibold uppercase tracking-wider text-orange-600">Expenses Paid</div>
              <span className="text-[9px] font-medium text-orange-400 bg-orange-100 px-1.5 py-0.5 rounded uppercase tracking-wider">Outflow</span>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-orange-800 tabular-nums">−{formatCurrency(expensesPaid)}</div>
              <div className="text-[10px] text-slate-400">Deducted from holding</div>
            </div>
          </div>
          <div className="text-[10px] text-orange-600/70 mt-1.5 italic">
            Holding = (Collected + Transferred In) − (Sent to Seller + Transferred Out + Expenses Paid)
          </div>
        </div>
      )}

      {/* Transfers row */}
      <div className="px-4 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-1.5 mb-2"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" /><div className="text-[10px] font-semibold uppercase tracking-wider text-violet-600">Transferred to Partners</div></div>
        <div className="grid grid-cols-2 gap-4">
          <div><div className="text-[10px] text-slate-400 mb-0.5">Sent out</div><div className="text-sm font-bold text-violet-800 tabular-nums">{formatCurrency(member.transferred_out)}</div></div>
          <div><div className="text-[10px] text-slate-400 mb-0.5">Received in</div><div className="text-sm font-bold text-violet-800 tabular-nums">{formatCurrency(member.transferred_in)}</div></div>
        </div>
      </div>

      {/* Transaction history toggle */}
      <button
        onClick={() => hasEvents && setOpen((v) => !v)}
        disabled={!hasEvents}
        className={`w-full px-5 py-2.5 text-xs font-medium flex items-center justify-between transition-colors ${hasEvents ? "text-indigo-600 hover:bg-indigo-50/50 cursor-pointer" : "text-slate-300 cursor-default"}`}
      >
        <span>
          {hasEvents
            ? `Transaction history (${eventItems.length}${hasMore ? ` of ${eventsTotal}+` : ""})`
            : "No transactions recorded"}
        </span>
        {hasEvents && <ChevronIcon open={open} />}
      </button>

      {open && (
        <div className="bg-slate-50/60 border-t border-slate-100">
          <div className="px-5 py-3">
            <PartnerTimeline events={eventItems} />
          </div>
          {hasMore && (
            <div className="px-5 pb-4 pt-1 text-center border-t border-slate-100">
              <button
                onClick={() => onLoadMore?.()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0-3.75-3.75M17.25 21 21 17.25" /></svg>
                Load more ({eventsTotal - eventItems.length} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BUYERS TABLE
// ─────────────────────────────────────────────────────────────────────────────
function BuyerTransactionsTable({ txns }) {
  if (!txns?.length) return <div className="text-xs text-slate-400 italic px-4 py-3">No transactions recorded.</div>;
  return (
    <div className="overflow-hidden">
      <table className="w-full text-xs">
        <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400"><th className="text-left font-semibold px-4 py-2 w-28">Date</th><th className="text-right font-semibold px-3 py-2 w-32">Amount</th><th className="text-left font-semibold px-3 py-2">Type</th><th className="text-left font-semibold px-3 py-2 w-36">Received By</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {txns.map((t, i) => (
            <tr key={i} className="hover:bg-white/60">
              <td className="px-4 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">{formatDate(t.date)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">+{formatCurrency(t.amount)}</td>
              <td className="px-3 py-2.5 text-slate-700"><div className="font-medium text-slate-800">{txnLabel(t.type)}</div>{(t.description || t.payment_mode) && <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">{t.description && <span className="italic">{t.description}</span>}{t.payment_mode && <Pill>{t.payment_mode}</Pill>}</div>}</td>
              <td className="px-3 py-2.5 text-slate-700">{t.received_by ? <span className="font-medium">{t.received_by}</span> : <span className="text-slate-300">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuyerRow({ buyer }) {
  const [open, setOpen] = useState(false);
  const txns = buyer.transactions || [];
  const hasTxns = txns.length > 0;
  const paidPct = buyer.total_value > 0 ? (buyer.paid / buyer.total_value) : 0;
  const barColor = paidPct >= 1 ? "emerald" : paidPct >= 0.5 ? "amber" : "rose";
  return (
    <>
      <tr className={`group transition-colors ${hasTxns ? "cursor-pointer hover:bg-slate-50/70" : ""} ${open ? "bg-slate-50/70" : ""}`} onClick={() => hasTxns && setOpen((v) => !v)}>
        <td className="px-4 py-3 align-middle w-8"><svg className={`w-3.5 h-3.5 transition-all ${open ? "rotate-90 text-slate-500" : "text-slate-300 group-hover:text-slate-500"} ${!hasTxns ? "opacity-20" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg></td>
        <td className="px-3 py-3 align-middle"><div className="font-semibold text-slate-900 text-sm">{buyer.name}</div><div className="text-[11px] text-slate-400 mt-0.5">{formatArea(buyer.area_sqft)}{buyer.rate_per_sqft > 0 && <span className="text-slate-300"> · ₹{buyer.rate_per_sqft.toLocaleString("en-IN")}/sqft</span>}</div></td>
        <td className="px-3 py-3 text-right align-middle tabular-nums whitespace-nowrap"><div className="text-sm font-semibold text-slate-800">{formatCurrency(buyer.total_value)}</div></td>
        <td className="px-3 py-3 align-middle min-w-[90px]"><div className="text-sm font-semibold text-emerald-700 text-right tabular-nums">{formatCurrency(buyer.paid)}</div><div className="mt-1"><ProgressBar value={buyer.paid} total={buyer.total_value} color={barColor} /></div></td>
        <td className="px-3 py-3 text-right align-middle tabular-nums whitespace-nowrap"><div className={`text-sm font-semibold ${buyer.outstanding > 0 ? "text-amber-700" : "text-slate-300"}`}>{formatCurrency(buyer.outstanding)}</div></td>
        <td className="px-3 py-3 align-middle whitespace-nowrap"><StatusBadge status={buyer.status} /></td>
        <td className="px-4 py-3 align-middle text-right whitespace-nowrap"><span className="text-[11px] text-slate-400">{hasTxns ? `${txns.length} txn${txns.length !== 1 ? "s" : ""}` : "—"}</span></td>
      </tr>
      {open && hasTxns && <tr className="bg-slate-50/40"><td colSpan={7} className="p-0"><div className="border-t border-slate-100"><BuyerTransactionsTable txns={txns} /></div></td></tr>}
    </>
  );
}

function BuyersSection({ buyers }) {
  if (!buyers?.length) return <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 italic">No buyers registered yet.</div>;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400"><th className="px-4 py-2.5 w-8" /><th className="px-3 py-2.5 text-left font-semibold">Buyer</th><th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Total Value</th><th className="px-3 py-2.5 text-right font-semibold">Paid</th><th className="px-3 py-2.5 text-right font-semibold">Outstanding</th><th className="px-3 py-2.5 text-left font-semibold">Status</th><th className="px-4 py-2.5 text-right font-semibold w-20">Activity</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{buyers.map((b) => <BuyerRow key={`${b.kind}-${b.id}`} buyer={b} />)}</tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY BLOCK — accordion, collapsed by default
// BUG FIX: removed overflow-hidden from <section> so content renders correctly
// ─────────────────────────────────────────────────────────────────────────────
function PropertyBlock({ block, onLoadMore }) {
  const [expanded, setExpanded] = useState(false);
  const sellers  = useMemo(() => aggregateSellerData([block]),  [block]);
  const partners = useMemo(() => aggregatePartnerData([block]), [block]);
  const bk = block.buckets || {};
  const paidPct = bk.total_seller_value > 0
    ? Math.min(100, ((bk.paid_to_seller || 0) / bk.total_seller_value) * 100)
    : 0;

  return (
    // NOTE: No overflow-hidden here — it was clipping expanded accordion content
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center gap-4 text-left hover:bg-slate-50/80 transition-colors rounded-t-2xl"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Property</span>
            {block.status && <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full capitalize">{block.status}</span>}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-base font-bold text-slate-900">{block.title || block.label}</h3>
            {block.seller_name && <span className="text-xs text-slate-400">Seller: <span className="text-slate-600 font-medium">{block.seller_name}</span></span>}
          </div>
          {!expanded && (
            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              {bk.already_received > 0 && <span className="text-[11px] text-emerald-600 font-medium">↑ {formatCurrency(bk.already_received)} collected</span>}
              {bk.to_pay_to_seller > 0 && <span className="text-[11px] text-amber-600 font-medium">↓ {formatCurrency(bk.to_pay_to_seller)} owed to seller</span>}
              {bk.paid_to_seller > 0 && <span className="text-[11px] text-rose-600 font-medium">{paidPct.toFixed(0)}% seller paid</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/properties/${block.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
          >
            Open<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
          </Link>
          <div className={`text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
          </div>
        </div>
      </button>

      {/* Expanded content — no overflow-hidden parent so it renders in normal flow */}
      {expanded && (
        <div className="p-6 space-y-8">
          {bk.is_partial_projection && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="text-base leading-none mt-0.5">⚠️</span>
              <div><strong>Partial data.</strong> Only {formatCurrency(bk.registered_buyer_value)} of buyer value is registered against seller cost of {formatCurrency(bk.total_seller_value)}.</div>
            </div>
          )}
          <div><SectionLabel>Money Flow</SectionLabel><MoneyFlowBar buckets={bk} /></div>
          {bk.total_land_area > 0 && (
            <div><SectionLabel>Area</SectionLabel><LandDonutChart buckets={bk} /></div>
          )}
          {sellers.length > 0 && (
            <div>
              <SectionLabel>Seller</SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{sellers.map((s, i) => <SellerCard key={i} seller={s} isMultiProperty={false} />)}</div>
            </div>
          )}
          <div>
            <SectionLabel extra={<span className="text-slate-400 text-xs font-normal">({block.buyers?.length || 0})</span>}>Buyers</SectionLabel>
            <BuyersSection buyers={block.buyers} />
          </div>
          {partners.length > 0 && (
            <div>
              <SectionLabel extra={<span className="text-slate-400 text-xs font-normal">({partners.length})</span>}>Partners</SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {partners.map((m, i) => <PartnerCard key={`${m.name}-${i}`} member={m} isMultiProperty={false} onLoadMore={onLoadMore} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED STICKY HEADER — ONLY this strip is sticky
// Fixes the blank-scroll bug: the rest of the page is normal flow
// ─────────────────────────────────────────────────────────────────────────────
function CombinedStickyHeader({ combined, blocks, onExport }) {
  const bk = combined?.buckets || {};
  return (
    // BUG FIX: sticky is scoped to ONLY this header card, not the whole section
    <div className="sticky top-0 z-30 bg-gradient-to-br from-indigo-50/95 via-white/98 to-purple-50/90 backdrop-blur-sm rounded-2xl border border-indigo-200 shadow-md">
      <div className="px-6 py-4 border-b border-indigo-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 mb-0.5">
            Combined · {blocks.length} propert{blocks.length === 1 ? "y" : "ies"}
          </div>
          <h2 className="text-lg font-bold text-slate-900">Aggregated Overview</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onExport}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Download CSV
          </button>
        </div>
      </div>
      <div className="px-6 py-4">
        <MoneyFlowBar buckets={bk} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT PAGE COMPONENT
// Layout order (per UX spec):
//   1. Anomaly banner
//   2. Property selector
//   3. [Multi only] Sticky combined header (money metrics)
//   4. [Multi only] Visual Overview (charts)
//   5. Individual Property Breakdown (accordions) ← ABOVE sellers/partners
//   6. [Multi only] Combined Sellers
//   7. [Multi only] Combined Partners
// ─────────────────────────────────────────────────────────────────────────────
export default function PropertyAnalytics() {
  const [pendingIds,  setPendingIds]  = useState([]);
  const [appliedIds,  setAppliedIds]  = useState(null);
  // Pagination: increasing this triggers a re-fetch of the analytics query
  // with more events per partner. Shared across all PartnerCards.
  const [eventLimit,  setEventLimit]  = useState(10);

  const queryString = useMemo(() => {
    if (!appliedIds?.length) return "";
    const p = new URLSearchParams();
    appliedIds.forEach((id) => p.append("property_ids", id));
    p.set("event_limit", String(eventLimit));
    return p.toString();
  }, [appliedIds, eventLimit]);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["property-analytics", queryString],
    queryFn: async () => (await api.get(`/api/analytics/property?${queryString}`)).data,
    enabled: !!queryString,
    keepPreviousData: true,
    staleTime: 30_000,
  });

  const { data: optionsData } = useQuery({
    queryKey: ["property-analytics-options"],
    queryFn: async () => (await api.get("/api/analytics/property?scope=none")).data,
    staleTime: 60_000,
    retry: false,
  });

  const { data: anomaliesData } = useQuery({
    queryKey: ["property-anomalies"],
    queryFn: async () => {
      await api.post("/api/analytics/anomalies/scan");
      return (await api.get("/api/analytics/anomalies")).data;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const options  = data?.options  || optionsData?.options;
  const blocks   = data?.blocks   || [];
  const combined = data?.combined;
  const isMulti  = blocks.length > 1;

  // Combined sellers: prefer server-side aggregation, fall back to client-side
  const combinedSellers  = useMemo(
    () => isMulti ? (combined?.sellers?.length ? combined.sellers : aggregateSellerData(blocks)) : [],
    [isMulti, blocks, combined],
  );
  const combinedPartners = useMemo(
    () => isMulti ? aggregatePartnerData(blocks) : [],
    [isMulti, blocks],
  );

  const handleApply   = useCallback(() => { if (pendingIds.length > 0) setAppliedIds([...pendingIds]); }, [pendingIds]);
  const handleLoadMore = useCallback(() => setEventLimit((v) => v + 20), []);
  const handleExport  = useCallback(() => {
    exportAnalyticsCSV(
      blocks,
      combined?.members || [],
      combined?.sellers || [],
      `property_analytics_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }, [blocks, combined]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Property Analytics</h1>
            <p className="text-sm text-slate-500 mt-1">Select properties to analyse money flow, sellers, buyers, and partner positions.</p>
          </div>
          {appliedIds?.length > 0 && !isFetching && blocks.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {blocks.length} propert{blocks.length !== 1 ? "ies" : "y"} loaded
            </div>
          )}
        </div>

        {/* Anomaly banner */}
        {anomaliesData?.length > 0 && <AnomalyBanner anomalies={anomaliesData} />}

        {/* Property selector */}
        <PropertySelector options={options} pending={pendingIds} setPending={setPendingIds} onApply={handleApply} isLoading={isFetching} />

        {/* Loading */}
        {isFetching && (
          <div className="flex items-center justify-center gap-3 py-16 bg-white rounded-2xl border border-slate-200">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-indigo-600" />
            <span className="text-sm text-slate-500">Calculating money flow…</span>
          </div>
        )}

        {/* Error */}
        {isError && !isFetching && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-5 text-sm flex items-start gap-3">
            <svg className="w-5 h-5 shrink-0 mt-0.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
            <div><strong>Failed to load analytics</strong><div className="mt-0.5 text-rose-700">{error?.message || "Unknown error"}</div></div>
          </div>
        )}

        {/* Empty state */}
        {!appliedIds && !isFetching && (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border border-dashed border-slate-200">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5" /></svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">No properties selected</p>
            <p className="text-xs text-slate-400 mt-1">Select one or more properties above, then click <strong>Apply</strong>.</p>
          </div>
        )}

        {appliedIds && !isFetching && !isError && blocks.length === 0 && (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-10 text-center text-slate-400 text-sm">No data found for the selected properties.</div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            RESULTS SECTION
            Order: sticky header → charts → property accordions → sellers → partners
            ═══════════════════════════════════════════════════════════════════ */}
        {!isFetching && !isError && blocks.length > 0 && (
          <div className="space-y-6">

            {/* 1. Sticky combined summary header (multi only) */}
            {isMulti && (
              <CombinedStickyHeader combined={combined} blocks={blocks} onExport={handleExport} />
            )}

            {/* 2. Visual overview charts (multi only) — normal flow, NOT sticky */}
            {isMulti && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
                <SectionLabel>Visual Overview</SectionLabel>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {(combined?.buckets?.total_land_area > 0) && <LandDonutChart buckets={combined.buckets} />}
                  <MoneyFlowBarChart blocks={blocks} />
                </div>
              </div>
            )}

            {/* 3. Individual Property Breakdown — ABOVE sellers/partners (UX spec) */}
            <div className="space-y-4">
              {isMulti && (
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-600">Individual Property Breakdown</h3>
                  <span className="text-xs text-slate-400">{blocks.length} properties — click to expand</span>
                </div>
              )}
              {blocks.map((b) => (
                <PropertyBlock key={`${b.kind}-${b.id}`} block={b} onLoadMore={handleLoadMore} />
              ))}
            </div>

            {/* 4. Combined Sellers (multi only) */}
            {isMulti && combinedSellers.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <SectionLabel extra={<span className="ml-2 text-[10px] font-medium text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">{combinedSellers.length} unique</span>}>
                  Sellers
                </SectionLabel>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {combinedSellers.map((s, i) => <SellerCard key={i} seller={s} isMultiProperty />)}
                </div>
              </div>
            )}

            {/* 5. Combined Partners (multi only) */}
            {isMulti && combinedPartners.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                <SectionLabel extra={<span className="ml-2 text-[10px] font-medium text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">{combinedPartners.length} unique</span>}>
                  Partners
                </SectionLabel>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {combinedPartners.map((m, i) => (
                    <PartnerCard key={`${m.name}-${i}`} member={m} isMultiProperty onLoadMore={handleLoadMore} />
                  ))}
                </div>
              </div>
            )}

            {/* Export button for single property view */}
            {!isMulti && (
              <div className="flex justify-end">
                <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Download CSV
                </button>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
