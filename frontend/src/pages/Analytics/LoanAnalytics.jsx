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
function StatCard({ label, primary, secondary, secondaryLabel, accent = "indigo", wide = false, onClick }) {
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
    <div
      className={`${A.bg} border rounded-xl p-4 ${wide ? "col-span-2" : ""} ${onClick ? "cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all duration-150 active:scale-100" : ""}`}
      onClick={onClick}
      title={onClick ? "Click to see calculation" : undefined}
    >
      <p className={`text-[11px] font-medium uppercase tracking-wide ${A.sub} mb-1`}>{label}</p>
      <p className={`text-xl font-bold ${A.txt} leading-tight`}>{primary}</p>
      {secondary != null && (
        <p className={`text-[11px] mt-1 ${A.sub}`}>
          {secondaryLabel && <span className="font-medium">{secondaryLabel}: </span>}
          {secondary}
        </p>
      )}
      {onClick && <p className={`text-[9px] mt-1.5 ${A.sub} opacity-60`}>tap to see calc ↗</p>}
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

/* ── clickable type stat box ── */
function TypeStat({ bg, labelCls, label, valCls, value, onClick }) {
  return (
    <div
      className={`${bg} rounded-lg p-3 ${onClick ? "cursor-pointer hover:brightness-95 active:brightness-90 transition-all" : ""}`}
      onClick={onClick}
      title={onClick ? "Click to see breakdown" : undefined}
    >
      <p className={`${labelCls} mb-0.5 flex items-center justify-between`}>
        <span>{label}</span>
        {onClick && <span className="text-[9px] opacity-50">↗</span>}
      </p>
      <p className={`font-bold ${valCls} text-sm`}>{value}</p>
    </div>
  );
}

/* ── EMI type card ── */
function EmiCard({ data, onCalcClick }) {
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
        <TypeStat bg="bg-slate-50" labelCls="text-slate-400" label="Capital Deployed" valCls="text-slate-800" value={formatCurrency(total_principal)} onClick={() => onCalcClick("emi_principal")} />
        <TypeStat bg="bg-emerald-50" labelCls="text-emerald-500" label="Interest Paid So Far" valCls="text-emerald-700" value={formatCurrency(total_interest_earned)} onClick={() => onCalcClick("emi_interest")} />
        <TypeStat bg="bg-indigo-50" labelCls="text-indigo-400" label="Total Interest When Closed" valCls="text-indigo-700" value={total_interest_at_completion > 0 ? formatCurrency(total_interest_at_completion) : "—"} onClick={() => onCalcClick("emi_at_completion")} />
        <TypeStat bg="bg-amber-50" labelCls="text-amber-500" label="Penalty Collected" valCls="text-amber-700" value={total_penalty > 0 ? formatCurrency(total_penalty) : "₹0"} onClick={total_penalty > 0 ? () => onCalcClick("emi_penalty") : undefined} />
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
function InterestOnlyCard({ data, onCalcClick }) {
  const { total_principal, total_active_original_principal,
          total_interest_earned, total_interest_outstanding,
          total_capitalized_interest, total_interest_pending,
          total_interest_at_completion,
          total_accrued, total_penalty, active, closed, count,
          interest_coverage_pct, performance_breakdown: pb } = data;
  const color = TYPE_META.interest_only.color;

  // Capital Deployed = sum of original principal for ACTIVE loans only
  const activeDeployed = total_active_original_principal || 0;
  // Interest Collected = actual payments received as interest
  const ioPaid = total_interest_earned || 0;
  // Interest Pending = currently outstanding + interest capitalized into principal
  const ioPending = total_interest_pending || total_interest_outstanding || 0;
  const ioCapitalized = total_capitalized_interest || 0;
  const ioCurrentOutstanding = total_interest_outstanding || 0;
  const ioTotal = ioPaid + ioPending;
  const ioPaidPct = ioTotal > 0 ? (ioPaid / ioTotal) * 100 : 0;

  return (
    <div className="bg-white border border-emerald-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="font-semibold text-slate-800">Interest-Only Loans</h3>
        <span className="ml-auto text-xs text-slate-400">{count} loan{count !== 1 ? "s" : ""} · {active} active · {closed} closed</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <TypeStat bg="bg-slate-50" labelCls="text-slate-400" label="Active Capital Deployed" valCls="text-slate-800" value={formatCurrency(activeDeployed)} onClick={() => onCalcClick("io_principal")} />
        <TypeStat bg="bg-emerald-50" labelCls="text-emerald-500" label="Interest Collected" valCls="text-emerald-700" value={formatCurrency(ioPaid)} onClick={() => onCalcClick("io_collected")} />
        <TypeStat bg="bg-rose-50" labelCls="text-rose-500" label="Interest Pending" valCls="text-rose-700" value={ioPending > 0 ? formatCurrency(ioPending) : "₹0"} onClick={ioPending > 0 ? () => onCalcClick("io_pending") : undefined} />
        <TypeStat bg="bg-teal-50" labelCls="text-teal-500" label="Expected Total (at term)" valCls="text-teal-700" value={total_interest_at_completion > 0 ? formatCurrency(total_interest_at_completion) : "—"} onClick={total_interest_at_completion > 0 ? () => onCalcClick("io_at_completion") : undefined} />
      </div>
      {ioCapitalized > 0 && (
        <div className="mb-2 flex gap-1.5 text-[10px]">
          <span className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">
            {formatCurrency(ioCurrentOutstanding)} accrued outstanding
          </span>
          <span className="bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">
            + {formatCurrency(ioCapitalized)} capitalized into principal
          </span>
        </div>
      )}
      {ioTotal > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>Interest Collected vs Pending</span>
            <span className={`font-semibold ${ioPaidPct >= 85 ? "text-emerald-600" : "text-amber-600"}`}>
              {ioPaidPct.toFixed(0)}% collected
            </span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-emerald-400 transition-all duration-700"
              style={{ width: `${ioPaidPct}%` }}
            />
            {ioPending > 0 && (
              <div
                className="h-full bg-amber-300 transition-all duration-700"
                style={{ width: `${100 - ioPaidPct}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-[10px] mt-1">
            <span className="text-emerald-500">Paid: {formatCurrency(ioPaid)}</span>
            <span className="text-amber-500">Pending: {formatCurrency(ioPending)}</span>
          </div>
        </div>
      )}
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
      {total_penalty > 0 && (
        <p className="text-[11px] text-amber-500 mb-3">+ {formatCurrency(total_penalty)} penalty collected</p>
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
function ShortTermCard({ data, onCalcClick }) {
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
        <TypeStat bg="bg-slate-50" labelCls="text-slate-400" label="Capital Deployed" valCls="text-slate-800" value={formatCurrency(total_principal)} onClick={() => onCalcClick("st_principal")} />
        <TypeStat bg="bg-emerald-50" labelCls="text-emerald-500" label="Principal Recovered" valCls="text-emerald-700" value={formatCurrency(total_principal_recovered)} onClick={() => onCalcClick("st_recovered")} />
        <TypeStat bg="bg-rose-50" labelCls="text-rose-500" label="Still To Recover" valCls="text-rose-700" value={formatCurrency(total_principal_outstanding)} onClick={() => onCalcClick("st_outstanding")} />
        <TypeStat bg="bg-amber-50" labelCls="text-amber-500" label="Extra Beyond Principal" valCls="text-amber-700"
          value={<>{formatCurrency(total_extra_collected)}{total_penalty > 0 && <span className="block text-[10px] text-amber-400 mt-0.5">incl. ₹{(total_penalty / 1000).toFixed(1)}K penalty</span>}</>}
          onClick={() => onCalcClick("st_extra")}
        />
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

/* ── Calc Debug Modal ── */
function CalcModal({ data, onClose }) {
  if (!data) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 text-lg leading-none"
          onClick={onClose}
        >✕</button>
        <h3 className="font-bold text-slate-800 mb-0.5 text-sm">{data.title}</h3>
        {data.subtitle && <p className="text-[11px] text-slate-400 mb-4">{data.subtitle}</p>}
        <div className="space-y-0.5">
          {data.rows.map((row, i) => (
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
          ))}
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
  const [calcModal, setCalcModal] = useState(null);

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

  // ── Calc modal builder ───────────────────────────────────────────────────
  const fmt = formatCurrency;
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
      // ── EMI type breakdown ──
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
      // ── IO type breakdown ──
      case "io_principal": {
        const ioType = byType?.interest_only || {};
        const loans = loansByType("interest_only").filter((l) => l.status === "active");
        const rows = loans.map((l) => ({ label: l.contact_name, value: fmt(l.principal) }));
        rows.push({ divider: true });
        rows.push({ label: "Active Capital Deployed (original)", value: fmt(ioType.total_active_original_principal||0), highlight: true, bold: true });
        rows.push({ label: "All Loans Total (incl. closed)", value: fmt(ioType.total_principal||0) });
        return { title: "IO — Active Capital Deployed", subtitle: "Sum of original disbursed principals for active IO loans only (excludes closed loans)", rows };
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
      // ── Short-Term type breakdown ──
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
        const loans = loansByType("short_term").filter((l) => l.principal_outstanding > 0);
        const rows = loans.map((l) => ({ label: `${l.contact_name} (${l.status})`, value: fmt(l.principal_outstanding), highlight: "rose" }));
        rows.push({ divider: true });
        rows.push({ label: "Total Outstanding", value: fmt(byType?.short_term?.total_principal_outstanding||0), highlight: "rose", bold: true });
        return { title: "Short-Term — Still To Recover", subtitle: "Computed outstanding principal per active loan", rows };
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
      // ── Monthly chart click ──
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
      {calcModal && <CalcModal data={calcModal} onClose={() => setCalcModal(null)} />}

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Loan Portfolio Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Loans given · {p.total_count || 0} total ({p.active_count || 0} active,{" "}
          {p.closed_count || 0} closed) · As of {data?.as_of_date}
          <span className="ml-2 text-indigo-400 text-[11px]">· click any card or chart to see calculation</span>
        </p>
      </div>

      {/* ── Portfolio Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Deployed" primary={fmt(p.total_deployed)} secondary="Total principal given out" accent="indigo" onClick={() => openCalc("total_deployed")} />
        <StatCard label="Active Principal" primary={fmt(p.active_principal)} secondary="Still owed by borrowers" accent="violet" onClick={() => openCalc("active_principal")} />
        <StatCard label="Interest Earned" primary={fmt(p.total_interest_earned)} secondaryLabel="Expected remaining" secondary={p.total_interest_expected_remaining > 0 ? fmt(p.total_interest_expected_remaining) : "₹0"} accent="emerald" onClick={() => openCalc("interest_earned")} />
        <StatCard label="Penalty Collected" primary={fmt(p.total_penalty_collected)} secondary="Late payment charges" accent="amber" onClick={() => openCalc("penalty")} />
        <StatCard label="Total Earnings" primary={fmt(p.total_earnings)} secondary="Interest + Penalty" accent="cyan" onClick={() => openCalc("total_earnings")} />
        <StatCard label="Portfolio Yield" primary={`${(p.portfolio_yield_pa || 0).toFixed(1)}%`} secondary="p.a. (dollar-weighted)" accent="rose" onClick={() => openCalc("portfolio_yield")} />
      </div>

      {/* ── Type Cards ── */}
      {Object.keys(byType).length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">By Loan Type</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TYPE_ORDER.filter((t) => byType[t]).map((t) => {
              if (t === "emi")           return <EmiCard          key={t} data={byType[t]} onCalcClick={(k) => openCalc(k)} />;
              if (t === "interest_only") return <InterestOnlyCard key={t} data={byType[t]} onCalcClick={(k) => openCalc(k)} />;
              if (t === "short_term")    return <ShortTermCard    key={t} data={byType[t]} onCalcClick={(k) => openCalc(k)} />;
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
          <p className="text-[10px] text-slate-400 mb-2">Click any data point to see monthly breakdown</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart
              data={monthlyTrend}
              margin={{ top: 5, right: 10, left: 0, bottom: 20 }}
              onClick={(e) => { if (e?.activePayload?.[0]) openCalc("monthly", e.activePayload[0].payload); }}
              style={{ cursor: "pointer" }}
            >
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
