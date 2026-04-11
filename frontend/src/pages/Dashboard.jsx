import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../hooks/useAuth";
import api from "../lib/api";
import { formatCurrency } from "../lib/utils";

/* ── helpers ──────────────────────────────────────────────────────────── */
const fc = (v) => formatCurrency(v ?? 0);
const fcShort = (v) => {
  const n = Math.abs(Number(v ?? 0));
  const sign = Number(v ?? 0) < 0 ? "-" : "";
  if (n >= 1e7) return `${sign}\u20b9${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${sign}\u20b9${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${sign}\u20b9${(n / 1e3).toFixed(1)}K`;
  return fc(v);
};

const STATUS_DOT = {
  active: "bg-emerald-400",
  closed: "bg-slate-400",
  defaulted: "bg-rose-400",
  on_hold: "bg-amber-400",
};

const TYPE_LABELS = {
  interest_only: "Interest Only",
  emi: "EMI",
  short_term: "Short Term",
};

const TYPE_COLORS = {
  interest_only: { ring: "ring-teal-500/30", bg: "bg-teal-50", text: "text-teal-700", bar: "#14b8a6" },
  emi: { ring: "ring-violet-500/30", bg: "bg-violet-50", text: "text-violet-700", bar: "#8b5cf6" },
  short_term: { ring: "ring-amber-500/30", bg: "bg-amber-50", text: "text-amber-700", bar: "#f59e0b" },
};

/* ── small reusable pieces ────────────────────────────────────────────── */

function GlassCard({ label, value, sub }) {
  return (
    <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-2xl px-5 py-4">
      <p className="text-indigo-300/80 text-[11px] font-semibold uppercase tracking-widest">{label}</p>
      <p className="text-white text-xl font-extrabold mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-indigo-300/60 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function Stat({ label, value, accent = "emerald" }) {
  const accents = {
    emerald: "border-emerald-500",
    rose: "border-rose-500",
    violet: "border-violet-500",
    amber: "border-amber-500",
    sky: "border-sky-500",
    indigo: "border-indigo-500",
    teal: "border-teal-500",
    slate: "border-slate-400",
  };
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition-shadow px-5 py-4 border-l-4 ${accents[accent]}`}>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-extrabold text-slate-800 mt-1 tracking-tight">{value}</p>
    </div>
  );
}

function SectionTitle({ children, count, color = "indigo" }) {
  const dots = { indigo: "bg-indigo-500", emerald: "bg-emerald-500", rose: "bg-rose-500", amber: "bg-amber-500", violet: "bg-violet-500" };
  return (
    <div className="flex items-center gap-2.5 mb-4 mt-8">
      <span className={`w-2 h-2 rounded-full ${dots[color]}`} />
      <h2 className="text-base font-bold text-slate-700 uppercase tracking-wide">{children}</h2>
      {count != null && (
        <span className="ml-1 px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{count}</span>
      )}
    </div>
  );
}

function TrendArrow({ pct }) {
  if (pct === 0) return <span className="text-slate-400 text-xs font-medium">no change</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${up ? "text-rose-500" : "text-emerald-500"}`}>
      <svg className={`w-3.5 h-3.5 ${up ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
      </svg>
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function ExpandToggle({ expanded, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-500 hover:text-indigo-700 transition-colors"
    >
      {label}
      <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function Skeleton() {
  return (
    <div className="min-h-screen bg-slate-50 animate-pulse">
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 px-6 pt-8 pb-14">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="h-4 w-40 bg-white/10 rounded" />
          <div className="h-10 w-64 bg-white/10 rounded" />
          <div className="grid grid-cols-3 gap-3 mt-6">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-white/[0.07] rounded-2xl" />)}
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 -mt-4 space-y-6 pb-16">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 bg-white rounded-2xl shadow-sm" />)}
      </div>
    </div>
  );
}

/* ── chart tooltip ────────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl border border-slate-700">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {fc(p.value)}</p>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  MAIN DASHBOARD                                                      */
/* ══════════════════════════════════════════════════════════════════════ */

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [expandedType, setExpandedType] = useState(null);
  const [expandBorrowing, setExpandBorrowing] = useState(false);
  const [expandObligations, setExpandObligations] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-v2"],
    queryFn: () => api.get("/api/dashboard/v2").then((r) => r.data),
  });

  if (isLoading || !data) return <Skeleton />;

  const { net_worth, lending, borrowing, obligations, expenses, investments, alerts, this_month, cashflow } = data;

  const collectionData = [
    { name: "Collected", value: this_month.total_collected, color: "#10b981" },
    { name: "Pending", value: this_month.pending, color: "#e2e8f0" },
  ].filter((d) => d.value > 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ──────────────────── HERO ──────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-12 sm:pb-14">
        {/* decorative blobs */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-violet-600/10 blur-3xl" />

        <div className="relative max-w-7xl mx-auto">
          <p className="text-indigo-300/80 text-sm font-medium">
            Welcome back, <span className="text-indigo-200 font-semibold">{user?.full_name || user?.username}</span>
          </p>

          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
            <h1 className="text-white text-3xl sm:text-4xl font-extrabold tracking-tight">{fcShort(net_worth.net_worth)}</h1>
            <span className="text-indigo-400/70 text-sm font-medium">Net Worth</span>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <GlassCard label="Total Assets" value={fcShort(net_worth.total_assets)} sub="Receivables + Investments + Cash" />
            <GlassCard label="Total Liabilities" value={fcShort(net_worth.total_liabilities)} sub="Payables + Borrowings" />
            <GlassCard label="Cash Balance" value={fcShort(net_worth.cash_balance)} sub="Across all accounts" />
          </div>
        </div>
      </div>

      {/* ──────────────────── BODY ──────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-5 pb-16 relative z-10">

        {/* ── LENDING ─────────────────────────────────── */}
        <SectionTitle color="emerald" count={lending.active_count}>Lending</SectionTitle>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Total Lent (All-time)" value={fcShort(lending.total_lent_all_time)} accent="emerald" />
          <Stat label="Outstanding" value={fcShort(lending.total_outstanding)} accent="sky" />
          <Stat label="Interest Earned" value={fcShort(lending.total_interest_earned)} accent="teal" />
          <Stat label="Principal Recovered" value={fcShort(lending.total_principal_recovered)} accent="indigo" />
        </div>

        {/* Loan-type tabs */}
        <div className="flex gap-2 flex-wrap">
          {["interest_only", "emi", "short_term"].map((lt) => {
            const info = lending.by_type[lt];
            const tc = TYPE_COLORS[lt];
            const isOpen = expandedType === lt;
            return (
              <button
                key={lt}
                onClick={() => setExpandedType(isOpen ? null : lt)}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ring-2 ${
                  isOpen
                    ? `${tc.bg} ${tc.text} ${tc.ring} shadow-md`
                    : "bg-white text-slate-600 ring-slate-200/80 hover:ring-slate-300 shadow-sm"
                }`}
              >
                {TYPE_LABELS[lt]}{" "}
                <span className={`ml-1 text-xs ${isOpen ? "opacity-80" : "text-slate-400"}`}>
                  {info.active_count}A / {info.closed_count}C
                </span>
              </button>
            );
          })}
        </div>

        {/* Inline expansion */}
        {expandedType && (
          <div className="mt-3 bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
            <div className={`px-5 py-3 border-b border-slate-100 flex items-center justify-between ${TYPE_COLORS[expandedType].bg}`}>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold ${TYPE_COLORS[expandedType].text}`}>{TYPE_LABELS[expandedType]} Loans</span>
                <span className="text-xs text-slate-500">
                  Outstanding: <b>{fcShort(lending.by_type[expandedType].total_outstanding)}</b>
                  {" \u00b7 "}
                  Earned: <b>{fcShort(lending.by_type[expandedType].total_interest_earned)}</b>
                </span>
              </div>
            </div>
            <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
              {lending.by_type[expandedType].loans.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No loans in this category</p>
              ) : (
                lending.by_type[expandedType].loans.map((loan) => (
                  <div
                    key={loan.id}
                    onClick={() => navigate(`/loans/${loan.id}`)}
                    className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[loan.status] || "bg-slate-300"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{loan.contact_name}</p>
                        <p className="text-[11px] text-slate-400">{loan.disbursed_date || "\u2014"} &middot; {loan.status}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-sm font-bold text-slate-800">{fcShort(loan.principal)}</p>
                      <p className="text-[11px] text-slate-400">
                        Out: {fcShort(loan.outstanding)} &middot; Earned: {fcShort(loan.interest_earned)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── THIS MONTH + CHART ROW ─────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mt-8">
          {/* This month collections */}
          <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-700">{this_month.month_name}</h3>
                <p className="text-[11px] text-slate-400">Collections this month</p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
                {this_month.collection_rate_pct}%
              </span>
            </div>

            <div className="flex items-center gap-5 mb-1">
              <div className="w-28 h-28 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={collectionData.length > 0 ? collectionData : [{ name: "None", value: 1, color: "#e2e8f0" }]}
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={44}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {(collectionData.length > 0 ? collectionData : [{ color: "#e2e8f0" }]).map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 flex-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Collected</span>
                  <span className="font-bold text-slate-800">{fc(this_month.total_collected)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Principal</span>
                  <span className="font-semibold text-indigo-600">{fc(this_month.principal_portion)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Interest</span>
                  <span className="font-semibold text-teal-600">{fc(this_month.interest_portion)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1.5">
                  <span className="text-slate-500">Pending</span>
                  <span className="font-bold text-amber-600">{fc(this_month.pending)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Cashflow area chart */}
          <div className="xl:col-span-3 bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-1">Cash Flow</h3>
            <p className="text-[11px] text-slate-400 mb-4">6-month inflow vs outflow</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashflow} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gInflow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOutflow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => (v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="inflow" stroke="#10b981" strokeWidth={2} fill="url(#gInflow)" name="Inflow" />
                  <Area type="monotone" dataKey="outflow" stroke="#f43f5e" strokeWidth={2} fill="url(#gOutflow)" name="Outflow" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ── LIABILITIES ─────────────────────────────── */}
        <SectionTitle color="rose">Liabilities</SectionTitle>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Borrowing */}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">Borrowing</h3>
              {borrowing.loans.length > 0 && (
                <ExpandToggle expanded={expandBorrowing} onClick={() => setExpandBorrowing(!expandBorrowing)} label={`${borrowing.loans.length} active`} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-widest">Total Borrowed</p>
                <p className="text-lg font-extrabold text-slate-800">{fcShort(borrowing.total_borrowed)}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-widest">Outstanding</p>
                <p className="text-lg font-extrabold text-rose-600">{fcShort(borrowing.total_outstanding)}</p>
              </div>
            </div>

            {expandBorrowing && (
              <div className="border-t border-slate-100 pt-2 mt-2 space-y-1 max-h-48 overflow-y-auto">
                {borrowing.loans.map((l) => (
                  <div
                    key={l.id}
                    onClick={() => navigate(`/loans/${l.id}`)}
                    className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{l.institution_name || l.contact_name || `Loan #${l.id}`}</p>
                      <p className="text-[11px] text-slate-400">{(l.loan_type || "").replace("_", " ")}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-bold text-slate-800">{fcShort(l.outstanding)}</p>
                      <p className="text-[11px] text-slate-400">of {fcShort(l.principal)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Obligations */}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">Obligations</h3>
              {obligations.items.length > 0 && (
                <ExpandToggle expanded={expandObligations} onClick={() => setExpandObligations(!expandObligations)} label={`${obligations.items.length} open`} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-widest">Receivable</p>
                <p className="text-lg font-extrabold text-emerald-600">{fcShort(obligations.receivable_pending)}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-widest">Payable</p>
                <p className="text-lg font-extrabold text-rose-600">{fcShort(obligations.payable_pending)}</p>
              </div>
            </div>

            {expandObligations && (
              <div className="border-t border-slate-100 pt-2 mt-2 space-y-1 max-h-48 overflow-y-auto">
                {obligations.items.map((ob) => (
                  <div
                    key={ob.id}
                    onClick={() => navigate("/obligations")}
                    className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${ob.type === "receivable" ? "bg-emerald-400" : "bg-rose-400"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700 truncate">{ob.contact_name || ob.reason || `#${ob.id}`}</p>
                        <p className="text-[11px] text-slate-400">{ob.type} &middot; {ob.status}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className={`text-sm font-bold ${ob.type === "receivable" ? "text-emerald-700" : "text-rose-700"}`}>{fcShort(ob.pending)}</p>
                      <p className="text-[11px] text-slate-400">of {fcShort(ob.amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── INVESTMENTS & EXPENSES ──────────────────── */}
        <SectionTitle color="violet">Investments &amp; Expenses</SectionTitle>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Properties */}
          <div
            onClick={() => navigate("/properties")}
            className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 hover:shadow-md cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </span>
              <h4 className="text-sm font-bold text-slate-700 group-hover:text-violet-700 transition-colors">Properties</h4>
            </div>
            <p className="text-xl font-extrabold text-slate-800">{investments.properties.count}</p>
            <div className="text-[11px] text-slate-400 mt-1 space-y-0.5">
              <p>Invested: {fcShort(investments.properties.total_invested)}</p>
              <p>Profit: <span className={investments.properties.total_profit >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>{fcShort(investments.properties.total_profit)}</span></p>
            </div>
          </div>

          {/* Partnerships */}
          <div
            onClick={() => navigate("/partnerships")}
            className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 hover:shadow-md cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              <h4 className="text-sm font-bold text-slate-700 group-hover:text-indigo-700 transition-colors">Partnerships</h4>
            </div>
            <p className="text-xl font-extrabold text-slate-800">{investments.partnerships.count}</p>
            <div className="text-[11px] text-slate-400 mt-1 space-y-0.5">
              <p>Invested: {fcShort(investments.partnerships.total_invested)}</p>
              <p>Received: <span className="text-emerald-600 font-semibold">{fcShort(investments.partnerships.total_received)}</span></p>
            </div>
          </div>

          {/* Beesi */}
          <div
            onClick={() => navigate("/beesi")}
            className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 hover:shadow-md cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </span>
              <h4 className="text-sm font-bold text-slate-700 group-hover:text-amber-700 transition-colors">Beesi</h4>
            </div>
            <p className="text-xl font-extrabold text-slate-800">{investments.beesi.count}</p>
            <div className="text-[11px] text-slate-400 mt-1 space-y-0.5">
              <p>Paid: {fcShort(investments.beesi.total_paid)}</p>
              <p>Received: <span className="text-emerald-600 font-semibold">{fcShort(investments.beesi.total_received)}</span></p>
            </div>
          </div>

          {/* Expenses */}
          <div
            onClick={() => navigate("/expenses")}
            className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 hover:shadow-md cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
              </span>
              <h4 className="text-sm font-bold text-slate-700 group-hover:text-rose-700 transition-colors">Expenses</h4>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-extrabold text-slate-800">{fcShort(expenses.this_month_total)}</p>
              <TrendArrow pct={expenses.trend_pct} />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Last month: {fcShort(expenses.last_month_total)}</p>
            {expenses.top_categories.length > 0 && (
              <div className="mt-2 space-y-1">
                {expenses.top_categories.slice(0, 3).map((c) => (
                  <div key={c.name} className="flex justify-between text-[11px]">
                    <span className="text-slate-500 truncate">{c.name}</span>
                    <span className="text-slate-700 font-semibold">{fcShort(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── ALERTS ──────────────────────────────────── */}
        {alerts.length > 0 && (
          <>
            <SectionTitle color="amber" count={alerts.length}>Alerts</SectionTitle>
            <div className="space-y-2">
              {alerts.map((a, i) => {
                const colors = {
                  emi_overdue: { border: "border-l-rose-500", bg: "bg-rose-50/60", title: "text-rose-800", desc: "text-rose-600", badge: "bg-rose-100 text-rose-700" },
                  collateral: { border: "border-l-amber-500", bg: "bg-amber-50/60", title: "text-amber-800", desc: "text-amber-600", badge: "bg-amber-100 text-amber-700" },
                  interest_overdue: { border: "border-l-slate-400", bg: "bg-slate-50/60", title: "text-slate-700", desc: "text-slate-500", badge: "bg-slate-100 text-slate-600" },
                };
                const c = colors[a.type] || colors.interest_overdue;
                return (
                  <div
                    key={i}
                    onClick={() => navigate(`/loans/${a.loan_id}`)}
                    className={`flex items-center justify-between px-5 py-3 rounded-2xl border border-l-4 ${c.border} ${c.bg} hover:shadow-sm cursor-pointer transition-all`}
                  >
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${c.title}`}>{a.title}</p>
                      <p className={`text-xs ${c.desc} mt-0.5`}>{a.description}</p>
                    </div>
                    <span className={`shrink-0 ml-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${c.badge}`}>
                      {a.type === "emi_overdue" ? "EMI" : a.type === "collateral" ? "Collateral" : "Interest"}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* If no alerts */}
        {alerts.length === 0 && (
          <>
            <SectionTitle color="amber">Alerts</SectionTitle>
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-600">All clear!</p>
              <p className="text-xs text-slate-400 mt-0.5">No overdue EMIs or risky collateral</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
