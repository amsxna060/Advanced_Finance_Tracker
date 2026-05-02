/**
 * Forecast & Liquidity
 * --------------------
 * Entity-grouped cash-flow projection. Supports timeframe presets (15/30/60/90),
 * custom day count, custom date range, and "until month end" shortcut.
 *
 * Per-item overrides (toggle, amount override, fulfilled) persist server-side
 * scoped to the current calendar month so they auto-clear next month — items
 * not actually settled reappear in next month's forecast as overdue (driven
 * by the underlying loan/obligation data).
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
  property: "Property",
  beesi: "Beesi",
};

const CONFIDENCE_STYLE = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-rose-50 text-rose-700 border-rose-200",
};

/* ── Param builder ─────────────────────────────────────────── */
function buildParams(mode, preset, days, fromDate, toDate, monthEnd) {
  if (mode === "preset") return { timeframe: preset };
  if (mode === "days") return { days };
  if (mode === "monthEnd") return { to_month_end: true };
  if (mode === "range") return { from_date: fromDate, to_date: toDate };
  return { timeframe: "30d" };
}

/* ── Cache patching helpers ─────────────────────────────────────
 * The forecast response is a deeply-nested tree. Mutating it
 * through React Query's setQueryData with these helpers lets us
 * apply optimistic updates without refetching — the entire panel
 * recomputes locally in O(items), and only changed group/item
 * references trigger a child re-render thanks to memo() below.
 * ─────────────────────────────────────────────────────────────── */
const sumBy = (arr, k) => arr.reduce((s, g) => s + (g[k] || 0), 0);

function recomputeGroup(g) {
  let calc = 0, expected = 0, fulfilled = 0, skipped = 0;
  let hasOverdue = false;
  for (const it of g.items) {
    calc += it.effective_amount;
    if (it.is_overdue) hasOverdue = true;
    const ov = it.override;
    if (ov?.status === "fulfilled") fulfilled += it.effective_amount;
    else if (ov?.status === "skipped" || ov?.included === false) skipped += it.effective_amount;
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

function recomputeForecast(data) {
  const inflow_groups = data.inflow_groups.map(recomputeGroup);
  const outflow_groups = data.outflow_groups.map(recomputeGroup);
  const expected_inflow = sumBy(inflow_groups, "expected_total");
  const required_outflow = sumBy(outflow_groups, "expected_total");
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
    },
  };
}

function patchItem(data, itemId, mutator) {
  let touched = false;
  const patchItems = (items) =>
    items.map((it) => {
      if (it.id !== itemId) return it;
      touched = true;
      return mutator(it);
    });
  const patchGroup = (g) => {
    const newItems = patchItems(g.items);
    return newItems === g.items ? g : { ...g, items: newItems };
  };
  const next = {
    ...data,
    inflow_groups: data.inflow_groups.map(patchGroup),
    outflow_groups: data.outflow_groups.map(patchGroup),
  };
  return touched ? recomputeForecast(next) : data;
}

/** Apply an upsert/fulfill/clear locally so totals update before the network round-trip. */
function applyOverrideMutator(action, body) {
  return (it) => {
    if (action === "clear") {
      const { effective_amount: _, ...rest } = it;
      return { ...rest, override: null, effective_amount: it.amount };
    }
    const prev = it.override || { included: true, status: "pending" };
    if (action === "fulfill") {
      return {
        ...it,
        override: {
          ...prev,
          included: true,
          status: "fulfilled",
          fulfilled_amount: parseFloat(body.fulfilled_amount),
          fulfilled_at: body.fulfilled_at || new Date().toISOString().slice(0, 10),
          notes: body.notes ?? prev.notes ?? null,
        },
      };
    }
    // upsert
    let nextOv = { ...prev };
    if (body.included !== undefined) {
      nextOv.included = body.included;
      if (body.included === false && nextOv.status !== "fulfilled") nextOv.status = "skipped";
      else if (body.included === true && nextOv.status === "skipped") nextOv.status = "pending";
    }
    if (body.amount_override !== undefined) {
      nextOv.amount_override = parseFloat(body.amount_override);
    }
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
  const [mode, setMode] = useState("preset");
  const [preset, setPreset] = useState("30d");
  const [customDays, setCustomDays] = useState(35);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const params = buildParams(mode, preset, customDays, fromDate, toDate);
  const queryKey = useMemo(() => ["forecast", params], [JSON.stringify(params)]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async () => (await api.get("/api/forecast", { params })).data,
    placeholderData: (prev) => prev,
  });

  // Optimistic mutation factory: patch the cache before the network call,
  // roll back on error. Avoids a full refetch (and the laggy re-render of
  // the entire grouped tree) on every checkbox click.
  const makeMutation = (path, action) =>
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
      // No onSuccess invalidation — the optimistic patch is authoritative
      // until the next user-triggered refetch (timeframe change, page revisit).
    });

  const upsertMutation = makeMutation("/api/forecast/overrides", "upsert");
  const fulfillMutation = makeMutation("/api/forecast/overrides/fulfill", "fulfill");
  const clearMutation = makeMutation("/api/forecast/overrides/clear", "clear");

  const onUpsert = useCallback((body) => upsertMutation.mutate(body), [upsertMutation]);
  const onFulfill = useCallback((body) => fulfillMutation.mutate(body), [fulfillMutation]);
  const onClear = useCallback((body) => clearMutation.mutate(body), [clearMutation]);

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const t = data.totals;
  const lr = data.liquidity;

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* ── Sticky scorecard ──────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-slate-50/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-baseline justify-between mb-2">
            <h1 className="text-xl font-bold text-slate-900">Forecast & Liquidity</h1>
            <p className="text-[11px] text-slate-500">
              As of {data.as_of_date} · period {data.period_key}
              {isFetching ? " · refreshing…" : ""}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Score
              label="Projected Inflows"
              value={t.expected_inflow}
              sub={t.fulfilled_inflow > 0 ? `${formatCurrency(t.fulfilled_inflow)} already in` : null}
              tone="emerald"
            />
            <Score
              label="Required Outflows"
              value={t.required_outflow}
              sub={t.overdue_outflow > 0 ? `${formatCurrency(t.overdue_outflow)} overdue` : null}
              tone="rose"
            />
            <Score
              label="Net Liquidity"
              value={t.net_liquidity}
              sub={lr.coverage_ratio < 999 ? `Coverage ${lr.coverage_ratio}× · runway ${lr.runway_days}d` : "No outflows"}
              tone={t.net_liquidity >= 0 ? "indigo" : "rose"}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5 space-y-5">
        {/* ── Timeframe picker ──────────────────────────── */}
        <TimeframePicker
          mode={mode} setMode={setMode}
          preset={preset} setPreset={setPreset}
          customDays={customDays} setCustomDays={setCustomDays}
          fromDate={fromDate} setFromDate={setFromDate}
          toDate={toDate} setToDate={setToDate}
          window={{ from: data.from_date, to: data.to_date, days: data.timeframe_days }}
        />

        {/* ── Liquid balance summary ──────────────────── */}
        <LiquidityBanner balances={data.balances} liquidity={lr} />

        {/* ── Two-column flows ─────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <ColumnSection
            title="Money Coming In"
            tone="emerald"
            groups={data.inflow_groups}
            onUpsert={onUpsert}
            onFulfill={onFulfill}
            onClear={onClear}
          />
          <ColumnSection
            title="Money Going Out"
            tone="rose"
            groups={data.outflow_groups}
            onUpsert={onUpsert}
            onFulfill={onFulfill}
            onClear={onClear}
          />
        </div>

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
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
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
                  <Area
                    type="monotone"
                    dataKey="running_balance"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#balGrad)"
                    name="Balance"
                  />
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
                  data={data.timeline.filter((t) => t.inflow > 0 || t.outflow > 0)}
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
                  <Bar dataKey="inflow" fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow" />
                  <Bar dataKey="outflow" fill="#ef4444" radius={[4, 4, 0, 0]} name="Outflow" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sticky Score Tile ─────────────────────────────────────── */
function Score({ label, value, sub, tone }) {
  const tones = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    rose: "bg-rose-50 border-rose-200 text-rose-800",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-800",
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone] || tones.indigo}`}>
      <p className="text-[10px] uppercase tracking-wider font-medium opacity-70">{label}</p>
      <p className="text-xl font-extrabold mt-0.5">{formatCurrency(value)}</p>
      {sub && <p className="text-[10px] mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

/* ── Timeframe Picker ──────────────────────────────────────── */
function TimeframePicker({
  mode, setMode, preset, setPreset, customDays, setCustomDays,
  fromDate, setFromDate, toDate, setToDate, window,
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600 mr-1">Timeframe:</span>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => { setMode("preset"); setPreset(p.key); }}
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
          onClick={() => setMode("monthEnd")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition ${
            mode === "monthEnd"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
          }`}
        >
          End of month
        </button>

        <div className="ml-auto text-[11px] text-slate-500">
          {window.from} → {window.to} <span className="text-slate-400">({window.days}d)</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100">
        <label className={`flex items-center gap-2 text-xs ${mode === "days" ? "text-slate-900" : "text-slate-500"}`}>
          <input
            type="radio" name="tf" checked={mode === "days"}
            onChange={() => setMode("days")} className="accent-indigo-600"
          />
          Custom days
          <input
            type="number" min="1" max="730" value={customDays}
            onChange={(e) => { setMode("days"); setCustomDays(parseInt(e.target.value) || 30); }}
            className="w-20 px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        <label className={`flex items-center gap-2 text-xs ${mode === "range" ? "text-slate-900" : "text-slate-500"}`}>
          <input
            type="radio" name="tf" checked={mode === "range"}
            onChange={() => setMode("range")} className="accent-indigo-600"
          />
          Date range
          <input
            type="date" value={fromDate}
            onChange={(e) => { setMode("range"); setFromDate(e.target.value); }}
            className="px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date" value={toDate}
            onChange={(e) => { setMode("range"); setToDate(e.target.value); }}
            className="px-2 py-1 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>
    </div>
  );
}

/* ── Liquidity banner ──────────────────────────────────────── */
function LiquidityBanner({ balances, liquidity }) {
  return (
    <div className={`rounded-xl border p-4 ${
      liquidity.ok ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"
    }`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Mini label="Cash on hand" value={formatCurrency(balances.cash)} />
        <Mini label="In bank" value={formatCurrency(balances.bank)} />
        <Mini label="Total liquid" value={formatCurrency(balances.total_liquid)} bold />
        <Mini
          label="Liquidity status"
          value={liquidity.ok ? "Healthy" : "At risk"}
          sub={liquidity.coverage_ratio < 999 ? `${liquidity.coverage_ratio}× coverage` : ""}
          tone={liquidity.ok ? "emerald" : "rose"}
        />
      </div>
    </div>
  );
}

function Mini({ label, value, sub, bold, tone }) {
  const toneCls = tone === "emerald"
    ? "text-emerald-700"
    : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 ${bold ? "text-lg font-extrabold" : "text-base font-bold"} ${toneCls}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── Column Section ────────────────────────────────────────── */
const ColumnSection = memo(function ColumnSection({ title, tone, groups, onUpsert, onFulfill, onClear }) {
  const total = useMemo(
    () => (groups || []).reduce((s, g) => s + g.expected_total, 0),
    [groups],
  );
  const fulfilledTotal = useMemo(
    () => (groups || []).reduce((s, g) => s + g.fulfilled_total, 0),
    [groups],
  );
  const tones = {
    emerald: { ring: "border-emerald-200", text: "text-emerald-700", bar: "bg-emerald-400" },
    rose: { ring: "border-rose-200", text: "text-rose-700", bar: "bg-rose-400" },
  };
  const c = tones[tone] || tones.emerald;

  return (
    <div className={`bg-white rounded-xl border ${c.ring} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-slate-100 flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">{title}</h2>
        <div className="flex items-baseline gap-3">
          {fulfilledTotal > 0 && (
            <span className="text-xs text-slate-500">
              {formatCurrency(fulfilledTotal)} fulfilled
            </span>
          )}
          <span className={`text-lg font-extrabold ${c.text}`}>
            {formatCurrency(total)}
          </span>
        </div>
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
              onFulfill={onFulfill}
              onClear={onClear}
            />
          ))}
        </ul>
      )}
    </div>
  );
});

/* ── Entity Accordion Card ─────────────────────────────────── */
const EntityCard = memo(function EntityCard({ group, tone, onUpsert, onFulfill, onClear }) {
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
          <div className="flex items-center gap-2">
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
            {group.skipped_total > 0 ? ` · ${formatCurrency(group.skipped_total)} skipped` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-base font-bold ${c}`}>{formatCurrency(group.expected_total)}</p>
          {group.calculated_total !== group.expected_total && (
            <p className="text-[10px] text-slate-400 line-through">
              {formatCurrency(group.calculated_total)}
            </p>
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
              onFulfill={onFulfill}
              onClear={onClear}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

/* ── Item Row (with override controls) ─────────────────────── */
const ItemRow = memo(function ItemRow({ item, tone, onUpsert, onFulfill, onClear }) {
  const ov = item.override;
  const isFulfilled = ov?.status === "fulfilled";
  const isSkipped = ov?.status === "skipped" || ov?.included === false;

  const [editingAmount, setEditingAmount] = useState(false);
  const [draftAmount, setDraftAmount] = useState(item.effective_amount);
  const [showFulfill, setShowFulfill] = useState(false);
  const [fulfillAmt, setFulfillAmt] = useState(item.effective_amount);

  const c = tone === "rose" ? "text-rose-700" : "text-emerald-700";
  const confCls = CONFIDENCE_STYLE[item.confidence] || CONFIDENCE_STYLE.medium;

  return (
    <li className={`px-4 py-2.5 flex flex-wrap items-center gap-2 hover:bg-white ${
      item.is_overdue ? "border-l-2 border-rose-400" : ""
    } ${isFulfilled ? "opacity-60" : ""}`}>
      {/* include toggle (works for both inflows and outflows) */}
      <input
        type="checkbox"
        checked={!isSkipped && !isFulfilled}
        disabled={isFulfilled}
        onChange={(e) => onUpsert({ item_id: item.id, included: e.target.checked })}
        title={isFulfilled ? "Already fulfilled" : "Include in totals"}
        className="accent-indigo-600 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confCls}`}>
            {item.confidence}
          </span>
          <span className="text-[10px] text-slate-400 uppercase">
            {KIND_LABEL[item.kind] || item.kind}
          </span>
          <span className="text-xs font-medium text-slate-700 truncate">{item.label}</span>
          {item.is_overdue && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700">
              overdue
            </span>
          )}
          {isFulfilled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-700">
              ✓ fulfilled {formatCurrency(ov.fulfilled_amount)} · {ov.fulfilled_at}
            </span>
          )}
          {isSkipped && !isFulfilled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-100 border-slate-200 text-slate-600">
              skipped
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {item.due_date ? `Due ${item.due_date}` : "No due date"}
          {item.linked_url && (
            <>
              {" · "}
              <Link to={item.linked_url} className="text-indigo-600 hover:underline">view</Link>
            </>
          )}
        </p>
      </div>

      {/* amount column */}
      <div className="text-right shrink-0">
        {editingAmount ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              autoFocus
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              onBlur={() => {
                setEditingAmount(false);
                const num = parseFloat(draftAmount);
                if (!isNaN(num) && num !== item.amount) {
                  onUpsert({ item_id: item.id, amount_override: num });
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
              className="w-24 px-2 py-1 border border-indigo-300 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        ) : (
          <button
            onClick={() => !isFulfilled && setEditingAmount(true)}
            disabled={isFulfilled}
            className={`text-right ${!isFulfilled ? "hover:bg-indigo-50 px-2 py-0.5 rounded cursor-text" : ""}`}
            title="Click to override expected amount"
          >
            <span className={`text-sm font-bold ${c}`}>
              {formatCurrency(item.effective_amount)}
            </span>
            {ov?.amount_override != null && ov.amount_override !== item.amount && (
              <p className="text-[10px] text-slate-400 line-through">
                {formatCurrency(item.amount)}
              </p>
            )}
          </button>
        )}
      </div>

      {/* row actions */}
      <div className="w-full flex items-center justify-end gap-1.5 mt-1">
        {!isFulfilled && (
          <button
            onClick={() => { setFulfillAmt(item.effective_amount); setShowFulfill(true); }}
            className={`text-[10px] px-2 py-0.5 rounded border bg-white ${
              tone === "rose"
                ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            }`}
          >
            {tone === "rose" ? "Mark paid" : "Mark received"}
          </button>
        )}
        {ov && (
          <button
            onClick={() => onClear({ item_id: item.id })}
            className="text-[10px] px-2 py-0.5 rounded border bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Reset
          </button>
        )}
      </div>

      {showFulfill && (
        <div className="w-full mt-2 p-2 bg-white rounded border border-emerald-200 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-600">Received amount:</span>
          <input
            type="number"
            value={fulfillAmt}
            onChange={(e) => setFulfillAmt(e.target.value)}
            className="w-28 px-2 py-1 border border-slate-200 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            onClick={() => {
              const num = parseFloat(fulfillAmt);
              if (!isNaN(num)) {
                onFulfill({ item_id: item.id, fulfilled_amount: num });
                setShowFulfill(false);
              }
            }}
            className="text-[11px] px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Confirm
          </button>
          <button
            onClick={() => setShowFulfill(false)}
            className="text-[11px] px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
});

/* ── Tooltip ───────────────────────────────────────────────── */
function TimelineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-lg text-xs">
      <p className="font-semibold text-slate-700 mb-1">{d.day_label}</p>
      {d.inflow > 0 && <p className="text-emerald-600">↑ Inflow: {formatCurrency(d.inflow)}</p>}
      {d.outflow > 0 && <p className="text-rose-600">↓ Outflow: {formatCurrency(d.outflow)}</p>}
      <p className="text-indigo-600 font-semibold mt-1">Balance: {formatCurrency(d.running_balance)}</p>
    </div>
  );
}
