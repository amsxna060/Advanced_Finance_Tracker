import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const TIER_META = {
  t1: { label: "T1 — Guaranteed", color: "#10b981", bg: "bg-emerald-50 border-emerald-200 text-emerald-800" },
  t2: { label: "T2 — High Prob", color: "#f59e0b", bg: "bg-amber-50 border-amber-200 text-amber-800" },
  t3: { label: "T3 — High Risk", color: "#ef4444", bg: "bg-red-50 border-red-200 text-red-800" },
};

const SOURCE_LABEL = {
  loan_emi: "EMI", loan_interest: "Interest", loan_principal: "Principal",
  obligation: "Obligation", property: "Property", beesi: "Beesi",
};

function tierBadge(tier) {
  const m = TIER_META[`t${tier}`] || TIER_META.t3;
  return <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${m.bg}`}>{m.label}</span>;
}

export default function Forecast() {
  const [horizon, setHorizon] = useState("30d");

  const { data, isLoading } = useQuery({
    queryKey: ["smart-forecast"],
    queryFn: async () => (await api.get("/api/analytics/smart-forecast")).data,
  });

  const hData = data?.horizons?.[horizon];
  const items = data?.items || [];
  const timeline = data?.timeline || [];

  // filter items by horizon
  const filteredItems = useMemo(() => {
    if (!data) return [];
    const days = parseInt(horizon);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const cutStr = cutoff.toISOString().split("T")[0];
    return items.filter((i) => !i.due_date || i.due_date <= cutStr);
  }, [items, horizon, data]);

  const inflows = filteredItems.filter((i) => i.direction === "inflow");
  const outflows = filteredItems.filter((i) => i.direction === "outflow");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  const { balances, liquidity_runway: lr } = data;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Forecast & Liquidity</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Smart cash-flow projection with probability tiers &middot; As of {data.as_of_date}
          </p>
        </div>

        {/* Liquidity Runway Banner */}
        <div className={`rounded-xl border p-5 ${lr.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Liquidity Status</p>
              <p className={`text-2xl font-extrabold mt-1 ${lr.ok ? "text-emerald-700" : "text-red-700"}`}>
                {lr.ok ? "Healthy" : "At Risk"}
              </p>
            </div>
            <div className="h-12 border-l border-slate-200 hidden sm:block" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 flex-1">
              <MiniStat label="Liquid Balance" value={formatCurrency(lr.liquid_balance)} />
              <MiniStat label="30-Day Guaranteed Outflow" value={formatCurrency(lr.guaranteed_30d_outflow)} />
              <MiniStat label="Coverage Ratio" value={`${lr.coverage_ratio}x`} />
              <MiniStat label="Runway" value={lr.runway_months >= 99 ? "∞" : `${lr.runway_months} mo`} />
            </div>
          </div>
          {/* Bar indicator */}
          <div className="mt-3">
            <div className="h-2.5 bg-white/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${lr.ok ? "bg-emerald-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(lr.coverage_ratio * 100 / 3, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>0x</span><span>1x</span><span>2x</span><span>3x+</span>
            </div>
          </div>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <BalanceCard label="Cash" value={balances.cash} icon="💵" color="emerald" />
          <BalanceCard label="Bank" value={balances.bank} icon="🏦" color="blue" />
          <BalanceCard label="Total Liquid" value={balances.total_liquid} icon="💰" color="indigo" />
          <BalanceCard label="Accounts" value={balances.accounts?.length || 0} icon="📋" color="slate" isCurrency={false} />
        </div>

        {/* Horizon Toggle */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Horizon:</span>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {["15d", "30d", "90d"].map((h) => (
              <button key={h} onClick={() => setHorizon(h)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  horizon === h ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}>
                {h.replace("d", " Days")}
              </button>
            ))}
          </div>
          {hData && (
            <div className="ml-auto flex items-center gap-6 text-sm">
              <span className="text-emerald-700 font-semibold">↑ {formatCurrency(hData.total_inflow)}</span>
              <span className="text-red-600 font-semibold">↓ {formatCurrency(hData.total_outflow)}</span>
              <span className={`font-bold ${hData.net_flow >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                Net: {formatCurrency(hData.net_flow)}
              </span>
            </div>
          )}
        </div>

        {/* Tier Breakdown */}
        {hData && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <TierCard title="Inflows" tiers={hData.inflow_by_tier} sources={hData.inflow_by_source} modes={hData.inflow_by_mode} isIn />
            <TierCard title="Outflows" tiers={hData.outflow_by_tier} sources={hData.outflow_by_source} modes={hData.outflow_by_mode} />
          </div>
        )}

        {/* Timeline Chart */}
        {timeline.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
              90-Day Running Balance
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="day_label" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip content={<TimelineTooltip />} />
                  <Area type="monotone" dataKey="running_balance" stroke="#6366f1" strokeWidth={2}
                    fill="url(#balGrad)" name="Balance" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Daily Flow Bar Chart */}
        {timeline.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
              Daily Cash Flow
            </h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeline.filter((t) => t.inflow > 0 || t.outflow > 0)}
                  margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="day_label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip formatter={(v) => formatCurrency(v)}
                    contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: "13px" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="inflow" fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow" />
                  <Bar dataKey="outflow" fill="#ef4444" radius={[4, 4, 0, 0]} name="Outflow" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Items List */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Forecast Items ({filteredItems.length})
            </h2>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="text-emerald-600 font-medium">{inflows.length} inflows</span>
              <span className="text-red-600 font-medium">{outflows.length} outflows</span>
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">No forecast items</div>
            ) : (
              filteredItems.map((item, i) => (
                <div key={i} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 ${
                  item.is_overdue ? "bg-red-50/50" : ""
                }`}>
                  <div className={`w-1.5 h-8 rounded-full shrink-0 ${
                    item.direction === "inflow" ? "bg-emerald-400" : "bg-red-400"
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {tierBadge(item.tier)}
                      <span className="text-xs font-medium text-slate-700 truncate">
                        {item.contact || item.sub_source || item.source}
                      </span>
                      {item.is_overdue && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded border bg-red-50 border-red-200 text-red-700">overdue</span>
                      )}
                      <span className="text-[10px] text-slate-400 capitalize">{SOURCE_LABEL[item.source] || item.source}</span>
                      {item.mode && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          item.mode === "cash" ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"
                        }`}>{item.mode}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold ${item.direction === "inflow" ? "text-emerald-700" : "text-red-700"}`}>
                      {item.direction === "inflow" ? "+" : "−"}{formatCurrency(item.amount)}
                    </p>
                    {item.due_date && (
                      <p className="text-[10px] text-slate-400 font-mono">{item.due_date}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub Components ────────────────────────────────────────────────── */

function TimelineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-lg text-xs">
      <p className="font-semibold text-slate-700 mb-1">{d.day_label}</p>
      {d.inflow > 0 && <p className="text-emerald-600">↑ Inflow: {formatCurrency(d.inflow)}</p>}
      {d.outflow > 0 && <p className="text-red-600">↓ Outflow: {formatCurrency(d.outflow)}</p>}
      <p className="text-indigo-600 font-semibold mt-1">Balance: {formatCurrency(d.running_balance)}</p>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-base font-bold text-slate-900 mt-0.5">{value}</p>
    </div>
  );
}

function BalanceCard({ label, value, icon, color, isCurrency = true }) {
  const colors = {
    emerald: "bg-emerald-50 border-emerald-200",
    blue: "bg-blue-50 border-blue-200",
    indigo: "bg-indigo-50 border-indigo-200",
    slate: "bg-slate-50 border-slate-200",
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.slate}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-slate-500 font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-slate-900 mt-2">
        {isCurrency ? formatCurrency(value) : value}
      </p>
    </div>
  );
}

function TierCard({ title, tiers, sources, modes, isIn }) {
  const total = (tiers?.t1 || 0) + (tiers?.t2 || 0) + (tiers?.t3 || 0);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">
        {title} — {formatCurrency(total)}
      </h3>
      <div className="space-y-2 mb-4">
        {Object.entries(TIER_META).map(([key, meta]) => {
          const val = tiers?.[key] || 0;
          const pct = total > 0 ? (val / total * 100) : 0;
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs w-28 text-slate-600">{meta.label}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
              </div>
              <span className="text-xs font-semibold text-slate-800 w-24 text-right">{formatCurrency(val)}</span>
            </div>
          );
        })}
      </div>
      {/* By source */}
      {sources?.length > 0 && (
        <div className="border-t border-slate-100 pt-3 space-y-1">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">By Source</p>
          {sources.map((s) => (
            <div key={s.source} className="flex justify-between text-xs">
              <span className="text-slate-600 capitalize">{SOURCE_LABEL[s.source] || s.source}</span>
              <span className="font-medium text-slate-800">{formatCurrency(s.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {/* By mode */}
      {modes && Object.keys(modes).length > 0 && (
        <div className="border-t border-slate-100 pt-3 mt-3 flex gap-4">
          {Object.entries(modes).map(([mode, amt]) => (
            <div key={mode} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              mode === "cash" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"
            }`}>
              {mode}: {formatCurrency(amt)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
