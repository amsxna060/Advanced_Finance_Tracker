/**
 * Forecast & Liquidity — Enterprise Edition
 *
 * Features:
 *  - Sandbox "Mark paid/received": local simulation only, no DB mutation
 *  - Principal shown per individual item row (not just group header)
 *  - Loading overlay + disabled controls while fetching new timeframe
 *  - Account multi-select: Starting Balance + item filtering per account
 *  - Smart defaults: low-priority loan items start unchecked
 *  - Settle Principal shortcut on loan items
 *  - RECURRING badge on injected recurring items
 *  - Manage Recurring Transactions modal (CRUD)
 *  - True liquidity: Starting Balance + Projected Inflows − Required Outflows
 *  - Persisted per-item overrides scoped to calendar month (auto-rollover)
 *  - Optimistic cache patching (no full refetch on checkbox click)
 */
import { useMemo, useState, useCallback, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const PRESETS = [
  { key: "15d", label: "15 Days" },
  { key: "30d", label: "30 Days" },
  { key: "60d", label: "60 Days" },
  { key: "90d", label: "90 Days" },
];

const KIND_LABEL = {
  loan_emi: "EMI",
  loan_interest: "Interest",
  loan_principal: "Principal",
  obligation: "Obligation",
  beesi: "Beesi",
  recurring: "Recurring",
};

const CONFIDENCE_STYLE = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-rose-50 text-rose-700 border-rose-200",
};

const PRIORITY_STYLE = {
  high: "bg-violet-50 text-violet-700 border-violet-200",
  medium: "bg-slate-50 text-slate-600 border-slate-200",
  low: "bg-orange-50 text-orange-600 border-orange-200",
};

/* ── Param builder ─────────────────────────────────────────── */
function buildParams(mode, preset, days, fromDate, toDate) {
  if (mode === "preset") return { timeframe: preset };
  if (mode === "days") return { days };
  if (mode === "monthEnd") return { to_month_end: true };
  if (mode === "range" && fromDate && toDate) return { from_date: fromDate, to_date: toDate };
  return { timeframe: "30d" };
}

function serializeParams(params, accountIds) {
  const parts = [];
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") parts.push(`${k}=${v}`);
  });
  (accountIds || []).forEach((id) => parts.push(`account_ids=${id}`));
  return parts.join("&");
}

/* ── Smart default: low-priority loan items default to excluded ── */
function isItemIncluded(item) {
  const ov = item.override;
  if (ov) {
    if (ov.status === "fulfilled" || ov.status === "skipped") return false;
    if (ov.included === false) return false;
    return true;
  }
  return item.loan_priority !== "low";
}

/* ── Cache patching helpers ─────────────────────────────────────── */
const sumBy = (arr, k) => arr.reduce((s, g) => s + (g[k] || 0), 0);

/**
 * Recompute group-level totals from its items.
 * simulatedPaid items are counted as skipped so the group expected_total
 * and scorecard both reflect the sandbox state.
 */
function recomputeGroup(g, simulatedPaid) {
  let calc = 0, expected = 0, fulfilled = 0, skipped = 0;
  let hasOverdue = false;
  for (const it of g.items) {
    calc += it.effective_amount;
    if (it.is_overdue) hasOverdue = true;
    if (simulatedPaid.has(it.id)) {
      skipped += it.effective_amount;
      continue;
    }
    const ov = it.override;
    if (ov?.status === "fulfilled") fulfilled += it.effective_amount;
    else if (!isItemIncluded(it)) skipped += it.effective_amount;
    else expected += it.effective_amount;
  }
  return {
    ...g,
    calculated_total: calc,
    expected_total: expected,
    fulfilled_total: fulfilled,
    skipped_total: skipped,
    has_overdue: hasOverdue,
  };
}

function recomputeForecast(data, simulatedPaid) {
  const sp = simulatedPaid || new Set();
  const inflow_groups = data.inflow_groups.map((g) => recomputeGroup(g, sp));
  const outflow_groups = data.outflow_groups.map((g) => recomputeGroup(g, sp));
  const expected_inflow = sumBy(inflow_groups, "expected_total");
  const required_outflow = sumBy(outflow_groups, "expected_total");
  const starting = data.balances?.total_liquid ?? 0;
  return {
    ...data,
    inflow_groups,
    outflow_groups,
    totals: {
      ...data.totals,
      expected_inflow,
      fulfilled_inflow: sumBy(inflow_groups, "fulfilled_total"),
      required_outflow,
      fulfilled_outflow: sumBy(outflow_groups, "fulfilled_total"),
      net_liquidity: expected_inflow - required_outflow,
      projected_ending_liquidity: starting + expected_inflow - required_outflow,
    },
  };
}

function patchItem(data, itemId, mutator) {
  let touched = false;
  const patchItems = (items) =>
    items.map((it) => { if (it.id !== itemId) return it; touched = true; return mutator(it); });
  const patchGroup = (g) => {
    const newItems = patchItems(g.items);
    return newItems === g.items ? g : { ...g, items: newItems };
  };
  const next = {
    ...data,
    inflow_groups: data.inflow_groups.map(patchGroup),
    outflow_groups: data.outflow_groups.map(patchGroup),
  };
  // Pass empty set here — simulatedPaid is applied in the outer useMemo
  return touched ? recomputeForecast(next, new Set()) : data;
}

function applyOverrideMutator(action, body) {
  return (it) => {
    if (action === "clear") {
      return { ...it, override: null, effective_amount: it.amount };
    }
    const prev = it.override || { included: true, status: "pending" };
    let nextOv = { ...prev };
    if (body.included !== undefined) {
      nextOv.included = body.included;
      if (body.included === false && nextOv.status !== "fulfilled") nextOv.status = "skipped";
      else if (body.included === true && nextOv.status === "skipped") nextOv.status = "pending";
    }
    if (body.amount_override !== undefined) nextOv.amount_override = parseFloat(body.amount_override);
    if (body.notes !== undefined) nextOv.notes = body.notes;
    const eff =
      nextOv.amount_override != null && !Number.isNaN(nextOv.amount_override)
        ? nextOv.amount_override
        : it.amount;
    return { ...it, override: nextOv, effective_amount: eff };
  };
}

/* ── Page ──────────────────────────────────────────────────── */
export default function Forecast() {
  const qc = useQueryClient();

  // Timeframe state
  const [mode, setMode] = useState("preset");
  const [preset, setPreset] = useState("30d");
  const [customDays, setCustomDays] = useState(35);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Account filter state
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);

  // Sandbox "simulated paid" state — purely local, never written to DB
  const [simulatedPaid, setSimulatedPaid] = useState(() => new Set());

  // Recurring modal state
  const [showManageRecurring, setShowManageRecurring] = useState(false);

  const params = buildParams(mode, preset, customDays, fromDate, toDate);
  const queryKey = useMemo(
    () => ["forecast", params, selectedAccountIds],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(params), JSON.stringify(selectedAccountIds)],
  );

  const { data: rawData, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const qs = serializeParams(params, selectedAccountIds);
      return (await api.get(`/api/forecast?${qs}`)).data;
    },
    placeholderData: (prev) => prev,
  });

  // Apply smart defaults + sandbox state as a local transform — no extra network call
  const data = useMemo(
    () => (rawData ? recomputeForecast(rawData, simulatedPaid) : null),
    [rawData, simulatedPaid],
  );

  // Toggle sandbox paid for one item; clear when timeframe changes
  const toggleSimulated = useCallback((id) => {
    setSimulatedPaid((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Reset simulation when the user fetches a fresh window
  const handleTimeframeChange = useCallback((changeFn) => {
    setSimulatedPaid(new Set());
    changeFn();
  }, []);

  const makeMutation = (path, action) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useMutation({
      mutationFn: (body) => api.post(path, body),
      onMutate: async (body) => {
        await qc.cancelQueries({ queryKey });
        const prev = qc.getQueryData(queryKey);
        if (prev) {
          qc.setQueryData(queryKey, patchItem(prev, body.item_id, applyOverrideMutator(action, body)));
        }
        return { prev };
      },
      onError: (_err, _body, ctx) => {
        if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      },
    });

  const upsertMutation = makeMutation("/api/forecast/overrides", "upsert");
  const clearMutation  = makeMutation("/api/forecast/overrides/clear", "clear");

  const onUpsert = useCallback((body) => upsertMutation.mutate(body), [upsertMutation]);
  const onClear  = useCallback((body) => clearMutation.mutate(body),  [clearMutation]);

  const toggleAccount = useCallback((id) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const t  = data.totals;
  const lr = data.liquidity;
  const accounts = data.balances?.accounts || [];
  const hasSandbox = simulatedPaid.size > 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* ── Sticky scorecard ──────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-slate-50/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-baseline justify-between mb-2">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Forecast & Liquidity</h1>
              {hasSandbox && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 font-medium">
                  SIMULATION — {simulatedPaid.size} item{simulatedPaid.size !== 1 ? "s" : ""} marked paid
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              As of {data.as_of_date} · period {data.period_key}
              {isFetching ? " · refreshing…" : ""}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Score
              label="Projected Inflows"
              value={t.expected_inflow}
              sub={hasSandbox ? "sandbox adjusted" : (t.fulfilled_inflow > 0 ? `${formatCurrency(t.fulfilled_inflow)} already in` : null)}
              tone="emerald"
              simulated={hasSandbox}
            />
            <Score
              label="Required Outflows"
              value={t.required_outflow}
              sub={hasSandbox ? "sandbox adjusted" : (t.overdue_outflow > 0 ? `${formatCurrency(t.overdue_outflow)} overdue` : null)}
              tone="rose"
              simulated={hasSandbox}
            />
            <Score
              label="Proj. Ending Liquidity"
              value={t.projected_ending_liquidity ?? t.net_liquidity}
              sub={
                hasSandbox
                  ? "sandbox scenario"
                  : (lr.coverage_ratio < 999 ? `Coverage ${lr.coverage_ratio}× · runway ${lr.runway_days}d` : "No outflows")
              }
              tone={(t.projected_ending_liquidity ?? t.net_liquidity) >= 0 ? "indigo" : "rose"}
              simulated={hasSandbox}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5 space-y-5">
        {/* ── Account selector ─────────────────────────────── */}
        {accounts.length > 0 && (
          <AccountSelector
            accounts={accounts}
            selectedIds={selectedAccountIds}
            onToggle={toggleAccount}
            onReset={() => setSelectedAccountIds([])}
          />
        )}

        {/* ── Timeframe picker ──────────────────────────── */}
        <TimeframePicker
          mode={mode} setMode={setMode}
          preset={preset} setPreset={setPreset}
          customDays={customDays} setCustomDays={setCustomDays}
          fromDate={fromDate} setFromDate={setFromDate}
          toDate={toDate} setToDate={setToDate}
          window={{ from: data.from_date, to: data.to_date, days: data.timeframe_days }}
          onManageRecurring={() => setShowManageRecurring(true)}
          isFetching={isFetching}
          onTimeframeChange={handleTimeframeChange}
        />

        {/* ── Liquid balance summary ──────────────────── */}
        <LiquidityBanner balances={data.balances} liquidity={lr} />

        {/* ── Two-column flows (with loading overlay) ──── */}
        <div className="relative">
          {/* Overlay while fetching a new timeframe (not initial load) */}
          {isFetching && (
            <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[2px] rounded-xl flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-2 shadow-sm">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
                <span className="text-xs font-medium text-slate-600">Updating forecast…</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ColumnSection
              title="Money Coming In"
              tone="emerald"
              groups={data.inflow_groups}
              onUpsert={onUpsert}
              onClear={onClear}
              simulatedPaid={simulatedPaid}
              onSimulatePaid={toggleSimulated}
            />
            <ColumnSection
              title="Money Going Out"
              tone="rose"
              groups={data.outflow_groups}
              onUpsert={onUpsert}
              onClear={onClear}
              simulatedPaid={simulatedPaid}
              onSimulatePaid={toggleSimulated}
            />
          </div>
        </div>

        {/* ── Sandbox reset hint ─────────────────────────── */}
        {hasSandbox && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            <p className="text-xs text-amber-700">
              <span className="font-semibold">Simulation mode</span> — {simulatedPaid.size} item{simulatedPaid.size !== 1 ? "s" : ""} virtually marked as settled. Totals reflect the adjusted scenario.
            </p>
            <button
              onClick={() => setSimulatedPaid(new Set())}
              className="text-xs px-3 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 transition"
            >
              Clear simulation
            </button>
          </div>
        )}

        {/* ── Charts ─────────────────────────────────── */}
        {data.timeline?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
              Running Balance ({data.timeframe_days} days)
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeline} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="day_label" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v) =>
                      v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
                    }
                  />
                  <Tooltip content={<TimelineTooltip />} />
                  <Area type="monotone" dataKey="running_balance" stroke="#6366f1" strokeWidth={2} fill="url(#balGrad)" name="Balance" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {data.timeline?.some((d) => d.inflow > 0 || d.outflow > 0) && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">
              Daily Cash Flow
            </h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.timeline.filter((d) => d.inflow > 0 || d.outflow > 0)}
                  margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="day_label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v) =>
                      v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
                    }
                  />
                  <Tooltip
                    formatter={(v) => formatCurrency(v)}
                    contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: "13px" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="inflow"  fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow" />
                  <Bar dataKey="outflow" fill="#ef4444" radius={[4, 4, 0, 0]} name="Outflow" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* ── Manage Recurring modal ──────────────────────── */}
      {showManageRecurring && (
        <ManageRecurringModal
          accounts={accounts}
          onClose={() => setShowManageRecurring(false)}
        />
      )}
    </div>
  );
}

/* ── Score Tile ────────────────────────────────────────────── */
function Score({ label, value, sub, tone, simulated }) {
  const tones = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    rose:    "bg-rose-50 border-rose-200 text-rose-800",
    indigo:  "bg-indigo-50 border-indigo-200 text-indigo-800",
  };
  return (
    <div className={`rounded-lg border p-3 transition-all ${tones[tone] || tones.indigo} ${simulated ? "ring-1 ring-amber-300" : ""}`}>
      <p className="text-[10px] uppercase tracking-wider font-medium opacity-70">{label}</p>
      <p className="text-xl font-extrabold mt-0.5">{formatCurrency(value)}</p>
      {sub && <p className="text-[10px] mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

/* ── Account Selector ──────────────────────────────────────── */
function AccountSelector({ accounts, selectedIds, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  const allSelected = selectedIds.length === 0;
  const label = allSelected ? "All Accounts" : `${selectedIds.length} account${selectedIds.length > 1 ? "s" : ""} selected`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-slate-600">Account filter:</span>
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center gap-2 transition ${
              open ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            {label}
            <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
          </button>

          {open && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-2 min-w-56">
              <button
                onClick={() => { onReset(); setOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs mb-1 transition ${
                  allSelected ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                ✓ All Accounts
              </button>
              {accounts.map((acct) => {
                const sel = selectedIds.includes(acct.id);
                return (
                  <button
                    key={acct.id}
                    onClick={() => onToggle(acct.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-xs transition ${
                      sel ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center ${sel ? "bg-indigo-600 border-indigo-600" : "border-slate-300"}`}>
                        {sel && <span className="text-white text-[8px]">✓</span>}
                      </span>
                      <span className="truncate">{acct.name}</span>
                    </span>
                    <span className="text-slate-400 shrink-0">{formatCurrency(acct.balance)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!allSelected && (
          <>
            <div className="flex gap-1 flex-wrap">
              {selectedIds.map((id) => {
                const acct = accounts.find((a) => a.id === id);
                return acct ? (
                  <span key={id} className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full flex items-center gap-1">
                    {acct.name}
                    <button onClick={() => onToggle(id)} className="ml-0.5 hover:text-indigo-900">×</button>
                  </span>
                ) : null;
              })}
            </div>
            <button onClick={onReset} className="text-[10px] text-slate-400 hover:text-slate-600 underline">
              clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Timeframe Picker ──────────────────────────────────────── */
function TimeframePicker({
  mode, setMode, preset, setPreset, customDays, setCustomDays,
  fromDate, setFromDate, toDate, setToDate,
  window: win, onManageRecurring, isFetching, onTimeframeChange,
}) {
  const disabled = isFetching;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600 mr-1">Timeframe:</span>
        <div className={`flex gap-1 bg-slate-100 rounded-lg p-1 ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              disabled={disabled}
              onClick={() => onTimeframeChange(() => { setMode("preset"); setPreset(p.key); })}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                mode === "preset" && preset === p.key
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          disabled={disabled}
          onClick={() => onTimeframeChange(() => setMode("monthEnd"))}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition ${
            mode === "monthEnd"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
          } ${disabled ? "opacity-60 pointer-events-none" : ""}`}
        >
          End of month
        </button>

        <div className="ml-auto flex items-center gap-3">
          {/* Inline fetch indicator in the toolbar */}
          {isFetching && (
            <div className="flex items-center gap-1.5 text-[11px] text-indigo-600">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-indigo-600" />
              Loading…
            </div>
          )}
          <span className="text-[11px] text-slate-500">
            {win.from} → {win.to} <span className="text-slate-400">({win.days}d)</span>
          </span>
          <button
            onClick={onManageRecurring}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
          >
            Manage Recurring
          </button>
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100 ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
        <label className={`flex items-center gap-2 text-xs ${mode === "days" ? "text-slate-900" : "text-slate-500"}`}>
          <input type="radio" name="tf" checked={mode === "days"} onChange={() => onTimeframeChange(() => setMode("days"))} className="accent-indigo-600" />
          Custom days
          <input
            type="number" min="1" max="730" value={customDays}
            onChange={(e) => onTimeframeChange(() => { setMode("days"); setCustomDays(parseInt(e.target.value) || 30); })}
            className="w-20 px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        <label className={`flex items-center gap-2 text-xs ${mode === "range" ? "text-slate-900" : "text-slate-500"}`}>
          <input type="radio" name="tf" checked={mode === "range"} onChange={() => onTimeframeChange(() => setMode("range"))} className="accent-indigo-600" />
          Date range
          <input
            type="date" value={fromDate}
            onChange={(e) => onTimeframeChange(() => { setMode("range"); setFromDate(e.target.value); })}
            className="px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date" value={toDate}
            onChange={(e) => onTimeframeChange(() => { setMode("range"); setToDate(e.target.value); })}
            className="px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>
    </div>
  );
}

/* ── Liquidity Banner ──────────────────────────────────────── */
function LiquidityBanner({ balances, liquidity }) {
  const pl = liquidity.projected_ending_liquidity;
  const ok = pl != null ? pl >= 0 : liquidity.ok;
  return (
    <div className={`rounded-xl border p-4 ${ok ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Mini label="Cash on hand"      value={formatCurrency(balances.cash)} />
        <Mini label="In bank"           value={formatCurrency(balances.bank)} />
        <Mini label="Starting balance"  value={formatCurrency(balances.total_liquid)} bold />
        {pl != null && (
          <Mini label="Proj. ending balance" value={formatCurrency(pl)} bold tone={pl >= 0 ? "emerald" : "rose"} />
        )}
        <Mini
          label="Liquidity status"
          value={ok ? "Healthy" : "At risk"}
          sub={liquidity.coverage_ratio < 999 ? `${liquidity.coverage_ratio}× coverage` : ""}
          tone={ok ? "emerald" : "rose"}
        />
      </div>
    </div>
  );
}

function Mini({ label, value, sub, bold, tone }) {
  const toneCls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 ${bold ? "text-base font-extrabold" : "text-sm font-bold"} ${toneCls}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── Column Section ────────────────────────────────────────── */
const ColumnSection = memo(function ColumnSection({
  title, tone, groups, onUpsert, onClear, simulatedPaid, onSimulatePaid,
}) {
  const total = useMemo(() => (groups || []).reduce((s, g) => s + g.expected_total, 0), [groups]);
  const tones = {
    emerald: { ring: "border-emerald-200", text: "text-emerald-700" },
    rose:    { ring: "border-rose-200",    text: "text-rose-700" },
  };
  const c = tones[tone] || tones.emerald;

  return (
    <div className={`bg-white rounded-xl border ${c.ring} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-slate-100 flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">{title}</h2>
        <span className={`text-lg font-extrabold ${c.text}`}>{formatCurrency(total)}</span>
      </div>
      {(!groups || groups.length === 0) ? (
        <div className="p-6 text-center text-sm text-slate-400">No items in this window</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {groups.map((g) => (
            <EntityCard
              key={g.key}
              group={g}
              tone={tone}
              onUpsert={onUpsert}
              onClear={onClear}
              simulatedPaid={simulatedPaid}
              onSimulatePaid={onSimulatePaid}
            />
          ))}
        </ul>
      )}
    </div>
  );
});

/* ── Entity Accordion Card ─────────────────────────────────── */
const EntityCard = memo(function EntityCard({
  group, tone, onUpsert, onClear, simulatedPaid, onSimulatePaid,
}) {
  const [open, setOpen] = useState(group.has_overdue);
  const c = tone === "rose" ? "text-rose-700" : "text-emerald-700";

  return (
    <li>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
      >
        <span className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 truncate">{group.entity_name}</span>
            {group.has_overdue && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700">
                overdue
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {group.item_count} item{group.item_count !== 1 ? "s" : ""}
            {group.fulfilled_total > 0 ? ` · ${formatCurrency(group.fulfilled_total)} fulfilled` : ""}
            {group.skipped_total > 0 ? ` · ${formatCurrency(group.skipped_total)} excluded` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-base font-bold ${c}`}>{formatCurrency(group.expected_total)}</p>
          {group.calculated_total !== group.expected_total && (
            <p className="text-[10px] text-slate-400 line-through">{formatCurrency(group.calculated_total)}</p>
          )}
        </div>
      </button>

      {open && (
        <ul className="bg-slate-50/60 border-t border-slate-100">
          {group.items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              tone={tone}
              onUpsert={onUpsert}
              onClear={onClear}
              isSimulated={simulatedPaid.has(it.id)}
              onSimulatePaid={onSimulatePaid}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

/* ── Item Row ──────────────────────────────────────────────── */
const ItemRow = memo(function ItemRow({
  item, tone, onUpsert, onClear, isSimulated, onSimulatePaid,
}) {
  const ov = item.override;
  const isFulfilledByDB = ov?.status === "fulfilled";
  const currentlyIncluded = !isFulfilledByDB && !isSimulated && isItemIncluded(item);
  const isExcluded = !isFulfilledByDB && !isSimulated && !currentlyIncluded;
  const isLowPriorityDefault = item.loan_priority === "low" && !ov;

  const [editingAmount, setEditingAmount] = useState(false);
  const [draftAmount, setDraftAmount] = useState(item.effective_amount);

  const c       = tone === "rose" ? "text-rose-700" : "text-emerald-700";
  const confCls = CONFIDENCE_STYLE[item.confidence] || CONFIDENCE_STYLE.medium;
  const isLoanItem         = item.kind?.startsWith("loan_");
  const hasRemainingPrincipal = isLoanItem && item.remaining_principal > 0;

  // Visual treatment when sandbox-simulated as paid
  const rowCls = isSimulated
    ? "opacity-40 bg-slate-50/80"
    : isFulfilledByDB
    ? "opacity-60"
    : "";

  return (
    <li className={`px-4 py-2.5 flex flex-wrap items-center gap-2 hover:bg-white transition-opacity ${
      item.is_overdue ? "border-l-2 border-rose-400" : ""
    } ${rowCls}`}>
      {/* Include toggle — DB override */}
      <input
        type="checkbox"
        checked={currentlyIncluded}
        disabled={isFulfilledByDB || isSimulated}
        onChange={(e) => onUpsert({ item_id: item.id, included: e.target.checked })}
        title={
          isFulfilledByDB ? "Already fulfilled"
          : isSimulated ? "Marked as settled (sandbox)"
          : isLowPriorityDefault ? "Low priority — excluded by default"
          : "Include in totals"
        }
        className="accent-indigo-600 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confCls}`}>{item.confidence}</span>
          <span className="text-[10px] text-slate-400 uppercase">{KIND_LABEL[item.kind] || item.kind}</span>
          {item.is_recurring && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-50 border-blue-200 text-blue-700 font-semibold tracking-wide">
              RECURRING
            </span>
          )}
          {item.loan_priority && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_STYLE[item.loan_priority] || ""}`}>
              {item.loan_priority}
            </span>
          )}
          <span className={`text-xs font-medium text-slate-700 truncate ${isSimulated ? "line-through text-slate-400" : ""}`}>
            {item.label}
          </span>
          {/* Per-row principal display for loan items */}
          {isLoanItem && item.principal_amount > 0 && (
            <span className="text-[10px] text-slate-400 font-normal">
              · principal {formatCurrency(item.principal_amount)}
            </span>
          )}
          {item.is_overdue && !isSimulated && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700">overdue</span>
          )}
          {isFulfilledByDB && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-700">
              ✓ fulfilled {formatCurrency(ov.fulfilled_amount)} · {ov.fulfilled_at}
            </span>
          )}
          {isSimulated && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700">
              ✓ simulated paid
            </span>
          )}
          {isExcluded && !isFulfilledByDB && !isSimulated && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-100 border-slate-200 text-slate-500">
              {isLowPriorityDefault ? "low priority" : "excluded"}
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {item.due_date ? `Due ${item.due_date}` : "No due date"}
          {item.linked_url && (
            <> · <Link to={item.linked_url} className="text-indigo-600 hover:underline">view</Link></>
          )}
        </p>
      </div>

      {/* Amount column */}
      <div className="text-right shrink-0">
        {editingAmount ? (
          <input
            type="number"
            autoFocus
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            onBlur={() => {
              setEditingAmount(false);
              const num = parseFloat(draftAmount);
              if (!isNaN(num) && num !== item.amount) onUpsert({ item_id: item.id, amount_override: num });
            }}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            className="w-24 px-2 py-1 border border-indigo-300 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        ) : (
          <button
            onClick={() => !isFulfilledByDB && !isSimulated && setEditingAmount(true)}
            disabled={isFulfilledByDB || isSimulated}
            className={`text-right ${!isFulfilledByDB && !isSimulated ? "hover:bg-indigo-50 px-2 py-0.5 rounded cursor-text" : ""}`}
            title="Click to override expected amount"
          >
            <span className={`text-sm font-bold ${c} ${isSimulated ? "line-through text-slate-400" : ""}`}>
              {formatCurrency(item.effective_amount)}
            </span>
            {ov?.amount_override != null && ov.amount_override !== item.amount && (
              <p className="text-[10px] text-slate-400 line-through">{formatCurrency(item.amount)}</p>
            )}
          </button>
        )}
      </div>

      {/* Row actions */}
      <div className="w-full flex items-center justify-end gap-1.5 mt-1 flex-wrap">
        {/* Sandbox "Mark paid/received" — local state only, no DB call */}
        {!isFulfilledByDB && (
          <button
            onClick={() => onSimulatePaid(item.id)}
            className={`text-[10px] px-2 py-0.5 rounded border transition ${
              isSimulated
                ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                : tone === "rose"
                ? "bg-white border-rose-200 text-rose-700 hover:bg-rose-50"
                : "bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            }`}
          >
            {isSimulated
              ? "Undo"
              : tone === "rose" ? "Mark paid" : "Mark received"}
          </button>
        )}

        {/* Settle Principal — DB override */}
        {!isFulfilledByDB && !isSimulated && hasRemainingPrincipal && (
          <button
            onClick={() => onUpsert({ item_id: item.id, amount_override: item.remaining_principal })}
            className="text-[10px] px-2 py-0.5 rounded border bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
            title={`Set to full remaining principal: ${formatCurrency(item.remaining_principal)}`}
          >
            Settle Principal
          </button>
        )}

        {/* Reset — DB override clear */}
        {ov && !isSimulated && (
          <button
            onClick={() => onClear({ item_id: item.id })}
            className="text-[10px] px-2 py-0.5 rounded border bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Reset
          </button>
        )}
      </div>
    </li>
  );
});

/* ── Manage Recurring Modal ────────────────────────────────── */
function ManageRecurringModal({ accounts, onClose }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["recurring-transactions", { include_inactive: true }],
    queryFn: () => api.get("/api/recurring-transactions?include_inactive=true").then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (body) => api.post("/api/recurring-transactions", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring-transactions"] }); setShowForm(false); setEditItem(null); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/api/recurring-transactions/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring-transactions"] }); setShowForm(false); setEditItem(null); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/recurring-transactions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-transactions"] }),
  });

  const handleSubmit = (formData) => {
    if (editItem) updateMutation.mutate({ id: editItem.id, ...formData });
    else createMutation.mutate(formData);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Manage Recurring Transactions</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setEditItem(null); setShowForm(true); }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              + Add New
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {(showForm || editItem) && (
            <RecurringForm
              initial={editItem}
              accounts={accounts}
              onSubmit={handleSubmit}
              onCancel={() => { setShowForm(false); setEditItem(null); }}
              isLoading={createMutation.isPending || updateMutation.isPending}
            />
          )}

          {isLoading ? (
            <div className="text-center py-8 text-slate-400 text-sm">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No recurring transactions yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
              {items.map((rt) => {
                const acct = accounts.find((a) => a.id === rt.account_id);
                return (
                  <li key={rt.id} className={`flex items-center gap-3 px-4 py-3 ${!rt.is_active ? "opacity-50 bg-slate-50" : ""}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rt.type === "inflow" ? "bg-emerald-500" : "bg-rose-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-800">{rt.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-slate-200 text-slate-500 capitalize">{rt.frequency}</span>
                        {!rt.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">paused</span>}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Next: {rt.next_due_date}{acct ? ` · ${acct.name}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${rt.type === "inflow" ? "text-emerald-700" : "text-rose-700"}`}>
                        {rt.type === "inflow" ? "+" : "−"}{formatCurrency(rt.amount)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditItem(rt); setShowForm(false); }} className="text-[10px] px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">Edit</button>
                      <button
                        onClick={() => updateMutation.mutate({ id: rt.id, is_active: !rt.is_active })}
                        className={`text-[10px] px-2 py-0.5 rounded border ${rt.is_active ? "border-orange-200 text-orange-600 hover:bg-orange-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
                      >
                        {rt.is_active ? "Pause" : "Resume"}
                      </button>
                      <button
                        onClick={() => { if (confirm("Delete this recurring transaction?")) deleteMutation.mutate(rt.id); }}
                        className="text-[10px] px-2 py-0.5 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Recurring Transaction Form ────────────────────────────── */
function RecurringForm({ initial, accounts, onSubmit, onCancel, isLoading }) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    type: initial?.type || "inflow",
    amount: initial?.amount || "",
    frequency: initial?.frequency || "monthly",
    next_due_date: initial?.next_due_date || new Date().toISOString().slice(0, 10),
    account_id: initial?.account_id || "",
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{initial ? "Edit" : "New"} Recurring Transaction</h3>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, amount: parseFloat(form.amount), account_id: form.account_id ? parseInt(form.account_id) : null }); }} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-3">
          <label className="block text-[11px] text-slate-500 mb-1">Title</label>
          <input required value={form.title} onChange={set("title")} placeholder="e.g. Monthly Salary, Office Rent" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Type</label>
          <select value={form.type} onChange={set("type")} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="inflow">Inflow (income)</option>
            <option value="outflow">Outflow (expense)</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Amount (₹)</label>
          <input required type="number" min="1" step="0.01" value={form.amount} onChange={set("amount")} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Frequency</label>
          <select value={form.frequency} onChange={set("frequency")} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Next Due Date</label>
          <input required type="date" value={form.next_due_date} onChange={set("next_due_date")} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] text-slate-500 mb-1">Account (optional)</label>
          <select value={form.account_id} onChange={set("account_id")} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="">— No account —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-3 flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="px-4 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={isLoading} className="px-4 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {isLoading ? "Saving…" : initial ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Timeline Tooltip ──────────────────────────────────────── */
function TimelineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-lg text-xs">
      <p className="font-semibold text-slate-700 mb-1">{d.day_label}</p>
      {d.inflow  > 0 && <p className="text-emerald-600">↑ Inflow: {formatCurrency(d.inflow)}</p>}
      {d.outflow > 0 && <p className="text-rose-600">↓ Outflow: {formatCurrency(d.outflow)}</p>}
      <p className="text-indigo-600 font-semibold mt-1">Balance: {formatCurrency(d.running_balance)}</p>
    </div>
  );
}
