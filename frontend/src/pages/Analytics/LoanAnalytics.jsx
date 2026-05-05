import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const fmt = formatCurrency;
function fmtPct(n) { return n == null ? "—" : `${n.toFixed(1)}%`; }

const TYPE_META = {
  emi:           { label: "EMI",           color: "#6366f1" },
  interest_only: { label: "Interest-Only", color: "#10b981" },
  short_term:    { label: "Short-Term",    color: "#f59e0b" },
  other:         { label: "Other",         color: "#8b5cf6" },
};
const PERF_META = {
  over:     { label: "Over",     cls: "bg-emerald-100 text-emerald-700" },
  on_track: { label: "On Track", cls: "bg-blue-100 text-blue-700" },
  under:    { label: "Under",    cls: "bg-rose-100 text-rose-700" },
  open:     { label: "Open",     cls: "bg-slate-100 text-slate-500" },
};

/* ── Ghost Stat Card ── */
function GhostStat({ label, value, sub, onClick, accent = "#6366f1" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderTop: `3px solid ${accent}` }}
      className={`bg-white border border-slate-200/60 rounded-2xl rounded-tl-none rounded-tr-none p-6 text-left w-full transition-all duration-150 ${
        onClick ? "hover:shadow-lg cursor-pointer group" : "cursor-default"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400 mb-3">{label}</p>
      <p className="text-2xl font-bold leading-tight tabular-nums" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-2 leading-tight">{sub}</p>}
      {onClick && (
        <p className="text-[10px] text-slate-300 mt-2 group-hover:text-slate-400 transition-colors">tap to see calc ↗</p>
      )}
    </button>
  );
}

/* ── Thin progress bar ── */
function ThinBar({ pct, color }) {
  return (
    <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(Math.max(pct || 0, 0), 100)}%`, backgroundColor: color }} />
    </div>
  );
}

/* ── Donut Chart ── */
function TypeDonut({ allLoans }) {
  const data = useMemo(() => {
    const counts = {};
    for (const l of allLoans) {
      const t = l.loan_type || "other";
      if (!counts[t]) counts[t] = { count: 0, principal: 0 };
      counts[t].count += 1;
      counts[t].principal += l.principal || 0;
    }
    return Object.entries(counts).map(([type, v]) => ({
      type, label: TYPE_META[type]?.label || type,
      value: v.principal, count: v.count,
      color: TYPE_META[type]?.color || "#8b5cf6",
    }));
  }, [allLoans]);

  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length) return null;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5">
      <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400 mb-4">Portfolio Mix</p>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <ResponsiveContainer width={110} height={110}>
            <PieChart>
              <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={52} strokeWidth={0} paddingAngle={2}>
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-base font-bold text-slate-800">{allLoans.length}</span>
            <span className="text-[9px] text-slate-400 uppercase tracking-wide">loans</span>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 min-w-0 flex-1">
          {data.map((d) => (
            <div key={d.type}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-xs text-slate-600 truncate flex-1">{d.label}</span>
                <span className="text-xs font-semibold text-slate-800 tabular-nums">{d.count}</span>
                <span className="text-[10px] text-slate-400 tabular-nums w-9 text-right">
                  {total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : "—"}
                </span>
              </div>
              <ThinBar pct={total > 0 ? (d.value / total) * 100 : 0} color={d.color} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Performance Heatmap ── */
function PerformanceHeatmap({ allLoans }) {
  const types = ["emi", "interest_only", "short_term"];
  const perfs = ["over", "on_track", "under", "open"];

  const matrix = useMemo(() => {
    const m = {};
    for (const perf of perfs) {
      m[perf] = {};
      for (const type of types) {
        const loans = allLoans.filter(l => l.loan_type === type && l.performance === perf);
        m[perf][type] = { count: loans.length, principal: loans.reduce((s, l) => s + l.principal, 0) };
      }
    }
    return m;
  }, [allLoans]);

  const maxCount = Math.max(1, ...perfs.flatMap(p => types.map(t => matrix[p][t].count)));

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5">
      <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400 mb-4">Performance × Type</p>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left pr-2 pb-2 text-slate-400 font-normal"></th>
            {types.map(t => (
              <th key={t} className="text-center pb-2 text-slate-400 font-normal px-1">
                {TYPE_META[t]?.label || t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {perfs.map(perf => (
            <tr key={perf}>
              <td className="pr-2 py-1.5 text-slate-500">{PERF_META[perf].label}</td>
              {types.map(t => {
                const cell = matrix[perf][t];
                const intensity = cell.count / maxCount;
                const color = TYPE_META[t]?.color || "#94a3b8";
                const opacity = Math.round(intensity * 50 + 10).toString(16).padStart(2, "0");
                return (
                  <td key={t} className="py-1.5 px-1 text-center">
                    <div
                      className="inline-flex items-center justify-center w-9 h-8 rounded-lg text-xs font-semibold"
                      style={{
                        backgroundColor: cell.count > 0 ? `${color}${opacity}` : "#f8fafc",
                        color: cell.count > 0 ? color : "#cbd5e1",
                      }}
                      title={cell.count > 0 ? `${cell.count} loans · ${fmt(cell.principal)}` : "none"}
                    >
                      {cell.count || "·"}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-1.5">What these mean</p>
        <p className="text-[10px] text-slate-400"><span className="text-emerald-600 font-semibold">Over</span> — paid more than expected, ahead of schedule</p>
        <p className="text-[10px] text-slate-400"><span className="text-blue-500 font-semibold">On Track</span> — paying as expected, no issues</p>
        <p className="text-[10px] text-slate-400"><span className="text-rose-500 font-semibold">Under</span> — behind on payments, collecting less</p>
        <p className="text-[10px] text-slate-400"><span className="text-slate-400 font-semibold">Open</span> — no payments recorded yet</p>
      </div>
    </div>
  );
}

/* ── Type Summary Card ── */
function TypeSummaryCard({ type, data, onCalcClick }) {
  const meta = TYPE_META[type] || TYPE_META.other;
  const isEmi = type === "emi";
  const isIO  = type === "interest_only";
  const isST  = type === "short_term";
  const pb = data.performance_breakdown || {};
  const ioPending     = isIO ? (data.total_interest_pending || data.total_interest_outstanding || 0) : 0;
  const ioCapitalized = isIO ? (data.total_capitalized_interest || 0) : 0;
  const activeDeployed = isIO ? (data.total_active_original_principal || 0) : (data.total_principal || 0);

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5" style={{ borderLeft: `3px solid ${meta.color}` }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
          <span className="text-sm font-semibold text-slate-800">{meta.label}</span>
        </div>
        <span className="text-xs text-slate-400">{data.count || 0} · {data.active || 0} active</span>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-baseline">
          <button type="button" onClick={() => onCalcClick(isEmi ? "emi_principal" : isIO ? "io_principal" : "st_principal")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors text-left">
            {isIO ? "Active Capital" : "Capital Deployed"} ↗
          </button>
          <span className="text-sm font-bold text-slate-900 tabular-nums">{fmt(activeDeployed)}</span>
        </div>

        {!isST && (
          <div className="flex justify-between items-baseline">
            <button type="button" onClick={() => onCalcClick(isEmi ? "emi_interest" : "io_collected")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors text-left">
              {isEmi ? "Interest Earned" : "Interest Collected"} ↗
            </button>
            <span className="text-sm font-bold text-emerald-600 tabular-nums">{fmt(data.total_interest_earned || 0)}</span>
          </div>
        )}

        {isST && (
          <>
            <div className="flex justify-between items-baseline">
              <button type="button" onClick={() => onCalcClick("st_recovered")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Principal Recovered ↗</button>
              <span className="text-sm font-bold text-emerald-600 tabular-nums">{fmt(data.total_principal_recovered || 0)}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <button type="button" onClick={() => onCalcClick("st_extra")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Extra Collected ↗</button>
              <span className="text-sm font-bold text-amber-600 tabular-nums">{fmt(data.total_extra_collected || 0)}</span>
            </div>
            {(data.total_principal_outstanding || 0) > 0 && (
              <div className="flex justify-between items-baseline">
                <button type="button" onClick={() => onCalcClick("st_outstanding")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Still To Recover ↗</button>
                <span className="text-sm font-bold text-rose-500 tabular-nums">{fmt(data.total_principal_outstanding || 0)}</span>
              </div>
            )}
          </>
        )}

        {isIO && ioPending > 0 && (
          <div className="flex justify-between items-baseline">
            <button type="button" onClick={() => onCalcClick("io_pending")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Interest Pending ↗</button>
            <span className="text-sm font-bold text-rose-500 tabular-nums">{fmt(ioPending)}</span>
          </div>
        )}

        {isIO && ioCapitalized > 0 && (
          <div className="flex gap-1.5 flex-wrap pt-1">
            <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{fmt(data.total_interest_outstanding || 0)} accrued</span>
            <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">+{fmt(ioCapitalized)} capitalized</span>
          </div>
        )}

        {isEmi && (data.total_principal_recovered || 0) > 0 && (
          <div className="flex justify-between items-baseline">
            <button type="button" onClick={() => onCalcClick("emi_principal")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors text-left">
              Principal Recovered ↗
            </button>
            <span className="text-sm font-bold text-emerald-600 tabular-nums">{fmt(data.total_principal_recovered || 0)}</span>
          </div>
        )}

        {isEmi && (data.total_principal_outstanding || 0) > 0 && (
          <div className="flex justify-between items-baseline">
            <span className="text-xs text-slate-400">Still with Borrowers</span>
            <span className="text-sm font-bold text-rose-500 tabular-nums">{fmt(data.total_principal_outstanding || 0)}</span>
          </div>
        )}

        {isEmi && (data.interest_coverage_pct || 0) > 0 && (
          <div className="pt-1">
            <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
              <span>Collection vs Expected</span>
              <span className={`font-semibold ${(data.interest_coverage_pct || 0) >= 85 ? "text-emerald-600" : "text-rose-500"}`}>
                {fmtPct(data.interest_coverage_pct)}
              </span>
            </div>
            <ThinBar pct={data.interest_coverage_pct || 0} color={(data.interest_coverage_pct || 0) >= 85 ? "#10b981" : "#ef4444"} />
          </div>
        )}
      </div>

      {(pb.over > 0 || pb.on_track > 0 || pb.under > 0 || pb.open > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-slate-100">
          {pb.over > 0 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{pb.over} over</span>}
          {pb.on_track > 0 && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{pb.on_track} on track</span>}
          {pb.under > 0 && <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{pb.under} under</span>}
          {pb.open > 0 && <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{pb.open} open</span>}
        </div>
      )}
    </div>
  );
}

/* ── Area Chart ── */
function MonthlyAreaChart({ data, onMonthClick, chartView, setChartView }) {
  const hasData = data?.some(m => m.interest_earned > 0 || m.principal_recovered > 0);
  if (!hasData) return null;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400 mb-0.5">Monthly Cash Flow</p>
          <p className="text-sm font-semibold text-slate-800">Last 12 Months</p>
        </div>
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {[{ v: "earnings", l: "Earnings" }, { v: "cashflow", l: "Cash Flow" }].map(({ v, l }) => (
            <button key={v} onClick={() => setChartView(v)} className={`text-[11px] px-3 py-1 rounded-md transition-all ${chartView === v ? "bg-white text-slate-800 shadow-sm font-medium" : "text-slate-400 hover:text-slate-600"}`}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-slate-300 mb-3">Click any point to see detail</p>
      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 25 }} onClick={(e) => { if (e?.activePayload?.[0]) onMonthClick(e.activePayload[0].payload); }} style={{ cursor: "pointer" }}>
          <defs>
            <linearGradient id="gInt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gPri" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gPen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} angle={-30} textAnchor="end" height={45} interval={0} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
          <Tooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xl text-xs min-w-[155px]">
                <p className="font-semibold text-slate-700 mb-2">{label}</p>
                {payload.map((p) => (
                  <div key={p.dataKey} className="flex items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} /><span className="text-slate-500">{p.name}</span></div>
                    <span className="font-semibold text-slate-800">{fmt(p.value)}</span>
                  </div>
                ))}
              </div>
            );
          }} />
          <Area type="monotone" dataKey="interest_earned" name="Interest" stroke="#10b981" strokeWidth={1.5} fill="url(#gInt)" dot={{ r: 2.5, fill: "#10b981", strokeWidth: 0 }} activeDot={{ r: 4 }} />
          {chartView === "earnings"
            ? <Area type="monotone" dataKey="penalty_collected" name="Penalty" stroke="#f59e0b" strokeWidth={1.5} fill="url(#gPen)" dot={{ r: 2.5, fill: "#f59e0b", strokeWidth: 0 }} activeDot={{ r: 4 }} />
            : <Area type="monotone" dataKey="principal_recovered" name="Principal" stroke="#6366f1" strokeWidth={1.5} fill="url(#gPri)" dot={{ r: 2.5, fill: "#6366f1", strokeWidth: 0 }} activeDot={{ r: 4 }} />
          }
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Collapsible Loan Row ── */
function LoanRow({ loan, isShortTerm, isEmi }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[loan.loan_type] || TYPE_META.other;
  const perfMeta = PERF_META[loan.performance] || PERF_META.open;

  return (
    <>
      <tr className="hover:bg-slate-50/60 cursor-pointer transition-colors" onClick={() => setExpanded(!expanded)}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
            <span className="text-xs font-medium text-slate-800">{loan.contact_name}</span>
            <span className="text-slate-300 ml-auto text-[10px]">{expanded ? "▴" : "▾"}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-xs tabular-nums font-medium text-slate-700">{fmt(loan.principal)}</td>
        <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">{loan.interest_rate > 0 ? `${loan.interest_rate}%` : "—"}</td>
        <td className="px-4 py-3 text-xs text-slate-400">
          {loan.disbursed_date ? new Date(loan.disbursed_date).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : "—"}
        </td>
        <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">{loan.months_active}m</td>
        {isShortTerm ? (
          <>
            <td className="px-4 py-3 text-xs font-semibold text-emerald-600 tabular-nums">{fmt(loan.principal_recovered)}</td>
            <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: loan.principal_outstanding > 0 ? "#e11d48" : "#94a3b8" }}>
              {loan.principal_outstanding > 0 ? fmt(loan.principal_outstanding) : "—"}
            </td>
            <td className="px-4 py-3 text-xs font-semibold text-amber-600 tabular-nums">
              {(loan.interest_earned + loan.penalty_collected) > 0 ? fmt(loan.interest_earned + loan.penalty_collected) : "—"}
            </td>
          </>
        ) : (
          <>
            <td className="px-4 py-3 text-xs font-semibold text-emerald-600 tabular-nums">
              {fmt(loan.interest_earned)}
              {loan.penalty_collected > 0 && <span className="ml-1 text-[10px] text-amber-500">+{fmt(loan.penalty_collected)}</span>}
            </td>
            <td className="px-4 py-3 text-xs text-slate-400 tabular-nums">
              {loan.interest_at_completion > 0 ? fmt(loan.interest_at_completion) : "—"}
            </td>
            <td className="px-4 py-3 text-xs tabular-nums">
              <span className={`font-semibold ${loan.yield_pa >= 12 ? "text-emerald-600" : loan.yield_pa >= 6 ? "text-amber-600" : loan.yield_pa > 0 ? "text-rose-500" : "text-slate-400"}`}>
                {loan.yield_pa > 0 ? `${loan.yield_pa.toFixed(1)}%` : "—"}
              </span>
            </td>
            <td className="px-4 py-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${perfMeta.cls}`}>{perfMeta.label}</span>
            </td>
          </>
        )}
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            loan.status === "active" ? "bg-emerald-100 text-emerald-700"
            : loan.status === "closed" ? "bg-slate-100 text-slate-500"
            : "bg-rose-100 text-rose-700"
          }`}>{loan.status}</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={isShortTerm ? 9 : 10} className="px-4 pb-3 pt-0 bg-slate-50/40">
            <div className="bg-white rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs border border-slate-100">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Principal</p>
                <p className="font-semibold text-slate-800">{fmt(loan.principal)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Rate</p>
                <p className="font-semibold text-slate-800">{loan.interest_rate > 0 ? `${loan.interest_rate}% p.a.` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Disbursed</p>
                <p className="font-semibold text-slate-800">
                  {loan.disbursed_date ? new Date(loan.disbursed_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Active For</p>
                <p className="font-semibold text-slate-800">{loan.months_active} months</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Interest Earned</p>
                <p className="font-semibold text-emerald-600">{fmt(loan.interest_earned)}</p>
              </div>
              {loan.penalty_collected > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Penalty</p>
                  <p className="font-semibold text-amber-600">{fmt(loan.penalty_collected)}</p>
                </div>
              )}
              {loan.yield_pa > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Yield p.a.</p>
                  <p className={`font-semibold ${loan.yield_pa >= 12 ? "text-emerald-600" : loan.yield_pa >= 6 ? "text-amber-600" : "text-rose-500"}`}>
                    {loan.yield_pa.toFixed(2)}%
                  </p>
                </div>
              )}
              {isEmi && loan.debug?.emi_split && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">EMI Structure</p>
                  <p className="font-semibold text-slate-800">{fmt(loan.debug.emi_split.emi_amount)} × {loan.debug.emi_split.tenure}m</p>
                </div>
              )}
              {loan.principal_outstanding > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Principal Outstanding</p>
                  <p className="font-semibold text-rose-500">{fmt(loan.principal_outstanding)}</p>
                </div>
              )}
              {loan.interest_outstanding > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Interest Outstanding</p>
                  <p className="font-semibold text-rose-400">{fmt(loan.interest_outstanding)}</p>
                </div>
              )}
              {loan.interest_at_completion > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">{isEmi ? "Lifetime Interest" : "Expected at Term"}</p>
                  <p className="font-semibold text-slate-600">{fmt(loan.interest_at_completion)}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Loan Group Section ── */
function LoanGroupSection({ ltype, loans }) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = TYPE_META[ltype] || { label: ltype, color: "#8b5cf6" };
  const isShortTerm = ltype === "short_term";
  const isEmi = ltype === "emi";

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50/80 transition-colors text-left"
        style={{ borderLeft: `3px solid ${meta.color}` }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
        <span className="text-xs font-semibold text-slate-700">{meta.label}</span>
        <span className="text-xs text-slate-400">({loans.length})</span>
        <span className="ml-auto text-slate-300 text-xs">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/40">
              <th className="px-4 py-2 font-medium">Borrower</th>
              <th className="px-4 py-2 font-medium">Principal</th>
              <th className="px-4 py-2 font-medium">Rate</th>
              <th className="px-4 py-2 font-medium">Since</th>
              <th className="px-4 py-2 font-medium">Months</th>
              {isShortTerm ? (
                <>
                  <th className="px-4 py-2 font-medium">Recovered</th>
                  <th className="px-4 py-2 font-medium">Outstanding</th>
                  <th className="px-4 py-2 font-medium">Extra</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-2 font-medium">Earned</th>
                  <th className="px-4 py-2 font-medium">{isEmi ? "Lifetime" : "At Term"}</th>
                  <th className="px-4 py-2 font-medium">Yield</th>
                  <th className="px-4 py-2 font-medium">Perf.</th>
                </>
              )}
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {(() => {
              // Count loans per contact to decide when to show sub-headers
              const contactCounts = {};
              for (const l of loans) {
                const n = l.contact_name || "Unknown";
                contactCounts[n] = (contactCounts[n] || 0) + 1;
              }
              return loans.map((loan, idx) => {
                const name = loan.contact_name || "Unknown";
                const isNewContact = idx === 0 || loans[idx - 1].contact_name !== loan.contact_name;
                const multiLoan = contactCounts[name] > 1;
                return (
                  <React.Fragment key={loan.loan_id}>
                    {isNewContact && multiLoan && (
                      <tr>
                        <td colSpan={isShortTerm ? 9 : 10} className="px-4 pt-2.5 pb-0.5 bg-slate-50/60 border-t border-slate-100">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                            {name} · {contactCounts[name]} loans
                          </span>
                        </td>
                      </tr>
                    )}
                    <LoanRow loan={loan} isShortTerm={isShortTerm} isEmi={isEmi} />
                  </React.Fragment>
                );
              });
            })()}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Filter Bar ── */
function FilterBar({ filterType, setFilterType, filterStatus, setFilterStatus, filterBorrower, setFilterBorrower }) {
  const types = [
    { value: "all", label: "All Types" },
    { value: "emi", label: "EMI" },
    { value: "interest_only", label: "Interest-Only" },
    { value: "short_term", label: "Short-Term" },
  ];
  const statuses = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "closed", label: "Closed" },
  ];
  const isFiltered = filterType !== "all" || filterStatus !== "all" || filterBorrower;

  return (
    <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-sm border-b border-slate-200/60 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 max-w-7xl mx-auto">
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {types.map(t => (
            <button key={t.value} onClick={() => setFilterType(t.value)} className={`text-[11px] px-2.5 py-1 rounded-md transition-all ${filterType === t.value ? "bg-white text-slate-800 shadow-sm font-semibold" : "text-slate-400 hover:text-slate-600"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {statuses.map(s => (
            <button key={s.value} onClick={() => setFilterStatus(s.value)} className={`text-[11px] px-2.5 py-1 rounded-md transition-all ${filterStatus === s.value ? "bg-white text-slate-800 shadow-sm font-semibold" : "text-slate-400 hover:text-slate-600"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search borrower…"
          value={filterBorrower}
          onChange={(e) => setFilterBorrower(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300 bg-white"
        />
        {isFiltered && (
          <button onClick={() => { setFilterType("all"); setFilterStatus("all"); setFilterBorrower(""); }} className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
            Clear ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ── CalcModal ── */
function CalcModal({ data, onClose }) {
  if (!data) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <button className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 text-lg leading-none" onClick={onClose}>✕</button>
        <h3 className="font-bold text-slate-800 mb-0.5 text-sm">{data.title}</h3>
        {data.subtitle && <p className="text-[11px] text-slate-400 mb-4">{data.subtitle}</p>}
        <div className="space-y-0.5">
          {data.rows.map((row, i) =>
            row.divider
              ? <div key={i} className="border-t border-slate-200 my-2" />
              : (
                <div key={i} className="flex justify-between items-start gap-4 text-xs py-1.5">
                  <span className={row.bold ? "font-semibold text-slate-700" : "text-slate-500"}>{row.label}</span>
                  <span className={`font-semibold tabular-nums shrink-0 ${
                    row.highlight === "green" ? "text-emerald-600"
                    : row.highlight === "amber" ? "text-amber-600"
                    : row.highlight === "rose" ? "text-rose-600"
                    : row.highlight ? "text-indigo-600"
                    : "text-slate-800"
                  }`}>{row.value}</span>
                </div>
              )
          )}
        </div>
        {data.formula && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg">
            <p className="text-[11px] text-slate-400 font-medium mb-1">Yield formula</p>
            <p className="text-xs font-mono text-slate-700 break-all">{data.formula}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════ main page ═══════════════════════════════ */
export default function LoanAnalytics() {
  const [calcModal, setCalcModal] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterBorrower, setFilterBorrower] = useState("");
  const [chartView, setChartView] = useState("earnings");

  const { data, isLoading, error } = useQuery({
    queryKey: ["loanAnalytics"],
    queryFn: () => api.get("/api/analytics/loans-given").then((r) => r.data),
    staleTime: 2 * 60 * 1000,
  });

  // useMemo must be called before any conditional returns (Rules of Hooks)
  const allLoans = data?.loans || [];
  const filteredLoans = useMemo(() => allLoans.filter(l => {
    if (filterType !== "all" && l.loan_type !== filterType) return false;
    if (filterStatus !== "all" && l.status !== filterStatus) return false;
    if (filterBorrower && !l.contact_name?.toLowerCase().includes(filterBorrower.toLowerCase())) return false;
    return true;
  }), [allLoans, filterType, filterStatus, filterBorrower]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-7 h-7 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading portfolio…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-rose-500 bg-white px-6 py-4 rounded-xl border border-rose-200">Failed to load loan analytics.</p>
      </div>
    );
  }

  const p = data?.portfolio || {};
  const byType = data?.by_type || {};
  const monthlyTrend = data?.monthly_trend || [];

  // ── Calc modal builder ───────────────────────────────────────────────────
  function buildCalcModal(key, extra) {
    const loansByType = (t) => allLoans.filter((l) => l.loan_type === t);
    switch (key) {
      case "total_deployed": {
        const rows = allLoans.map((l) => ({ label: `${l.contact_name} (${l.loan_type?.replace("_"," ")})`, value: fmt(l.principal) }));
        rows.push({ divider: true });
        rows.push({ label: `${allLoans.length} loans total`, value: fmt(p.total_deployed), highlight: true, bold: true });
        return { title: "Total Deployed", subtitle: "Sum of all loan principals (active + closed)", rows };
      }
      case "active_principal": {
        const active = allLoans.filter((l) => l.status === "active");
        const rows = active.map((l) => ({ label: `${l.contact_name} (${l.loan_type?.replace("_"," ")})`, value: fmt(l.principal_outstanding) }));
        rows.push({ divider: true });
        rows.push({ label: `${active.length} active loans`, value: fmt(p.active_principal), highlight: true, bold: true });
        return { title: "Active Principal", subtitle: "Outstanding principal per active loan (from outstanding service)", rows };
      }
      case "interest_earned": {
        const rows = [];
        const emi = loansByType("emi").filter((l) => l.interest_earned > 0);
        const others = allLoans.filter((l) => l.loan_type !== "emi" && l.interest_earned > 0);
        if (emi.length) {
          rows.push({ label: "── EMI Loans (proportional split) ──", value: "", bold: true });
          emi.forEach((l) => {
            const s = l.debug?.emi_split;
            rows.push({ label: `${l.contact_name} · cash=${fmt(l.debug?.total_cash_paid||0)} × ${s?.interest_ratio_pct||"?"}%`, value: fmt(l.interest_earned) });
          });
        }
        if (others.length) {
          rows.push({ label: "── Other Loans (direct allocation) ──", value: "", bold: true });
          others.forEach((l) => rows.push({ label: `${l.contact_name} (${l.loan_type?.replace("_"," ")})`, value: fmt(l.interest_earned) }));
        }
        rows.push({ divider: true });
        rows.push({ label: "Total Interest Earned", value: fmt(p.total_interest_earned), highlight: "green", bold: true });
        return { title: "Interest Earned", subtitle: "EMI: cash × interest ratio | Others: direct payment allocation", rows };
      }
      case "penalty": {
        const penaltyLoans = allLoans.filter((l) => l.penalty_collected > 0);
        const rows = penaltyLoans.length
          ? penaltyLoans.map((l) => ({ label: l.contact_name, value: fmt(l.penalty_collected), highlight: "amber" }))
          : [{ label: "No penalties recorded", value: "₹0" }];
        rows.push({ divider: true });
        rows.push({ label: "Total Penalty", value: fmt(p.total_penalty_collected), highlight: "amber", bold: true });
        return { title: "Penalty Collected", subtitle: "Late payment charges across all loans", rows };
      }
      case "total_earnings": {
        const rows = [
          { label: "Interest Earned", value: fmt(p.total_interest_earned), highlight: "green" },
          { label: "Penalty Collected", value: fmt(p.total_penalty_collected), highlight: "amber" },
          { divider: true },
          { label: "Total Earnings", value: fmt(p.total_earnings), highlight: true, bold: true },
        ];
        return { title: "Total Earnings", subtitle: "Interest Earned + Penalty Collected", rows };
      }
      case "portfolio_yield": {
        const contrib = allLoans.filter((l) => l.interest_earned > 0 && (l.debug?.years_active||0) > 0);
        const rows = contrib.map((l) => ({
          label: `${l.contact_name} · ${fmt(l.principal)} × ${l.debug?.years_active}y`,
          value: fmt(l.interest_earned),
        }));
        const totalCap = contrib.reduce((s, l) => s + l.principal * (l.debug?.years_active || 0), 0);
        const totalInt = contrib.reduce((s, l) => s + l.interest_earned, 0);
        rows.push({ divider: true });
        rows.push({ label: "Σ Interest Earned", value: fmt(totalInt) });
        rows.push({ label: "Σ (Principal × Years)", value: fmt(totalCap) });
        rows.push({ label: "Portfolio Yield = (Σ Int / Σ P×Y) × 100", value: totalCap > 0 ? `${((totalInt / totalCap) * 100).toFixed(2)}%` : "—", highlight: true, bold: true });
        return { title: "Portfolio Yield (Dollar-Weighted)", subtitle: "Σ(interest_earned) ÷ Σ(principal × years_active) × 100", rows, formula: totalCap > 0 ? `${fmt(totalInt)} ÷ ${fmt(totalCap)} × 100 = ${((totalInt/totalCap)*100).toFixed(2)}%` : "N/A" };
      }
      case "emi_principal": {
        const loans = loansByType("emi");
        const rows = loans.map((l) => ({ label: `${l.contact_name} (${l.status})`, value: fmt(l.principal) }));
        rows.push({ divider: true });
        rows.push({ label: "Total", value: fmt(byType?.emi?.total_principal||0), highlight: true, bold: true });
        return { title: "EMI — Capital Deployed", subtitle: "Sum of all EMI loan principals", rows };
      }
      case "emi_interest": {
        const loans = loansByType("emi");
        const rows = loans.map((l) => {
          const s = l.debug?.emi_split;
          return { label: `${l.contact_name} · cash=${fmt(l.debug?.total_cash_paid||0)} × ${s?.interest_ratio_pct||"?"}%`, value: fmt(l.interest_earned) };
        });
        rows.push({ divider: true });
        rows.push({ label: "Total Interest Earned", value: fmt(byType?.emi?.total_interest_earned||0), highlight: "green", bold: true });
        return { title: "EMI — Interest Paid So Far", subtitle: "Proportional split: total EMI cash × (lifetime interest ÷ total repayment)", rows };
      }
      case "emi_at_completion": {
        const loans = loansByType("emi");
        const rows = loans.map((l) => {
          const s = l.debug?.emi_split;
          return { label: `${l.contact_name} · ${s ? `${fmt(s.emi_amount)}×${s.tenure} − ${fmt(l.principal)}` : ""}`, value: fmt(l.interest_at_completion) };
        });
        rows.push({ divider: true });
        rows.push({ label: "Total", value: fmt(byType?.emi?.total_interest_at_completion||0), highlight: true, bold: true });
        return { title: "EMI — Total Interest When Closed", subtitle: "(EMI Amount × Tenure) − Principal", rows };
      }
      case "emi_penalty": {
        const loans = loansByType("emi").filter((l) => l.penalty_collected > 0);
        const rows = loans.map((l) => ({ label: l.contact_name, value: fmt(l.penalty_collected), highlight: "amber" }));
        rows.push({ divider: true });
        rows.push({ label: "Total", value: fmt(byType?.emi?.total_penalty||0), highlight: "amber", bold: true });
        return { title: "EMI — Penalty Collected", subtitle: "Late payment charges on EMI loans", rows };
      }
      case "io_principal": {
        const ioType = byType?.interest_only || {};
        const loans = loansByType("interest_only").filter((l) => l.status === "active");
        const rows = loans.map((l) => ({ label: l.contact_name, value: fmt(l.principal) }));
        rows.push({ divider: true });
        rows.push({ label: "Active Capital Deployed (original)", value: fmt(ioType.total_active_original_principal||0), highlight: true, bold: true });
        rows.push({ label: "All Loans Total (incl. closed)", value: fmt(ioType.total_principal||0) });
        return { title: "IO — Active Capital Deployed", subtitle: "Sum of original disbursed principals for active IO loans only", rows };
      }
      case "io_collected": {
        const loans = loansByType("interest_only").filter((l) => l.interest_earned > 0);
        const rows = loans.map((l) => ({ label: `${l.contact_name} (${l.status})`, value: fmt(l.interest_earned) }));
        rows.push({ divider: true });
        rows.push({ label: "Total Collected", value: fmt(byType?.interest_only?.total_interest_earned||0), highlight: "green", bold: true });
        return { title: "IO — Interest Collected", subtitle: "Actual payments received and allocated to interest", rows };
      }
      case "io_pending": {
        const ioType = byType?.interest_only || {};
        const currentOutstanding = ioType.total_interest_outstanding || 0;
        const capitalized = ioType.total_capitalized_interest || 0;
        const rows = [];
        rows.push({ label: "── Accrued (not yet paid) ──", value: "", bold: true });
        loansByType("interest_only").filter((l) => l.status === "active" && (l.interest_outstanding||0) > 0)
          .forEach((l) => rows.push({ label: l.contact_name, value: fmt(l.interest_outstanding), highlight: "rose" }));
        rows.push({ label: "Sub-total: accrued outstanding", value: fmt(currentOutstanding), bold: true });
        if (capitalized > 0) {
          rows.push({ divider: true });
          rows.push({ label: "── Capitalized into Principal ──", value: "", bold: true });
          rows.push({ label: "Interest added to principal in past cap events (still owed as interest from business perspective)", value: fmt(capitalized), highlight: "rose" });
        }
        rows.push({ divider: true });
        rows.push({ label: "Total Interest Pending", value: fmt(currentOutstanding + capitalized), highlight: "rose", bold: true });
        return { title: "IO — Interest Pending", subtitle: "Accrued outstanding + capitalized interest embedded in principal", rows };
      }
      case "io_at_completion": {
        const loans = loansByType("interest_only").filter((l) => l.interest_at_completion > 0);
        const rows = loans.map((l) => ({ label: `${l.contact_name} (${l.status})`, value: fmt(l.interest_at_completion) }));
        rows.push({ divider: true });
        rows.push({ label: "Total Expected", value: fmt(byType?.interest_only?.total_interest_at_completion||0), highlight: true, bold: true });
        return { title: "IO — Expected Total Interest (at term)", subtitle: "Principal × monthly rate × term months", rows };
      }
      case "st_principal": {
        const loans = loansByType("short_term");
        const rows = loans.map((l) => ({ label: `${l.contact_name} (${l.status})`, value: fmt(l.principal) }));
        rows.push({ divider: true });
        rows.push({ label: "Total", value: fmt(byType?.short_term?.total_principal||0), highlight: true, bold: true });
        return { title: "Short-Term — Capital Deployed", subtitle: "Sum of all short-term loan principals", rows };
      }
      case "st_recovered": {
        const loans = loansByType("short_term");
        const rows = loans.map((l) => ({ label: `${l.contact_name} (${l.status})`, value: fmt(l.principal_recovered) }));
        rows.push({ divider: true });
        rows.push({ label: "Total Recovered", value: fmt(byType?.short_term?.total_principal_recovered||0), highlight: "green", bold: true });
        return { title: "Short-Term — Principal Recovered", subtitle: "Payments allocated to principal repayment", rows };
      }
      case "st_outstanding": {
        const loans = loansByType("short_term").filter((l) => l.status === "active" && l.principal_outstanding > 0);
        const activeTotal = loans.reduce((s, l) => s + l.principal_outstanding, 0);
        const rows = loans.map((l) => ({ label: l.contact_name, value: fmt(l.principal_outstanding), highlight: "rose" }));
        rows.push({ divider: true });
        rows.push({ label: "Total Outstanding (active loans)", value: fmt(activeTotal), highlight: "rose", bold: true });
        return { title: "Short-Term — Still To Recover", subtitle: "Outstanding principal for active loans only — closed loans excluded", rows };
      }
      case "st_extra": {
        const loans = loansByType("short_term").filter((l) => (l.interest_earned + l.penalty_collected) > 0);
        const rows = loans.map((l) => ({
          label: `${l.contact_name} · int=${fmt(l.interest_earned)} + pen=${fmt(l.penalty_collected)}`,
          value: fmt(l.interest_earned + l.penalty_collected),
          highlight: "amber",
        }));
        rows.push({ divider: true });
        rows.push({ label: "Total Extra Collected", value: fmt(byType?.short_term?.total_extra_collected||0), highlight: "amber", bold: true });
        return { title: "Short-Term — Extra Beyond Principal", subtitle: "Interest earned + penalties (cash beyond principal return)", rows };
      }
      case "monthly": {
        if (!extra) return null;
        const rows = [
          { label: "Interest Earned", value: fmt(extra.interest_earned), highlight: "green" },
          { label: "Principal Recovered", value: fmt(extra.principal_recovered) },
          { label: "Penalty Collected", value: fmt(extra.penalty_collected), highlight: "amber" },
          { divider: true },
          { label: "Total Earnings (int + penalty)", value: fmt(extra.total_earnings), highlight: true, bold: true },
        ];
        return { title: `Monthly Detail — ${extra.label}`, subtitle: "Cash flows in this month (based on payment dates)", rows };
      }
      default:
        return null;
    }
  }

  function openCalc(key, extra) {
    const d = buildCalcModal(key, extra);
    if (d) setCalcModal(d);
  }

  const TYPE_ORDER = ["emi", "interest_only", "short_term", "other"];
  const grouped = {};
  for (const loan of filteredLoans) {
    const t = loan.loan_type || "other";
    if (!grouped[t]) grouped[t] = { active: [], closed: [] };
    if (loan.status === "active") grouped[t].active.push(loan);
    else grouped[t].closed.push(loan);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {calcModal && <CalcModal data={calcModal} onClose={() => setCalcModal(null)} />}

      <FilterBar
        filterType={filterType} setFilterType={setFilterType}
        filterStatus={filterStatus} setFilterStatus={setFilterStatus}
        filterBorrower={filterBorrower} setFilterBorrower={setFilterBorrower}
      />

      <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between pt-1">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Loan Portfolio</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {p.total_count || 0} loans · {p.active_count || 0} active · {p.closed_count || 0} closed · as of {data?.as_of_date}
            </p>
          </div>
          <span className="text-[10px] text-slate-300">tap cards to see calc ↗</span>
        </div>

        {/* Portfolio Ghost Stats */}
        {(() => {
          // Better "still to collect" figure: EMI future interest + IO pending (accrued + capitalized)
          const totalInterestRemaining =
            allLoans
              .filter(l => l.status === "active" && l.loan_type === "emi")
              .reduce((s, l) => s + Math.max((l.interest_at_completion || 0) - l.interest_earned, 0), 0)
            + (byType.interest_only?.total_interest_pending || byType.interest_only?.total_interest_outstanding || 0);
          return (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <GhostStat accent="#6366f1" label="Total Deployed"     value={fmt(p.total_deployed)}                        sub="All principals"          onClick={() => openCalc("total_deployed")} />
              <GhostStat accent="#8b5cf6" label="Active Principal"   value={fmt(p.active_principal)}                      sub="Still outstanding"       onClick={() => openCalc("active_principal")} />
              <GhostStat accent="#10b981" label="Interest Earned"    value={fmt(p.total_interest_earned)}                  sub={totalInterestRemaining > 0 ? `${fmt(totalInterestRemaining)} still to collect` : undefined} onClick={() => openCalc("interest_earned")} />
              <GhostStat accent="#f59e0b" label="Penalty Collected"  value={fmt(p.total_penalty_collected)}                sub="Late fees"               onClick={() => openCalc("penalty")} />
              <GhostStat accent="#14b8a6" label="Total Earnings"     value={fmt(p.total_earnings)}                         sub="Interest + penalty"      onClick={() => openCalc("total_earnings")} />
              <GhostStat accent="#f43f5e" label="Portfolio Yield"    value={`${(p.portfolio_yield_pa || 0).toFixed(1)}%`}  sub="Dollar-weighted p.a."    onClick={() => openCalc("portfolio_yield")} />
            </div>
          );
        })()}

        {/* Donut + Type Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <TypeDonut allLoans={allLoans} />
          <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
            {TYPE_ORDER.filter(t => byType[t]).map(t => {
              let typeData = byType[t];
              if (t === "emi") {
                // Only active loans: principal recovered and still outstanding
                const emiActive = allLoans.filter(l => l.loan_type === "emi" && l.status === "active");
                const emiAll    = allLoans.filter(l => l.loan_type === "emi");
                const emiRecoveredAll    = emiAll.reduce((s, l) => s + (l.principal_recovered || 0), 0);
                const emiActivePrincipal = emiActive.reduce((s, l) => s + l.principal, 0);
                const emiActiveRecovered = emiActive.reduce((s, l) => s + (l.principal_recovered || 0), 0);
                typeData = {
                  ...typeData,
                  total_principal_recovered: emiRecoveredAll,
                  // Only active loan outstanding — closed loans have no outstanding
                  total_principal_outstanding: emiActivePrincipal - emiActiveRecovered,
                };
              }
              if (t === "short_term") {
                // Recompute outstanding for active loans only
                const stActive = allLoans.filter(l => l.loan_type === "short_term" && l.status === "active");
                const stActivePrincipal = stActive.reduce((s, l) => s + l.principal, 0);
                const stActiveRecovered = stActive.reduce((s, l) => s + (l.principal_recovered || 0), 0);
                typeData = {
                  ...typeData,
                  total_principal_outstanding: stActivePrincipal - stActiveRecovered,
                };
              }
              return <TypeSummaryCard key={t} type={t} data={typeData} onCalcClick={openCalc} />;
            })}
          </div>
        </div>

        {/* Monthly Chart + Heatmap */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <MonthlyAreaChart data={monthlyTrend} onMonthClick={(payload) => openCalc("monthly", payload)} chartView={chartView} setChartView={setChartView} />
          </div>
          <PerformanceHeatmap allLoans={allLoans} />
        </div>

        {/* Loan Table */}
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold text-slate-700 uppercase tracking-widest">Individual Loans</h2>
            <span className="text-xs text-slate-400">{filteredLoans.length} of {allLoans.length} · click row to expand</span>
          </div>
          <div className="overflow-x-auto divide-y divide-slate-100">
            {TYPE_ORDER.filter(t => grouped[t]).map(t => {
              const g = grouped[t];
              const byName = (a, b) => (a.contact_name || "").localeCompare(b.contact_name || "");
              const loans = [
                ...[...g.active].sort(byName),
                ...[...g.closed].sort(byName),
              ];
              if (!loans.length) return null;
              return <LoanGroupSection key={t} ltype={t} loans={loans} />;
            })}
            {filteredLoans.length === 0 && (
              <div className="px-4 py-12 text-center text-slate-400 text-sm">
                {allLoans.length > 0 ? "No loans match the current filter." : "No loans found."}
              </div>
            )}
          </div>
          {filteredLoans.length > 0 && (() => {
            const totalPrincipal = filteredLoans.reduce((s, l) => s + l.principal, 0);
            const totalEarned = filteredLoans.reduce((s, l) => s + l.interest_earned, 0);
            const totalPenalty = filteredLoans.reduce((s, l) => s + l.penalty_collected, 0);
            const totalRecovered = filteredLoans.reduce((s, l) => s + l.principal_recovered, 0);
            return (
              <div className="flex flex-wrap items-center gap-5 px-4 py-3 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                <span>Principal: <strong className="text-slate-800">{fmt(totalPrincipal)}</strong></span>
                <span>Earned: <strong className="text-emerald-600">{fmt(totalEarned)}</strong></span>
                {totalPenalty > 0 && <span>Penalties: <strong className="text-amber-600">{fmt(totalPenalty)}</strong></span>}
                <span>Recovered: <strong className="text-indigo-600">{fmt(totalRecovered)}</strong></span>
              </div>
            );
          })()}
        </div>

        <p className="text-[10px] text-slate-400 text-center pb-4">
          Yield = Σ(interest) ÷ Σ(principal × years) — dollar-weighted return.
          "Over" = earned more than expected today. Yield % p.a. = per-loan annualized return.
        </p>
      </div>
    </div>
  );
}
