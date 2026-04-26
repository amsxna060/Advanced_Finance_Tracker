
jsx = r'''import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area,
  ComposedChart, Line,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

/* ─────────────────────────────────────────────── constants ── */
const PALETTE = [
  "#6366f1","#f43f5e","#10b981","#f59e0b","#8b5cf6",
  "#ec4899","#06b6d4","#f97316","#84cc16","#14b8a6",
  "#3b82f6","#ef4444","#a855f7","#d946ef","#0ea5e9",
  "#64748b","#22c55e","#e11d48","#ca8a04","#2563eb",
];
const AI_PALETTE = ["#7c3aed","#db2777","#0891b2","#d97706","#059669","#dc2626","#4f46e5","#0d9488"];
const MODE_ICONS  = { upi:"📲", cash:"💵", bank_transfer:"🏦", card:"💳", cheque:"📄", unknown:"❓" };
const MODE_LABELS = { upi:"UPI", cash:"Cash", bank_transfer:"Bank Transfer", card:"Card", cheque:"Cheque", unknown:"Unknown" };
const SEVERITY_STYLES = {
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  info:    "bg-sky-50 border-sky-200 text-sky-800",
  error:   "bg-red-50 border-red-200 text-red-800",
};

/* Tier-2 Firozabad ₹90k household — sensible monthly defaults */
const DEFAULT_BUDGETS = {
  "Groceries & Daily Needs":  8000,
  "Food & Dining":             5000,
  "Housing & Utilities":       4000,
  "Transport & Auto":          4000,
  "Health & Medical":          3000,
  "Education & Children":      5000,
  "Spiritual & Social":        3000,
  "Personal & Lifestyle":      4000,
  "Financial & Legal":         2000,
  "Shopping & Electronics":    3000,
  "Entertainment & Leisure":   2000,
  "Investment":                8000,
  "Uncategorized":             2000,
};

/* ─────────────────────────────────────────────── date utils ── */
function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}
function getMonthYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function getToday() { return new Date().toISOString().split("T")[0]; }
function get6MonthsAgo() {
  const d = new Date(); d.setMonth(d.getMonth()-5);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}
const PRESETS = [
  { label:"This Month", from:getMonthStart(), to:getToday() },
  { label:"3 Months",
    from:(()=>{ const d=new Date(); d.setMonth(d.getMonth()-2); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; })(),
    to:getToday() },
  { label:"6 Months",  from:get6MonthsAgo(), to:getToday() },
  { label:"This Year", from:`${new Date().getFullYear()}-01-01`, to:getToday() },
  { label:"All Time",  from:"", to:"" },
];

/* ─────────────────────────────────────────────── micro UI ── */
function Badge({ children, cls = "bg-slate-100 text-slate-500" }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{children}</span>;
}
function ProgressBar({ pct, color, h = "h-2" }) {
  return (
    <div className={`${h} bg-slate-100 rounded-full overflow-hidden`}>
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width:`${Math.min(pct,100)}%`, backgroundColor:color }}/>
    </div>
  );
}
function Card({ children, className="" }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 p-5 ${className}`}>{children}</div>;
}
function SectionDot({ color="bg-indigo-500" }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`}/>;
}
function SectionTitle({ children, color="bg-indigo-500", action }) {
  return (
    <div className="flex items-center gap-2.5 mb-4 mt-8">
      <SectionDot color={color}/>
      <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide flex-1">{children}</h2>
      {action}
    </div>
  );
}
function EmptyState({ text }) {
  return (
    <div className="flex flex-col items-center justify-center h-44 gap-2 text-slate-300">
      <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <p className="text-sm">{text}</p>
    </div>
  );
}

/* custom tooltip matching dashboard dark style */
function DarkTooltip({ active, payload, label, prefix="" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 text-white text-xs rounded-xl px-3 py-2.5 shadow-xl border border-slate-700 min-w-[130px]">
      {label && <p className="font-semibold mb-1.5 text-slate-300">{label}</p>}
      {payload.map((p,i) => (
        <p key={i} className="flex items-center justify-between gap-3">
          <span style={{color:p.color||p.stroke}} className="font-medium">{p.name}</span>
          <span className="font-bold text-white tabular-nums">{prefix}{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/* arrow trend indicator */
function TrendArrow({ pct, invert=false }) {
  if (!pct && pct !== 0) return null;
  const up = pct > 0;
  /* for spending: up is bad (rose), down is good (emerald); invert flips */
  const bad = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${bad ? "text-rose-500" : "text-emerald-500"}`}>
      <svg className={`w-3 h-3 ${up ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7"/>
      </svg>
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/* ──────────────────────────────────── budget edit modal ── */
function BudgetModal({ limits, onClose, onSave }) {
  const categories = Object.keys(DEFAULT_BUDGETS);
  const [vals, setVals] = useState(() => {
    const m = {};
    categories.forEach(c => {
      const existing = limits.find(l => l.category === c);
      m[c] = existing ? Number(existing.monthly_limit) : DEFAULT_BUDGETS[c];
    });
    /* also include any saved categories not in defaults */
    limits.forEach(l => {
      if (!(l.category in m)) m[l.category] = Number(l.monthly_limit);
    });
    return m;
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(vals);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-800 px-6 py-5">
          <h2 className="text-white font-extrabold text-lg tracking-tight">Monthly Budgets</h2>
          <p className="text-indigo-300/70 text-xs mt-0.5">Tier-2 · Firozabad · ₹90k household</p>
        </div>
        {/* body */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-3">
          {Object.entries(vals).map(([cat, val]) => (
            <div key={cat} className="flex items-center gap-3">
              <span className="flex-1 text-sm font-medium text-slate-700 truncate">{cat}</span>
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
                <span className="text-slate-400 text-sm">₹</span>
                <input type="number" min="0" step="100"
                  value={val}
                  onChange={e => setVals(v => ({...v, [cat]: Number(e.target.value)}))}
                  className="w-24 text-sm font-bold text-slate-800 bg-transparent outline-none text-right tabular-nums"/>
              </div>
            </div>
          ))}
        </div>
        {/* footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Total: <span className="font-bold text-slate-700">{formatCurrency(Object.values(vals).reduce((s,v)=>s+v,0))}/mo</span>
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center gap-2">
              {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>}
              Save Budgets
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════ MAIN COMPONENT ═══ */
export default function ExpenseAnalytics() {
  const qc = useQueryClient();
  const [range, setRange] = useState({ from_date: getMonthStart(), to_date: getToday() });
  const [aiResult, setAiResult] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState(null);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetMonth] = useState(getMonthYM);

  function resetSel() { setSelectedCategory(null); setSelectedSubCategory(null); }

  /* ── data queries ── */
  const { data, isLoading } = useQuery({
    queryKey: ["expense-analytics", range],
    queryFn: async () => {
      const p = {};
      if (range.from_date) p.from_date = range.from_date;
      if (range.to_date)   p.to_date   = range.to_date;
      return (await api.get("/api/expenses/analytics/summary", { params: p })).data;
    },
  });

  /* previous month for comparison stat */
  const prevMonthRange = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0");
    const last = new Date(d.getFullYear(), d.getMonth()+1, 0);
    return { from: `${y}-${m}-01`, to: last.toISOString().split("T")[0] };
  }, []);

  const { data: prevData } = useQuery({
    queryKey: ["expense-analytics-prev", prevMonthRange],
    queryFn: async () =>
      (await api.get("/api/expenses/analytics/summary", { params: { from_date: prevMonthRange.from, to_date: prevMonthRange.to } })).data,
    staleTime: 5 * 60 * 1000,
  });

  /* budget vs actual */
  const { data: budgetData, refetch: refetchBudget } = useQuery({
    queryKey: ["budget-vs-actual", budgetMonth],
    queryFn: async () =>
      (await api.get("/api/category-limits/budget-vs-actual", { params: { month: budgetMonth } })).data,
    staleTime: 60 * 1000,
  });

  /* saved limits list (for the modal) */
  const { data: savedLimits = [] } = useQuery({
    queryKey: ["category-limits"],
    queryFn: async () => (await api.get("/api/category-limits")).data,
    staleTime: 60 * 1000,
  });

  /* ai analysis */
  const aiMutation = useMutation({
    mutationFn: async () =>
      (await api.post("/api/analytics/ai-expense-analysis", {
        from_date: range.from_date || "2020-01-01",
        to_date:   range.to_date   || getToday(),
      })).data,
    onSuccess: r => setAiResult(r),
  });

  /* subcategory transaction glance */
  const { data: subTxns, isFetching: subTxnsLoading } = useQuery({
    queryKey: ["sub-txns", selectedCategory, selectedSubCategory, range],
    queryFn: async () => {
      const p = { category: selectedCategory, sub_category: selectedSubCategory, limit: 50 };
      if (range.from_date) p.from_date = range.from_date;
      if (range.to_date)   p.to_date   = range.to_date;
      return (await api.get("/api/expenses", { params: p })).data;
    },
    enabled: !!(selectedCategory && selectedSubCategory),
  });

  /* save budgets handler */
  const saveBudgets = useCallback(async (vals) => {
    await Promise.all(
      Object.entries(vals).map(([category, monthly_limit]) =>
        api.post("/api/category-limits", { category, monthly_limit, rollover_enabled: false })
      )
    );
    qc.invalidateQueries({ queryKey: ["category-limits"] });
    qc.invalidateQueries({ queryKey: ["budget-vs-actual"] });
    refetchBudget();
  }, [qc, refetchBudget]);

  /* ── derived values ── */
  const categories    = data?.categories      || [];
  const subCategories = data?.sub_categories  || {};
  const monthly       = data?.monthly         || [];
  const modes         = data?.payment_modes   || [];
  const accounts      = data?.accounts        || [];
  const peakDay       = data?.peak_day;
  const peakWeek      = data?.peak_week;
  const grandTotal    = Number(data?.grand_total || 0);
  const prevTotal     = Number(prevData?.grand_total || 0);
  const expenseCount  = data?.expense_count || 0;
  const dailyRaw      = data?.daily || [];

  /* month-over-month change */
  const momPct = prevTotal > 0 ? ((grandTotal - prevTotal) / prevTotal) * 100 : null;
  const avgPerTxn = expenseCount > 0 ? grandTotal / expenseCount : 0;

  /* largest single-day */
  const biggestDay = peakDay ? Number(peakDay.total) : 0;

  /* daily area chart — sorted by date */
  const dailyChartData = useMemo(() => {
    const sorted = [...dailyRaw].sort((a,b) => a.date.localeCompare(b.date));
    return sorted.map(d => ({
      date: new Date(d.date).toLocaleDateString("en-IN",{day:"numeric",month:"short"}),
      amount: Number(d.total),
      count: d.count,
    }));
  }, [dailyRaw]);

  const accountIdToName = useMemo(() => {
    const m = {};
    accounts.forEach(a => { if (a.account_id != null) m[a.account_id] = a.name; });
    return m;
  }, [accounts]);

  const donutData = useMemo(() =>
    categories.map((c,i) => ({ name:c.category, value:Number(c.total), color:PALETTE[i%PALETTE.length] })),
    [categories]);

  const barData = useMemo(() =>
    monthly.map(m => ({
      month: new Date(m.month+"-01").toLocaleDateString("en-IN",{month:"short",year:"2-digit"}),
      amount: Number(m.total),
    })), [monthly]);

  const subDonutData = useMemo(() => {
    if (!selectedCategory) return [];
    return (subCategories[selectedCategory]||[]).map((s,i) => ({
      name:s.sub_category, value:Number(s.total), count:s.count,
      color:PALETTE[(i+4)%PALETTE.length],
    }));
  }, [selectedCategory, subCategories]);

  const categoryColorMap = useMemo(() => {
    const m = {}; donutData.forEach(d => { m[d.name]=d.color; }); return m;
  }, [donutData]);

  const modeBarData = useMemo(() =>
    modes.map((m,i) => ({
      name: MODE_LABELS[m.mode] || m.mode.replaceAll("_"," "),
      amount: Number(m.total), count: m.count,
      icon: MODE_ICONS[m.mode] || "💳", color: PALETTE[i%PALETTE.length],
    })), [modes]);

  const accountBarData = useMemo(() =>
    accounts.map((a,i) => ({
      name:a.name, amount:Number(a.total), count:a.count,
      color:PALETTE[(i+3)%PALETTE.length],
    })), [accounts]);

  /* budget vs actual bar chart data */
  const budgetBarData = useMemo(() => {
    if (!budgetData?.categories) return [];
    return budgetData.categories
      .filter(c => c.budget > 0 || c.actual > 0)
      .sort((a,b) => Number(b.actual) - Number(a.actual))
      .map(c => ({
        name: c.category.length > 14 ? c.category.split(" ")[0] : c.category,
        fullName: c.category,
        budget: Number(c.budget),
        actual: Number(c.actual),
        over: Number(c.actual) > Number(c.budget) && Number(c.budget) > 0,
        pct: c.pct_used,
      }));
  }, [budgetData]);

  const aiPieData = useMemo(() =>
    (aiResult?.ai_pie_data||[]).map((t,i) => ({
      name:t.name, value:Number(t.amount), count:t.count,
      insight:t.insight, color:AI_PALETTE[i%AI_PALETTE.length],
    })), [aiResult]);

  /* ── hero stats ── */
  const heroStats = useMemo(() => {
    const overBudget = budgetData?.categories
      ? budgetData.categories.filter(c => c.pct_used != null && c.pct_used > 100).length
      : 0;
    const savedVsBudget = budgetData?.total_budget
      ? Number(budgetData.total_budget) - Number(budgetData.total_actual || 0)
      : null;
    return { overBudget, savedVsBudget };
  }, [budgetData]);

  /* ════════════════════════════════════════════ RENDER ═══ */
  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── DARK HERO HEADER ─────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 px-4 sm:px-6 pt-6 pb-16">
        {/* decorative blobs */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl"/>
        <div className="pointer-events-none absolute -bottom-28 -left-12 w-72 h-72 rounded-full bg-violet-600/10 blur-3xl"/>

        <div className="relative max-w-7xl mx-auto">
          {/* title row */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-indigo-300/70 text-xs font-semibold uppercase tracking-widest mb-1">Expense Analytics</p>
              <h1 className="text-white text-3xl sm:text-4xl font-extrabold tracking-tight">
                {isLoading ? "—" : formatCurrency(grandTotal)}
              </h1>
              <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                {momPct !== null && (
                  <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${momPct > 0 ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                    {momPct > 0 ? "↑" : "↓"} {Math.abs(momPct).toFixed(1)}% vs last month
                  </span>
                )}
                {!isLoading && <span className="text-indigo-300/60 text-xs">{expenseCount} transactions</span>}
              </div>
            </div>
            <button
              onClick={() => aiMutation.mutate()} disabled={aiMutation.isPending}
              className="self-start inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/20 text-white text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-60">
              {aiMutation.isPending
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Analysing…</>
                : <>🧠 AI Analysis</>}
            </button>
          </div>

          {/* HERO GLASS STAT CARDS */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Avg / transaction */}
            <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-2xl px-4 py-3.5">
              <p className="text-indigo-300/70 text-[10px] font-bold uppercase tracking-widest">Avg per Txn</p>
              <p className="text-white text-xl font-extrabold mt-1 tracking-tight">{formatCurrency(avgPerTxn)}</p>
              <p className="text-indigo-300/50 text-[10px] mt-0.5">{expenseCount} transactions</p>
            </div>
            {/* MoM change */}
            <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-2xl px-4 py-3.5">
              <p className="text-indigo-300/70 text-[10px] font-bold uppercase tracking-widest">vs Last Month</p>
              <p className={`text-xl font-extrabold mt-1 tracking-tight ${momPct === null ? "text-white" : momPct > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                {momPct === null ? "—" : `${momPct > 0 ? "+" : ""}${momPct.toFixed(1)}%`}
              </p>
              <p className="text-indigo-300/50 text-[10px] mt-0.5">{formatCurrency(prevTotal)} last month</p>
            </div>
            {/* Biggest day */}
            <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-2xl px-4 py-3.5">
              <p className="text-indigo-300/70 text-[10px] font-bold uppercase tracking-widest">Biggest Day</p>
              <p className="text-white text-xl font-extrabold mt-1 tracking-tight">{formatCurrency(biggestDay)}</p>
              {peakDay && <p className="text-indigo-300/50 text-[10px] mt-0.5">{new Date(peakDay.date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</p>}
            </div>
            {/* Budget health */}
            <div className={`bg-white/[0.07] backdrop-blur-xl border rounded-2xl px-4 py-3.5 ${heroStats.overBudget > 0 ? "border-rose-400/30" : "border-white/[0.12]"}`}>
              <p className="text-indigo-300/70 text-[10px] font-bold uppercase tracking-widest">Over Budget</p>
              <p className={`text-xl font-extrabold mt-1 tracking-tight ${heroStats.overBudget > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                {heroStats.overBudget} {heroStats.overBudget === 1 ? "category" : "categories"}
              </p>
              {heroStats.savedVsBudget !== null && (
                <p className={`text-[10px] mt-0.5 ${heroStats.savedVsBudget >= 0 ? "text-emerald-400/70" : "text-rose-400/70"}`}>
                  {heroStats.savedVsBudget >= 0 ? `₹${Math.round(heroStats.savedVsBudget/1000)}k under budget` : `₹${Math.round(Math.abs(heroStats.savedVsBudget)/1000)}k over budget`}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY overlapping hero ─────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 -mt-6 pb-16 relative z-10 space-y-0">

        {/* DATE RANGE CONTROLS */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-50 rounded-xl px-3 py-1.5 border border-slate-200">
            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <input type="date" value={range.from_date}
              onChange={e=>{ setRange(r=>({...r,from_date:e.target.value})); resetSel(); }}
              className="text-xs text-slate-700 bg-transparent outline-none border-none w-[116px]"/>
            <span className="text-slate-300 text-xs">—</span>
            <input type="date" value={range.to_date}
              onChange={e=>{ setRange(r=>({...r,to_date:e.target.value})); resetSel(); }}
              className="text-xs text-slate-700 bg-transparent outline-none border-none w-[116px]"/>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => {
              const active = range.from_date===p.from && range.to_date===p.to;
              return (
                <button key={p.label}
                  onClick={() => { setRange({from_date:p.from,to_date:p.to}); resetSel(); }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${active ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-28 gap-3 mt-8">
            <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"/>
            <p className="text-sm text-slate-400">Loading analytics…</p>
          </div>
        ) : (
          <>

            {/* ── DAY-WISE EXPENSE CURVE ────────────── */}
            {dailyChartData.length > 1 && (
              <>
                <SectionTitle color="bg-violet-500">Day-wise Spending Curve</SectionTitle>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dailyChartData} margin={{top:4,right:4,left:-16,bottom:4}}>
                        <defs>
                          <linearGradient id="dayGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35}/>
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.07}/>
                        <XAxis dataKey="date" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}
                          interval={Math.floor(dailyChartData.length/6)}/>
                        <YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}
                          tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                        <Tooltip content={<DarkTooltip/>}/>
                        <Area type="monotone" dataKey="amount" name="Spent"
                          stroke="#8b5cf6" strokeWidth={2.5} fill="url(#dayGrad)" dot={false}
                          activeDot={{r:5,fill:"#8b5cf6",stroke:"#fff",strokeWidth:2}}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            {/* ── BUDGET vs ACTUAL ─────────────────── */}
            <SectionTitle color="bg-emerald-500"
              action={
                <button onClick={() => setBudgetModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl transition-colors border border-indigo-100">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  Edit Budgets
                </button>
              }>
              Budget vs Actual <span className="text-slate-400 font-normal normal-case text-xs ml-1">(this month)</span>
            </SectionTitle>

            {budgetBarData.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-indigo-200 p-8 text-center">
                <p className="text-sm text-slate-500 mb-3">No budgets set yet.</p>
                <button onClick={() => setBudgetModalOpen(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors">
                  Set Up Budgets
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {/* bar chart */}
                <Card>
                  <div className="flex items-center gap-4 text-xs mb-3">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-400 inline-block"/>Budget</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-rose-400 inline-block"/>Actual</span>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={budgetBarData} margin={{top:4,right:4,left:-18,bottom:4}} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.07} vertical={false}/>
                        <XAxis dataKey="name" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}
                          tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="bg-slate-800 text-white text-xs rounded-xl px-3 py-2.5 shadow-xl border border-slate-700">
                                <p className="font-bold mb-2 text-slate-200">{d.fullName}</p>
                                <p className="flex justify-between gap-4"><span className="text-emerald-400">Budget</span><span className="font-bold">{formatCurrency(d.budget)}</span></p>
                                <p className="flex justify-between gap-4"><span className={d.over ? "text-rose-400" : "text-slate-300"}>Actual</span><span className="font-bold">{formatCurrency(d.actual)}</span></p>
                                {d.pct != null && <p className="flex justify-between gap-4 mt-1 border-t border-slate-700 pt-1"><span className="text-slate-400">Used</span><span className={d.over ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{d.pct.toFixed(0)}%</span></p>}
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="budget" name="Budget" radius={[4,4,0,0]} fill="#34d399" maxBarSize={28}/>
                        <Bar dataKey="actual" name="Actual" radius={[4,4,0,0]} maxBarSize={28}
                          fill="#f87171"
                          label={false}>
                          {budgetBarData.map((d,i) => (
                            <Cell key={i} fill={d.over ? "#ef4444" : "#f87171"} fillOpacity={d.over ? 1 : 0.7}/>
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* detailed category rows */}
                <Card>
                  <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                    {budgetBarData.map(d => {
                      const pct = d.budget > 0 ? Math.min((d.actual/d.budget)*100, 100) : 0;
                      const rawPct = d.budget > 0 ? (d.actual/d.budget)*100 : null;
                      const color = rawPct == null ? "#94a3b8" : rawPct > 100 ? "#ef4444" : rawPct > 80 ? "#f59e0b" : "#10b981";
                      return (
                        <div key={d.fullName}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-semibold text-slate-700 truncate max-w-[160px]">{d.fullName}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-slate-400 tabular-nums">{formatCurrency(d.actual)}</span>
                              <span className="text-[11px] text-slate-300">/</span>
                              <span className="text-xs font-bold tabular-nums" style={{color}}>{formatCurrency(d.budget)}</span>
                              {rawPct !== null && (
                                <span className={`text-[11px] font-bold tabular-nums ${rawPct > 100 ? "text-rose-500" : rawPct > 80 ? "text-amber-500" : "text-emerald-500"}`}>
                                  {rawPct.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </div>
                          <ProgressBar pct={pct} color={color} h="h-2"/>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {/* ── CATEGORY DONUT + MONTHLY TREND ──── */}
            <SectionTitle color="bg-indigo-500">Spending by Category</SectionTitle>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Card>
                <p className="text-[11px] text-slate-400 mb-3">Click a category to drill into sub-categories</p>
                {donutData.length === 0 ? <EmptyState text="No category data"/> : (
                  <div className="flex items-center gap-5">
                    <div className="w-44 h-44 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={44} outerRadius={82}
                            paddingAngle={2} dataKey="value" stroke="none"
                            onClick={e => { const n=e.name===selectedCategory?null:e.name; setSelectedCategory(n); setSelectedSubCategory(null); }}>
                            {donutData.map((d,i) => (
                              <Cell key={i} fill={d.color}
                                opacity={selectedCategory && selectedCategory!==d.name ? 0.2 : 1}
                                style={{cursor:"pointer",transition:"opacity .2s"}}/>
                            ))}
                          </Pie>
                          <Tooltip content={<DarkTooltip/>}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-0.5 max-h-52 overflow-y-auto pr-1">
                      {donutData.map(d => {
                        const pct = grandTotal > 0 ? (d.value/grandTotal*100).toFixed(1) : "0";
                        const isSel = selectedCategory === d.name;
                        return (
                          <button key={d.name}
                            onClick={() => { setSelectedCategory(isSel?null:d.name); setSelectedSubCategory(null); }}
                            className={`w-full flex items-center gap-2 text-xs rounded-xl px-2.5 py-1.5 transition-all border ${isSel ? "bg-indigo-50 border-indigo-200" : "border-transparent hover:bg-slate-50"}`}>
                            <div className="w-2 h-2 rounded-full shrink-0" style={{background:d.color}}/>
                            <span className="text-slate-600 truncate flex-1 text-left font-medium">{d.name}</span>
                            <span className="text-slate-400 shrink-0 tabular-nums">{pct}%</span>
                            <span className="font-bold text-slate-800 shrink-0 w-20 text-right tabular-nums">{formatCurrency(d.value)}</span>
                            {subCategories[d.name]?.length>0 && <span className="text-indigo-300 text-[9px] shrink-0">{isSel?"▲":"▼"}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>

              <Card>
                <p className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4">Monthly Trend</p>
                {barData.length === 0 ? <EmptyState text="No monthly data"/> : (
                  <div className="h-[196px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{top:4,right:4,left:-18,bottom:4}}>
                        <defs>
                          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1"/>
                            <stop offset="100%" stopColor="#a5b4fc"/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.07}/>
                        <XAxis dataKey="month" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}
                          tickFormatter={v=>v>=100000?`${(v/100000).toFixed(1)}L`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                        <Tooltip content={<DarkTooltip/>}/>
                        <Bar dataKey="amount" name="Spent" fill="url(#barGrad)" radius={[6,6,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>

            {/* ── PEAK CARDS ───────────────────────── */}
            {(peakWeek||peakDay) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                {peakWeek && (
                  <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5">
                    <div className="absolute -right-3 -top-3 text-7xl opacity-[0.07] select-none">🔥</div>
                    <p className="text-[11px] font-bold text-amber-600 uppercase tracking-widest mb-1">🔥 Hottest Week</p>
                    <p className="text-2xl font-extrabold text-slate-900">{formatCurrency(Number(peakWeek.total))}</p>
                    <p className="text-xs text-slate-500 mt-1">{peakWeek.label} · {peakWeek.count} transactions</p>
                  </div>
                )}
                {peakDay && (
                  <div className="relative overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 p-5">
                    <div className="absolute -right-3 -top-3 text-7xl opacity-[0.07] select-none">📅</div>
                    <p className="text-[11px] font-bold text-rose-600 uppercase tracking-widest mb-1">📅 Most Expensive Day</p>
                    <p className="text-2xl font-extrabold text-slate-900">{formatCurrency(Number(peakDay.total))}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {new Date(peakDay.date).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})} · {peakDay.count} txns
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── SUB-CATEGORY DRILL-DOWN ──────────── */}
            {selectedCategory && (
              <div className="rounded-2xl border-2 border-indigo-200 bg-white shadow-md overflow-hidden mt-2">
                <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-indigo-50 to-violet-50 border-b border-indigo-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full ring-2 ring-white shadow" style={{background:categoryColorMap[selectedCategory]}}/>
                    <span className="text-sm font-bold text-slate-800">{selectedCategory}</span>
                    <span className="text-xs text-slate-400">
                      {formatCurrency(categories.find(c=>c.category===selectedCategory)?.total)} · {categories.find(c=>c.category===selectedCategory)?.count} txns
                    </span>
                  </div>
                  <button onClick={() => { setSelectedCategory(null); setSelectedSubCategory(null); }}
                    className="text-slate-400 hover:text-slate-700 px-2.5 py-1 text-xs font-semibold transition-all hover:bg-white/80 rounded-lg">
                    ✕ Close
                  </button>
                </div>
                <div className="p-5">
                  {subDonutData.length === 0 ? <EmptyState text="No sub-category data"/> : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={subDonutData} cx="50%" cy="50%" innerRadius={38} outerRadius={80}
                              paddingAngle={2} dataKey="value" stroke="none">
                              {subDonutData.map((d,i) => (
                                <Cell key={i} fill={d.color} opacity={selectedSubCategory && selectedSubCategory!==d.name ? 0.25 : 1}/>
                              ))}
                            </Pie>
                            <Tooltip content={<DarkTooltip/>}/>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-1.5">
                        {subDonutData.map(d => {
                          const catTotal = Number(categories.find(c=>c.category===selectedCategory)?.total || 1);
                          const pct = ((d.value/catTotal)*100).toFixed(1);
                          const isOpen = selectedSubCategory === d.name;
                          return (
                            <div key={d.name} className="rounded-xl overflow-hidden">
                              <button
                                onClick={() => setSelectedSubCategory(isOpen ? null : d.name)}
                                className={`w-full text-left px-3 py-2 transition-all rounded-xl border ${isOpen ? "bg-indigo-50 border-indigo-200" : "bg-slate-50/80 border-transparent hover:bg-white hover:border-slate-200"}`}>
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{background:d.color}}/>
                                    <span className="text-xs font-semibold text-slate-700 truncate">{d.name}</span>
                                    <Badge>{d.count} txns</Badge>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-xs font-bold text-slate-800 tabular-nums">{formatCurrency(d.value)}</span>
                                    <span className="text-[10px] text-slate-400">{pct}%</span>
                                    <span className="text-[10px] text-indigo-400">{isOpen?"▲":"▼"}</span>
                                  </div>
                                </div>
                                <ProgressBar pct={Number(pct)} color={d.color}/>
                              </button>
                              {isOpen && (
                                <div className="mx-0.5 mb-0.5 border border-indigo-100 rounded-b-xl bg-white overflow-hidden shadow-sm">
                                  {subTxnsLoading ? (
                                    <div className="flex justify-center py-5">
                                      <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"/>
                                    </div>
                                  ) : (subTxns||[]).length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center py-5">No transactions found</p>
                                  ) : (
                                    <div className="max-h-52 overflow-y-auto">
                                      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 py-2 bg-slate-50/80 sticky top-0 border-b border-slate-100">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Description</span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account</span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Amount</span>
                                      </div>
                                      {(subTxns||[]).map(tx => {
                                        const acName = accountIdToName[tx.account_id] || null;
                                        return (
                                          <div key={tx.id}
                                            className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50/50 transition-colors items-center">
                                            <span className="text-xs text-slate-700 truncate" title={tx.description||"—"}>{tx.description||"—"}</span>
                                            {acName
                                              ? <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-full whitespace-nowrap">{acName}</span>
                                              : <span className="text-[11px] text-slate-300 text-center">—</span>}
                                            <span className="text-xs font-bold text-rose-500 tabular-nums text-right whitespace-nowrap">{formatCurrency(tx.amount)}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── ACCOUNT & PAYMENT METHOD ─────────── */}
            {(accountBarData.length > 0 || modeBarData.length > 0) && (
              <>
                <SectionTitle color="bg-teal-500">Accounts & Payment Methods</SectionTitle>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  {accountBarData.length > 0 && (
                    <Card>
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4">💳 By Account</p>
                      <div className="space-y-4">
                        {accountBarData.map(a => {
                          const pct = grandTotal > 0 ? ((a.amount/grandTotal)*100).toFixed(1) : "0";
                          return (
                            <div key={a.name}>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{background:a.color}}/>
                                  <span className="text-sm font-semibold text-slate-700">{a.name}</span>
                                  <Badge>{a.count} txns</Badge>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-sm font-extrabold text-slate-900 tabular-nums">{formatCurrency(a.amount)}</span>
                                  <span className="text-xs text-slate-400">{pct}%</span>
                                </div>
                              </div>
                              <ProgressBar pct={Number(pct)} color={a.color} h="h-2.5"/>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}
                  {modeBarData.length > 0 && (
                    <Card>
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4">📲 Payment Method</p>
                      <div className="space-y-4">
                        {modeBarData.map(m => {
                          const pct = grandTotal > 0 ? ((m.amount/grandTotal)*100).toFixed(1) : "0";
                          return (
                            <div key={m.name}>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-base leading-none">{m.icon}</span>
                                  <span className="text-sm font-semibold text-slate-700">{m.name}</span>
                                  <Badge>{m.count} txns</Badge>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-sm font-extrabold text-slate-900 tabular-nums">{formatCurrency(m.amount)}</span>
                                  <span className="text-xs text-slate-400">{pct}%</span>
                                </div>
                              </div>
                              <ProgressBar pct={Number(pct)} color={m.color} h="h-2.5"/>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}
                </div>
              </>
            )}

            {/* ── AI ANALYSIS ──────────────────────── */}
            {aiResult?.status === "ok" && (
              <>
                <SectionTitle color="bg-violet-500">
                  AI Analysis
                  {aiResult.ai_powered && <Badge cls="bg-violet-100 text-violet-600 ml-2">✶ Gemini</Badge>}
                </SectionTitle>

                {aiResult.narrative && (
                  <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-5 shadow-lg shadow-indigo-200/50">
                    <p className="text-sm text-white/90 leading-relaxed">💬 {aiResult.narrative}</p>
                  </div>
                )}

                {aiPieData.length > 0 && (
                  <Card>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-widest">🎨 Lifestyle Themes</p>
                      <Badge cls="bg-violet-100 text-violet-600">Gemini-generated</Badge>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">AI grouped expenses by lifestyle theme — not standard accounting categories.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={aiPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={100}
                              paddingAngle={3} dataKey="value" stroke="none">
                              {aiPieData.map((d,i) => <Cell key={i} fill={d.color}/>)}
                            </Pie>
                            <Tooltip content={<DarkTooltip/>}/>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                        {aiPieData.map(t => {
                          const tot = aiPieData.reduce((s,x)=>s+x.value,0)||1;
                          const pct = ((t.value/tot)*100).toFixed(1);
                          return (
                            <div key={t.name} className="flex items-start gap-2.5">
                              <div className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{background:t.color}}/>
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-bold text-slate-800">{t.name}</span>
                                  <span className="text-sm font-extrabold text-slate-900 tabular-nums">{formatCurrency(t.value)}</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{t.insight}</p>
                                <ProgressBar pct={Number(pct)} color={t.color}/>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Card>
                )}

                {aiResult.insights?.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {aiResult.insights.map((ins,i) => (
                      <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xl">{ins.icon}</span>
                          <span className="text-xs font-bold text-slate-700">{ins.title}</span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">{ins.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {aiResult.flags?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-widest">Flags &amp; Alerts</p>
                    {aiResult.flags.map((flag,i) => (
                      <div key={i} className={`rounded-xl border px-4 py-3 ${SEVERITY_STYLES[flag.severity]||SEVERITY_STYLES.info}`}>
                        <p className="text-sm font-semibold">{flag.title}</p>
                        <p className="text-xs mt-0.5 opacity-75">{flag.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                {aiResult.suggestions?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-widest">Suggestions</p>
                    {aiResult.suggestions.map((s,i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3 flex items-start gap-3 hover:shadow-md transition-shadow">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"/>
                        <div>
                          <span className="text-xs font-bold text-indigo-600">{s.category}</span>
                          <p className="text-xs text-slate-600 mt-0.5">{s.suggestion}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {aiResult?.status === "no_data" && (
              <Card><p className="text-sm text-slate-500 text-center py-4">{aiResult.message}</p></Card>
            )}

          </>
        )}
      </div>

      {/* ── BUDGET MODAL ─────────────────────────── */}
      {budgetModalOpen && (
        <BudgetModal
          limits={savedLimits}
          onClose={() => setBudgetModalOpen(false)}
          onSave={saveBudgets}
        />
      )}
    </div>
  );
}
'''

target = "/Users/amolsaxena/Downloads/Advanced_Finance_Tracker/frontend/src/pages/Analytics/ExpenseAnalytics.jsx"
with open(target, "w", encoding="utf-8") as f:
    f.write(jsx)

lines = jsx.count("\n")
print(f"Written {lines} lines to {target}")
checks = [
  ("Dark hero header", "from-slate-900 via-indigo-950 to-slate-800" in jsx),
  ("GlassCard hero stats", "backdrop-blur-xl border border-white" in jsx),
  ("MoM change badge", "momPct" in jsx),
  ("Day-wise AreaChart", "AreaChart" in jsx),
  ("Budget vs Actual chart", "budget-vs-actual" in jsx),
  ("Budget bar chart", "budgetBarData" in jsx),
  ("Edit Budgets button", "Edit Budgets" in jsx),
  ("Budget modal", "BudgetModal" in jsx),
  ("DEFAULT_BUDGETS", "DEFAULT_BUDGETS" in jsx),
  ("SectionTitle with dot", "SectionDot" in jsx),
  ("DarkTooltip", "DarkTooltip" in jsx),
  ("Sub-category txn glance", "accountIdToName" in jsx),
  ("Current month default", "getMonthStart()" in jsx),
]
for label, result in checks:
    print(f"  {'✓' if result else '✗'} {label}")
