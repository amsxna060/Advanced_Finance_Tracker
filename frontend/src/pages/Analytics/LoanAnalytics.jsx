import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

/* ── formatters ── */
function fmtPct(n) {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

/* ── Stat card ── */
function StatCard({ label, primary, secondary, secondaryLabel, accent = "indigo", wide = false }) {
  const A = {
    indigo: { bg: "bg-indigo-50 border-indigo-200", txt: "text-indigo-700", sub: "text-indigo-400" },
    emerald: { bg: "bg-emerald-50 border-emerald-200", txt: "text-emerald-700", sub: "text-emerald-400" },
    amber:   { bg: "bg-amber-50 border-amber-200",   txt: "text-amber-700",   sub: "text-amber-400"   },
    rose:    { bg: "bg-rose-50 border-rose-200",      txt: "text-rose-700",    sub: "text-rose-400"    },
    violet:  { bg: "bg-violet-50 border-violet-200",  txt: "text-violet-700",  sub: "text-violet-400"  },
    cyan:    { bg: "bg-cyan-50 border-cyan-200",      txt: "text-cyan-700",    sub: "text-cyan-400"    },
    slate:   { bg: "bg-slate-50 border-slate-200",    txt: "text-slate-700",   sub: "text-slate-400"   },
  }[accent] || {};
  return (
    <div className={`${A.bg} border rounded-xl p-4 ${wide ? "col-span-2" : ""}`}>
      <p className={`text-[11px] font-medium uppercase tracking-wide ${A.sub} mb-1`}>{label}</p>
      <p className={`text-xl font-bold ${A.txt} leading-tight`}>{primary}</p>
      {secondary != null && (
        <p className={`text-[11px] mt-1 ${A.sub}`}>
          {secondaryLabel && <span className="font-medium">{secondaryLabel}: </span>}
          {secondary}
        </p>
      )}
    </div>
  );
}

/* ── Progress bar ── */
function Bar({ pct, color }) {
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(Math.max(pct || 0, 0), 150)}%`, backgroundColor: color }}
      />
    </div>
  );
}

/* ── Type colours ── */
const TYPE_META = {
  emi:           { label: "EMI Loans",          color: "#6366f1" },
  interest_only: { label: "Interest-Only Loans", color: "#10b981" },
  short_term:    { label: "Short-Term Loans",    color: "#f59e0b" },
  other:         { label: "Other",               color: "#8b5cf6" },
};

/* ── EMI type card ── */
function EmiCard({ data }) {
  const { total_principal, total_interest_earned, total_interest_at_completion,
          total_accrued, total_penalty, active, closed, count,
          interest_coverage_pct, performance_breakdown: pb } = data;
  const color = TYPE_META.emi.color;
  return (
    <div className="bg-white border border-indigo-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="font-semibold text-slate-800">EMI Loans</h3>
        <span className="ml-auto text-xs text-slate-400">{count} loan{count !== 1 ? "s" : ""} · {active} active · {closed} closed</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-slate-400 mb-0.5">Capital Deployed</p>
          <p className="font-bold text-slate-800 text-sm">{formatCurrency(total_principal)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-emerald-500 mb-0.5">Interest Paid So Far</p>
          <p className="font-bold text-emerald-700 text-sm">{formatCurrency(total_interest_earned)}</p>
        </div>
        <div className="bg-indigo-50 rounded-lg p-3">
          <p className="text-indigo-400 mb-0.5">Total Interest When Closed</p>
          <p className="font-bold text-indigo-700 text-sm">{total_interest_at_completion > 0 ? formatCurrency(total_interest_at_completion) : "—"}</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <p className="text-amber-500 mb-0.5">Penalty Collected</p>
          <p className="font-bold text-amber-700 text-sm">{total_penalty > 0 ? formatCurrency(total_penalty) : "₹0"}</p>
        </div>
      </div>
      {total_accrued > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>Collection vs Expected (today)</span>
            <span className={`font-semibold ${(interest_coverage_pct || 0) >= 85 ? "text-emerald-600" : "text-rose-600"}`}>
              {fmtPct(interest_coverage_pct)}
            </span>
          </div>
          <Bar pct={interest_coverage_pct} color={(interest_coverage_pct || 0) >= 100 ? "#10b981" : (interest_coverage_pct || 0) >= 85 ? "#f59e0b" : "#ef4444"} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {pb?.over > 0 && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{pb.over} over</span>}
        {pb?.on_track > 0 && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{pb.on_track} on track</span>}
        {pb?.under > 0 && <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{pb.under} under</span>}
        {pb?.open > 0 && <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{pb.open} open</span>}
      </div>
    </div>
  );
}

/* ── Interest-Only type card ── */
function InterestOnlyCard({ data }) {
  const { total_principal, total_interest_earned, total_interest_at_completion,
          total_accrued, total_penalty, active, closed, count,
          interest_coverage_pct, performance_breakdown: pb } = data;
  const color = TYPE_META.interest_only.color;
  return (
    <div className="bg-white border border-emerald-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="font-semibold text-slate-800">Interest-Only Loans</h3>
        <span className="ml-auto text-xs text-slate-400">{count} loan{count !== 1 ? "s" : ""} · {active} active · {closed} closed</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-slate-400 mb-0.5">Capital Deployed</p>
          <p className="font-bold text-slate-800 text-sm">{formatCurrency(total_principal)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-emerald-500 mb-0.5">Interest Earned</p>
          <p className="font-bold text-emerald-700 text-sm">{formatCurrency(total_interest_earned)}</p>
        </div>
        <div className="bg-teal-50 rounded-lg p-3">
          <p className="text-teal-500 mb-0.5">Expected Total (at term)</p>
          <p className="font-bold text-teal-700 text-sm">{total_interest_at_completion > 0 ? formatCurrency(total_interest_at_completion) : "—"}</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <p className="text-amber-500 mb-0.5">Penalty Collected</p>
          <p className="font-bold text-amber-700 text-sm">{total_penalty > 0 ? formatCurrency(total_penalty) : "₹0"}</p>
        </div>
      </div>
      {total_accrued > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>Paid vs Accrued (today)</span>
            <span className={`font-semibold ${(interest_coverage_pct || 0) >= 85 ? "text-emerald-600" : "text-rose-600"}`}>
              {fmtPct(interest_coverage_pct)}
            </span>
          </div>
          <Bar pct={interest_coverage_pct} color={(interest_coverage_pct || 0) >= 100 ? "#10b981" : (interest_coverage_pct || 0) >= 85 ? "#f59e0b" : "#ef4444"} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {pb?.over > 0 && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{pb.over} over</span>}
        {pb?.on_track > 0 && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{pb.on_track} on track</span>}
        {pb?.under > 0 && <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{pb.under} under</span>}
        {pb?.open > 0 && <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{pb.open} open</span>}
      </div>
    </div>
  );
}

/* ── Short-Term type card ── */
function ShortTermCard({ data }) {
  const { total_principal, total_principal_recovered, total_principal_outstanding,
          total_extra_collected, total_interest_earned, total_penalty,
          active, closed, count } = data;
  const color = TYPE_META.short_term.color;
  const recoveryPct = total_principal > 0 ? (total_principal_recovered / total_principal) * 100 : 0;
  return (
    <div className="bg-white border border-amber-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="font-semibold text-slate-800">Short-Term Loans</h3>
        <span className="ml-auto text-xs text-slate-400">{count} loan{count !== 1 ? "s" : ""} · {active} active · {closed} closed</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-slate-400 mb-0.5">Capital Deployed</p>
          <p className="font-bold text-slate-800 text-sm">{formatCurrency(total_principal)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-emerald-500 mb-0.5">Principal Recovered</p>
          <p className="font-bold text-emerald-700 text-sm">{formatCurrency(total_principal_recovered)}</p>
        </div>
        <div className="bg-rose-50 rounded-lg p-3">
          <p className="text-rose-500 mb-0.5">Still To Recover</p>
          <p className="font-bold text-rose-700 text-sm">{formatCurrency(total_principal_outstanding)}</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <p className="text-amber-500 mb-0.5">Extra Beyond Principal</p>
          <p className="font-bold text-amber-700 text-sm">{formatCurrency(total_extra_collected)}</p>
          {total_penalty > 0 && (
            <p className="text-[10px] text-amber-400 mt-0.5">incl. ₹{(total_penalty / 1000).toFixed(1)}K penalty</p>
          )}
        </div>
      </div>
      <div className="mb-2">
        <div className="flex justify-between text-[11px] text-slate-500 mb-1">
          <span>Principal Recovery</span>
          <span className={`font-semibold ${recoveryPct >= 80 ? "text-emerald-600" : "text-amber-600"}`}>
            {recoveryPct.toFixed(0)}%
          </span>
        </div>
        <Bar pct={recoveryPct} color={recoveryPct >= 80 ? "#10b981" : "#f59e0b"} />
      </div>
    </div>
  );
}

/* ── Chart Tooltip ── */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xl text-xs min-w-[160px]">
      <p className="font-semibold text-slate-700 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-slate-500">{p.name}</span>
          </div>
          <span className="font-semibold text-slate-800">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Performance badge ── */
function PerfBadge({ perf }) {
  const C = {
    over:     "bg-emerald-100 text-emerald-700",
    on_track: "bg-blue-100 text-blue-700",
    under:    "bg-rose-100 text-rose-700",
    open:     "bg-slate-100 text-slate-500",
  };
  const L = { over: "Over", on_track: "On Track", under: "Under", open: "Open" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${C[perf] || C.open}`}>
      {L[perf] || perf}
    </span>
  );
}

function StatusBadge({ status }) {
  const C = { active: "bg-green-100 text-green-700", closed: "bg-slate-100 text-slate-500", defaulted: "bg-red-100 text-red-700" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${C[status] || C.active}`}>
      {status}
    </span>
  );
}

/* ── Grouped loan table ── */
function LoanGroup({ ltype, loans }) {
  const meta = TYPE_META[ltype] || { label: ltype, color: "#8b5cf6" };
  const isShortTerm = ltype === "short_term";
  const isEmi = ltype === "emi";

  return (
    <div>
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 sticky top-0 z-10"
        style={{ backgroundColor: `${meta.color}18`, borderLeft: `3px solid ${meta.color}` }}
      >
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
        <span className="text-sm font-semibold text-slate-700">{meta.label}</span>
        <span className="text-xs text-slate-400">({loans.length})</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wide border-b border-slate-100 bg-slate-50/60">
            <th className="px-4 py-2 font-medium">Person</th>
            <th className="px-4 py-2 font-medium">Principal</th>
            <th className="px-4 py-2 font-medium">Rate</th>
            <th className="px-4 py-2 font-medium">Since</th>
            <th className="px-4 py-2 font-medium">Months</th>
            {isShortTerm ? (
              <>
                <th className="px-4 py-2 font-medium">Recovered</th>
                <th className="px-4 py-2 font-medium">Outstanding</th>
                <th className="px-4 py-2 font-medium">Extra Earned</th>
              </>
            ) : (
              <>
                <th className="px-4 py-2 font-medium">Earned</th>
                <th className="px-4 py-2 font-medium">{isEmi ? "Total (Lifetime)" : "Expected (Term)"}</th>
                <th className="px-4 py-2 font-medium">Yield % p.a.</th>
                <th className="px-4 py-2 font-medium">Perf.</th>
              </>
            )}
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {loans.map((loan) => (
            <tr key={loan.loan_id} className="hover:bg-slate-50/80 transition-colors">
              <td className="px-4 py-3">
                <span className="font-medium text-slate-800 text-xs">{loan.contact_name}</span>
              </td>
              <td className="px-4 py-3 text-xs tabular-nums font-medium text-slate-700">
                {formatCurrency(loan.principal)}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                {loan.interest_rate > 0 ? `${loan.interest_rate}%` : "—"}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {loan.disbursed_date
                  ? new Date(loan.disbursed_date).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
                  : "—"}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">{loan.months_active}</td>
              {isShortTerm ? (
                <>
                  <td className="px-4 py-3 text-xs font-semibold text-emerald-700 tabular-nums">
                    {formatCurrency(loan.principal_recovered)}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{
                    color: loan.principal_outstanding > 0 ? "#e11d48" : "#64748b"
                  }}>
                    {loan.principal_outstanding > 0 ? formatCurrency(loan.principal_outstanding) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-amber-700 tabular-nums">
                    {(loan.interest_earned + loan.penalty_collected) > 0
                      ? formatCurrency(loan.interest_earned + loan.penalty_collected)
                      : "—"}
                  </td>
                </>
              ) : (
                <>
                  <td className="px-4 py-3 text-xs font-semibold text-emerald-700 tabular-nums">
                    {formatCurrency(loan.interest_earned)}
                    {loan.penalty_collected > 0 && (
                      <span className="ml-1 text-amber-500">+{formatCurrency(loan.penalty_collected)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                    {loan.interest_at_completion > 0 ? formatCurrency(loan.interest_at_completion) : "—"}
                    {loan.interest_at_completion > 0 && loan.interest_earned > 0 && (
                      <span className={`ml-1 text-[10px] ${
                        loan.interest_earned >= loan.interest_at_completion * 0.95
                          ? "text-emerald-500"
                          : "text-slate-400"
                      }`}>
                        ({((loan.interest_earned / loan.interest_at_completion) * 100).toFixed(0)}%)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    <span className={`font-semibold ${
                      loan.yield_pa >= 12 ? "text-emerald-700"
                        : loan.yield_pa >= 6 ? "text-amber-700"
                        : loan.yield_pa > 0 ? "text-rose-600"
                        : "text-slate-400"
                    }`}>
                      {loan.yield_pa > 0 ? `${loan.yield_pa.toFixed(1)}%` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <PerfBadge perf={loan.performance} />
                  </td>
                </>
              )}
              <td className="px-4 py-3">
                <StatusBadge status={loan.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════ main page ═══════════════════════════════ */
export default function LoanAnalytics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["loanAnalytics"],
    queryFn: () => api.get("/api/analytics/loans-given").then((r) => r.data),
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (error) {
    return <div className="p-6 text-rose-600 text-sm">Failed to load loan analytics. Please try again.</div>;
  }

  const p = data?.portfolio || {};
  const byType = data?.by_type || {};
  const allLoans = data?.loans || [];
  const monthlyTrend = data?.monthly_trend || [];

  // Group loans: active first, then closed — within each group sorted by principal desc
  // Display order: EMI → Interest Only → Short Term → Other
  const TYPE_ORDER = ["emi", "interest_only", "short_term", "other"];
  const grouped = {};
  for (const loan of allLoans) {
    const t = loan.loan_type || "other";
    if (!grouped[t]) grouped[t] = { active: [], closed: [] };
    if (loan.status === "active") grouped[t].active.push(loan);
    else grouped[t].closed.push(loan);
  }

  const hasMonthly = monthlyTrend.some(
    (m) => m.interest_earned > 0 || m.penalty_collected > 0 || m.principal_recovered > 0
  );

  return (
    <div className="p-4 md:p-6 space-y-7 max-w-7xl mx-auto">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Loan Portfolio Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Loans given · {p.total_count || 0} total ({p.active_count || 0} active,{" "}
          {p.closed_count || 0} closed) · As of {data?.as_of_date}
        </p>
      </div>

      {/* ── Portfolio Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total Deployed"
          primary={formatCurrency(p.total_deployed)}
          secondary="Total principal given out"
          accent="indigo"
        />
        <StatCard
          label="Active Principal"
          primary={formatCurrency(p.active_principal)}
          secondary="Still owed by borrowers"
          accent="violet"
        />
        <StatCard
          label="Interest Earned"
          primary={formatCurrency(p.total_interest_earned)}
          secondaryLabel="Expected remaining"
          secondary={p.total_interest_expected_remaining > 0 ? formatCurrency(p.total_interest_expected_remaining) : "₹0"}
          accent="emerald"
        />
        <StatCard
          label="Penalty Collected"
          primary={formatCurrency(p.total_penalty_collected)}
          secondary="Late payment charges"
          accent="amber"
        />
        <StatCard
          label="Total Earnings"
          primary={formatCurrency(p.total_earnings)}
          secondary={`Interest + Penalty`}
          accent="cyan"
        />
        <StatCard
          label="Portfolio Yield"
          primary={`${(p.portfolio_yield_pa || 0).toFixed(1)}%`}
          secondary="p.a. (dollar-weighted)"
          accent="rose"
        />
      </div>

      {/* ── Type Cards ── */}
      {Object.keys(byType).length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">By Loan Type</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TYPE_ORDER.filter((t) => byType[t]).map((t) => {
              if (t === "emi")           return <EmiCard          key={t} data={byType[t]} />;
              if (t === "interest_only") return <InterestOnlyCard key={t} data={byType[t]} />;
              if (t === "short_term")    return <ShortTermCard    key={t} data={byType[t]} />;
              return null;
            })}
          </div>
        </div>
      )}

      {/* ── Monthly Earnings Line Chart ── */}
      {hasMonthly && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Monthly Earnings — Last 12 Months</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Interest collected, penalties, and principal returned each month
            </p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthlyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                angle={-30}
                textAnchor="end"
                height={45}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) =>
                  v >= 1e5 ? `${(v / 1e5).toFixed(1)}L`
                  : v >= 1000 ? `${(v / 1000).toFixed(0)}K`
                  : String(v)
                }
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Line
                type="monotone"
                dataKey="interest_earned"
                name="Interest Earned"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6366f1" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="penalty_collected"
                name="Penalty"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: "#f59e0b" }}
                activeDot={{ r: 5 }}
                strokeDasharray="4 2"
              />
              <Line
                type="monotone"
                dataKey="principal_recovered"
                name="Principal Recovered"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3, fill: "#10b981" }}
                activeDot={{ r: 5 }}
                strokeDasharray="6 3"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Per-Loan Table grouped by type ── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700">
            Individual Loan Performance
            <span className="ml-2 text-xs font-normal text-slate-400">({allLoans.length} loans · active first · closed at end)</span>
          </h2>
        </div>

        <div className="overflow-x-auto divide-y divide-slate-100">
          {TYPE_ORDER.filter((t) => grouped[t]).map((t) => {
            const g = grouped[t];
            const loans = [...g.active, ...g.closed];
            if (!loans.length) return null;
            return <LoanGroup key={t} ltype={t} loans={loans} />;
          })}
          {allLoans.length === 0 && (
            <div className="px-4 py-12 text-center text-slate-400 text-sm">
              No loans found.
            </div>
          )}
        </div>

        {/* Footer totals */}
        {allLoans.length > 0 && (() => {
          const totalPrincipal = allLoans.reduce((s, l) => s + l.principal, 0);
          const totalEarned = allLoans.reduce((s, l) => s + l.interest_earned, 0);
          const totalPenalty = allLoans.reduce((s, l) => s + l.penalty_collected, 0);
          const totalRecovered = allLoans.reduce((s, l) => s + l.principal_recovered, 0);
          return (
            <div className="flex flex-wrap items-center gap-5 px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
              <span>Principal: <strong className="text-slate-800">{formatCurrency(totalPrincipal)}</strong></span>
              <span>Interest Earned: <strong className="text-emerald-700">{formatCurrency(totalEarned)}</strong></span>
              {totalPenalty > 0 && <span>Penalties: <strong className="text-amber-700">{formatCurrency(totalPenalty)}</strong></span>}
              <span>Principal Recovered: <strong className="text-indigo-700">{formatCurrency(totalRecovered)}</strong></span>
            </div>
          );
        })()}
      </div>

      {/* Methodology note */}
      <p className="text-[11px] text-slate-400 text-center pb-2">
        Portfolio Yield uses Dollar-Weighted Return: Σ(interest) ÷ Σ(principal × years) — mathematically accurate for loans with different amounts, rates, and timings.
        "Over" = earned more than expected by today. Yield % p.a. = per-loan annualized return.
      </p>
    </div>
  );
}


/* ── micro UI ── */
function StatCard({ label, value, sub, accent = "indigo" }) {
  const colors = {
    indigo: "from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-700",
    emerald: "from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-700",
    amber: "from-amber-50 to-amber-100 border-amber-200 text-amber-700",
    rose: "from-rose-50 to-rose-100 border-rose-200 text-rose-700",
    violet: "from-violet-50 to-violet-100 border-violet-200 text-violet-700",
    cyan: "from-cyan-50 to-cyan-100 border-cyan-200 text-cyan-700",
  };
  return (
    <div className={`bg-gradient-to-br ${colors[accent]} border rounded-xl p-4`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-[11px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

function PerformanceBadge({ perf }) {
  const cfg = {
    over:     { cls: "bg-emerald-100 text-emerald-700", label: "Over" },
    on_track: { cls: "bg-blue-100 text-blue-700",       label: "On Track" },
    under:    { cls: "bg-rose-100 text-rose-700",       label: "Under" },
    open:     { cls: "bg-slate-100 text-slate-500",     label: "Open" },
  };
  const c = cfg[perf] || cfg.open;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.cls}`}>
      {c.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    active:   "bg-green-100 text-green-700",
    closed:   "bg-slate-100 text-slate-500",
    defaulted:"bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg[status] || cfg.active}`}>
      {status}
    </span>
  );
}

const TYPE_LABELS = {
  short_term:    "Short-Term",
  interest_only: "Interest Only",
  emi:           "EMI",
  other:         "Other",
};
const TYPE_COLORS = {
  short_term:    "#6366f1",
  interest_only: "#10b981",
  emi:           "#f59e0b",
  other:         "#8b5cf6",
};

function TypeCard({ data }) {
  if (!data) return null;
  const { loan_type, count, total_principal, total_interest_earned,
          total_expected_interest, interest_coverage_pct, total_penalty,
          active, closed, performance_breakdown } = data;
  const label = TYPE_LABELS[loan_type] || loan_type;
  const color = TYPE_COLORS[loan_type] || "#8b5cf6";
  const pb = performance_breakdown || {};
  const coverage = interest_coverage_pct;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="font-semibold text-slate-800 text-sm">{label}</h3>
        </div>
        <span className="text-xs text-slate-500">{count} loan{count !== 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-slate-500">Capital Deployed</p>
            <p className="font-semibold text-slate-800">{formatCurrency(total_principal)}</p>
          </div>
          <div>
            <p className="text-slate-500">Interest Earned</p>
            <p className="font-semibold text-emerald-700">{formatCurrency(total_interest_earned)}</p>
          </div>
          <div>
            <p className="text-slate-500">Expected Interest</p>
            <p className="font-semibold text-slate-700">{formatCurrency(total_expected_interest)}</p>
          </div>
          {total_penalty > 0 && (
            <div>
              <p className="text-slate-500">Penalty Collected</p>
              <p className="font-semibold text-amber-700">{formatCurrency(total_penalty)}</p>
            </div>
          )}
        </div>

        {coverage !== null && coverage !== undefined && (
          <div>
            <div className="flex justify-between text-[11px] text-slate-500 mb-1">
              <span>Actual vs Expected</span>
              <span className={coverage >= 85 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
                {coverage.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(coverage, 150)}%`,
                  backgroundColor: coverage >= 100 ? "#10b981" : coverage >= 85 ? "#f59e0b" : "#ef4444",
                }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 text-[11px]">
          {pb.over > 0 && <span className="text-emerald-700 font-medium">{pb.over} over</span>}
          {pb.on_track > 0 && <span className="text-blue-700 font-medium">{pb.on_track} on track</span>}
          {pb.under > 0 && <span className="text-rose-700 font-medium">{pb.under} under</span>}
          {pb.open > 0 && <span className="text-slate-500">{pb.open} open</span>}
          <span className="ml-auto text-slate-400">
            {active} active · {closed} closed
          </span>
        </div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-lg text-xs">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-600">{p.name}:</span>
          <span className="font-semibold text-slate-800">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ── main page ── */
export default function LoanAnalytics() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [perfFilter, setPerfFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["loanAnalytics"],
    queryFn: () => api.get("/api/analytics/loans-given").then((r) => r.data),
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-rose-600 text-sm">
        Failed to load loan analytics. Please try again.
      </div>
    );
  }

  const portfolio = data?.portfolio || {};
  const byType = data?.by_type || {};
  const loanList = data?.loans || [];
  const monthlyTrend = data?.monthly_trend || [];

  const loanTypes = [...new Set(loanList.map((l) => l.loan_type))];

  const filteredLoans = loanList.filter((l) => {
    if (typeFilter !== "all" && l.loan_type !== typeFilter) return false;
    if (perfFilter !== "all" && l.performance !== perfFilter) return false;
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    return true;
  });

  const hasMonthlyData = monthlyTrend.some((m) => m.total_collected > 0);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Loan Portfolio Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Loans you have given · {portfolio.total_count || 0} total ({portfolio.active_count || 0} active,{" "}
          {portfolio.closed_count || 0} closed) · As of {data?.as_of_date}
        </p>
      </div>

      {/* Portfolio Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total Deployed"
          value={formatCurrency(portfolio.total_deployed)}
          sub="Principal given out"
          accent="indigo"
        />
        <StatCard
          label="Active Capital"
          value={formatCurrency(portfolio.active_capital)}
          sub="Outstanding principal"
          accent="violet"
        />
        <StatCard
          label="Interest Earned"
          value={formatCurrency(portfolio.total_interest_earned)}
          sub="Across all loans"
          accent="emerald"
        />
        <StatCard
          label="Penalty Collected"
          value={formatCurrency(portfolio.total_penalty_collected)}
          sub="Late payment charges"
          accent="amber"
        />
        <StatCard
          label="Total Earnings"
          value={formatCurrency(portfolio.total_earnings)}
          sub="Interest + Penalties"
          accent="cyan"
        />
        <StatCard
          label="Portfolio Yield"
          value={`${(portfolio.portfolio_yield_pa || 0).toFixed(1)}%`}
          sub="Per annum (weighted)"
          accent="rose"
        />
      </div>

      {/* By-Type Breakdown */}
      {Object.keys(byType).length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">By Loan Type</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.values(byType).map((t) => (
              <TypeCard key={t.loan_type} data={t} />
            ))}
          </div>
        </div>
      )}

      {/* Monthly Earnings Trend */}
      {hasMonthlyData && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Monthly Earnings (Last 12 Months)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyTrend} barSize={14} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={45}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="interest_earned" name="Interest" fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="penalty_collected" name="Penalty" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="principal_recovered" name="Principal" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-Loan Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700 mr-auto">
            Individual Loan Performance
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({filteredLoans.length} of {loanList.length})
            </span>
          </h2>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="all">All Types</option>
            {loanTypes.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
            ))}
          </select>
          <select
            value={perfFilter}
            onChange={(e) => setPerfFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="all">All Performance</option>
            <option value="over">Over</option>
            <option value="on_track">On Track</option>
            <option value="under">Under</option>
            <option value="open">Open</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wide border-b border-slate-100">
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Principal</th>
                <th className="px-4 py-3 font-medium">Rate (p.a.)</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Months</th>
                <th className="px-4 py-3 font-medium">Earned</th>
                <th className="px-4 py-3 font-medium">Expected</th>
                <th className="px-4 py-3 font-medium">Yield % p.a.</th>
                <th className="px-4 py-3 font-medium">Performance</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredLoans.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400 text-sm">
                    No loans match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredLoans.map((loan) => {
                  const earnedVsExpected = loan.expected_interest > 0
                    ? (loan.interest_earned / loan.expected_interest) * 100
                    : null;
                  return (
                    <tr key={loan.loan_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: TYPE_COLORS[loan.loan_type] || "#8b5cf6" }}
                          />
                          <span className="text-slate-700 font-medium text-xs">
                            {TYPE_LABELS[loan.loan_type] || loan.loan_type}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-800 font-medium text-xs tabular-nums">
                        {formatCurrency(loan.principal)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs tabular-nums">
                        {loan.interest_rate > 0 ? `${loan.interest_rate}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {loan.disbursed_date
                          ? new Date(loan.disbursed_date).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs tabular-nums">
                        {loan.months_active}
                      </td>
                      <td className="px-4 py-3 text-emerald-700 font-semibold text-xs tabular-nums">
                        {formatCurrency(loan.interest_earned)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs tabular-nums">
                        {loan.expected_interest > 0 ? formatCurrency(loan.expected_interest) : "—"}
                        {earnedVsExpected !== null && (
                          <span className={`ml-1 text-[10px] ${
                            earnedVsExpected >= 100 ? "text-emerald-500" :
                            earnedVsExpected >= 85 ? "text-amber-500" : "text-rose-500"
                          }`}>
                            ({earnedVsExpected.toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        <span className={`font-semibold ${
                          loan.yield_pa >= 12 ? "text-emerald-700" :
                          loan.yield_pa >= 6 ? "text-amber-700" :
                          loan.yield_pa > 0 ? "text-rose-600" : "text-slate-400"
                        }`}>
                          {loan.yield_pa > 0 ? `${loan.yield_pa.toFixed(1)}%` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <PerformanceBadge perf={loan.performance} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={loan.status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Summary footer */}
        {filteredLoans.length > 0 && (
          <div className="flex items-center gap-6 px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
            <span>
              Total Principal:{" "}
              <strong className="text-slate-800">
                {formatCurrency(filteredLoans.reduce((s, l) => s + l.principal, 0))}
              </strong>
            </span>
            <span>
              Total Earned:{" "}
              <strong className="text-emerald-700">
                {formatCurrency(filteredLoans.reduce((s, l) => s + l.interest_earned, 0))}
              </strong>
            </span>
            {filteredLoans.some((l) => l.penalty_collected > 0) && (
              <span>
                Penalties:{" "}
                <strong className="text-amber-700">
                  {formatCurrency(filteredLoans.reduce((s, l) => s + l.penalty_collected, 0))}
                </strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Legend note */}
      <p className="text-[11px] text-slate-400 text-center pb-2">
        Performance compared to theoretical interest based on rate × time. "Over" means you collected more than expected.
        "Open" means interest is not yet assessable. Yield % is annualized actual return on principal.
      </p>
    </div>
  );
}
