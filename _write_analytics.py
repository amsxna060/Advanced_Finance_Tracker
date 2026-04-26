
jsx = r'''import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

/* ─── palettes / constants ─────────────────────────────────────────────────── */
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
  info:    "bg-blue-50 border-blue-200 text-blue-800",
  error:   "bg-red-50 border-red-200 text-red-800",
};

/* ─── date helpers ─────────────────────────────────────────────────────────── */
function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
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

/* ─── tiny shared components ───────────────────────────────────────────────── */
function Badge({ children, cls = "bg-slate-100 text-slate-500" }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{children}</span>;
}

function ProgressBar({ pct, color, h = "h-2" }) {
  return (
    <div className={`${h} bg-slate-100 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-700`} style={{ width:`${Math.min(pct,100)}%`, backgroundColor:color }}/>
    </div>
  );
}

function Card({ children, className="" }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 p-5 ${className}`}>{children}</div>;
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

/* ─── main component ───────────────────────────────────────────────────────── */
export default function ExpenseAnalytics() {
  // Default to current month — not 6 months
  const [range, setRange] = useState({ from_date: getMonthStart(), to_date: getToday() });
  const [aiResult, setAiResult] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState(null);

  function resetSel() { setSelectedCategory(null); setSelectedSubCategory(null); }

  /* analytics summary */
  const { data, isLoading } = useQuery({
    queryKey: ["expense-analytics", range],
    queryFn: async () => {
      const p = {};
      if (range.from_date) p.from_date = range.from_date;
      if (range.to_date)   p.to_date   = range.to_date;
      return (await api.get("/api/expenses/analytics/summary", { params: p })).data;
    },
  });

  /* ai analysis */
  const aiMutation = useMutation({
    mutationFn: async () =>
      (await api.post("/api/analytics/ai-expense-analysis", {
        from_date: range.from_date || "2020-01-01",
        to_date:   range.to_date   || getToday(),
      })).data,
    onSuccess: (r) => setAiResult(r),
  });

  /* subcategory transaction glance — fires when a subcategory row is expanded */
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

  /* derived */
  const categories   = data?.categories     || [];
  const subCategories= data?.sub_categories || {};
  const monthly      = data?.monthly        || [];
  const modes        = data?.payment_modes  || [];
  const accounts     = data?.accounts       || [];
  const peakDay      = data?.peak_day;
  const peakWeek     = data?.peak_week;
  const grandTotal   = Number(data?.grand_total || 0);

  /* account_id → name (analytics summary already carries account_id per account row) */
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
      name: a.name, amount: Number(a.total), count: a.count,
      color: PALETTE[(i+3)%PALETTE.length],
    })), [accounts]);

  const aiPieData = useMemo(() =>
    (aiResult?.ai_pie_data||[]).map((t,i) => ({
      name:t.name, value:Number(t.amount), count:t.count,
      insight:t.insight, color:AI_PALETTE[i%AI_PALETTE.length],
    })), [aiResult]);

  /* ── render ───────────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-indigo-50/20">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        {/* page header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Expense Analytics</h1>
            <p className="text-sm text-slate-500 mt-0.5">Deep-dive into your spending patterns</p>
          </div>
          <button
            onClick={() => aiMutation.mutate()} disabled={aiMutation.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-200/60 disabled:opacity-60 transition-all active:scale-95">
            {aiMutation.isPending
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Analysing…</>
              : <>🧠 AI Analysis</>}
          </button>
        </div>

        {/* date controls */}
        <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-200/80 shadow-sm p-3 flex flex-wrap items-center gap-2">
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

        {/* loading */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-28 gap-3">
            <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"/>
            <p className="text-sm text-slate-400">Loading analytics…</p>
          </div>
        ) : (
          <div className="space-y-5">

            {/* ── stat cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total Spent"   value={formatCurrency(grandTotal)}  valueClass="text-red-500"     icon="💸" iconBg="bg-red-50"/>
              <StatCard label="Transactions"  value={data?.expense_count||0}       valueClass="text-slate-800"   icon="🔢" iconBg="bg-slate-50"/>
              <StatCard label="Categories"    value={categories.length}            valueClass="text-indigo-600"  icon="🗂️" iconBg="bg-indigo-50"/>
              <StatCard label="Avg / Entry"   value={formatCurrency(data?.expense_count ? grandTotal/data.expense_count : 0)} valueClass="text-emerald-600" icon="📊" iconBg="bg-emerald-50"/>
            </div>

            {/* ── peak week & day ── */}
            {(peakWeek||peakDay) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      {new Date(peakDay.date).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"})} · {peakDay.count} txns
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── category donut + monthly trend ── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {/* category donut */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Spending by Category</h2>
                  <span className="text-[11px] text-slate-400">Click to drill down</span>
                </div>
                {donutData.length === 0 ? <EmptyState text="No category data"/> : (
                  <div className="flex items-center gap-5">
                    <div className="w-48 h-48 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={46} outerRadius={86}
                            paddingAngle={2} dataKey="value" stroke="none"
                            onClick={e => { const n=e.name===selectedCategory?null:e.name; setSelectedCategory(n); setSelectedSubCategory(null); }}>
                            {donutData.map((d,i) => (
                              <Cell key={i} fill={d.color}
                                opacity={selectedCategory && selectedCategory!==d.name ? 0.22 : 1}
                                style={{cursor:"pointer",transition:"opacity .2s"}}/>
                            ))}
                          </Pie>
                          <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:"12px",border:"1px solid #e2e8f0",fontSize:"12px",boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-0.5 max-h-52 overflow-y-auto pr-1">
                      {donutData.map(d => {
                        const pct = grandTotal>0 ? (d.value/grandTotal*100).toFixed(1) : "0";
                        const isSel = selectedCategory === d.name;
                        return (
                          <button key={d.name}
                            onClick={() => { setSelectedCategory(isSel?null:d.name); setSelectedSubCategory(null); }}
                            className={`w-full flex items-center gap-2 text-xs rounded-xl px-2.5 py-1.5 transition-all ${isSel ? "bg-indigo-50 ring-1 ring-indigo-300" : "hover:bg-slate-50"}`}>
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

              {/* monthly trend */}
              <Card>
                <h2 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4">Monthly Trend</h2>
                {barData.length === 0 ? <EmptyState text="No monthly data"/> : (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{top:4,right:4,left:-18,bottom:4}}>
                        <defs>
                          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1"/>
                            <stop offset="100%" stopColor="#a5b4fc"/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.08}/>
                        <XAxis dataKey="month" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false}
                          tickFormatter={v=>v>=100000?`${(v/100000).toFixed(1)}L`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                        <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:"12px",border:"1px solid #e2e8f0",fontSize:"12px",boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}/>
                        <Bar dataKey="amount" fill="url(#barGrad)" radius={[6,6,0,0]} name="Spent"/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>

            {/* ── sub-category drill-down ── */}
            {selectedCategory && (
              <div className="rounded-2xl border-2 border-indigo-200 bg-white shadow-md overflow-hidden">
                {/* header strip */}
                <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-indigo-50 to-violet-50 border-b border-indigo-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded-full ring-2 ring-white shadow" style={{background:categoryColorMap[selectedCategory]}}/>
                    <span className="text-sm font-bold text-slate-800">{selectedCategory}</span>
                    <span className="text-xs text-slate-400">
                      {formatCurrency(categories.find(c=>c.category===selectedCategory)?.total)} · {categories.find(c=>c.category===selectedCategory)?.count} txns
                    </span>
                  </div>
                  <button
                    onClick={() => { setSelectedCategory(null); setSelectedSubCategory(null); }}
                    className="text-slate-400 hover:text-slate-700 hover:bg-white/80 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all">
                    ✕ Close
                  </button>
                </div>

                <div className="p-5">
                  {subDonutData.length === 0 ? <EmptyState text="No sub-category data"/> : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* sub-category donut */}
                      <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={subDonutData} cx="50%" cy="50%" innerRadius={38} outerRadius={80}
                              paddingAngle={2} dataKey="value" stroke="none">
                              {subDonutData.map((d,i) => (
                                <Cell key={i} fill={d.color}
                                  opacity={selectedSubCategory && selectedSubCategory!==d.name ? 0.25 : 1}/>
                              ))}
                            </Pie>
                            <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:"12px",border:"1px solid #e2e8f0",fontSize:"12px",boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}/>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>

                      {/* sub-category rows — click to expand transaction glance */}
                      <div className="space-y-1.5">
                        {subDonutData.map(d => {
                          const catTotal = Number(categories.find(c=>c.category===selectedCategory)?.total || 1);
                          const pct = ((d.value / catTotal) * 100).toFixed(1);
                          const isOpen = selectedSubCategory === d.name;
                          return (
                            <div key={d.name} className="rounded-xl overflow-hidden">
                              {/* row header button */}
                              <button
                                onClick={() => setSelectedSubCategory(isOpen ? null : d.name)}
                                className={`w-full text-left px-3 py-2 transition-all rounded-xl ${isOpen ? "bg-indigo-50 border border-indigo-200" : "bg-slate-50/80 border border-transparent hover:bg-white hover:border-slate-200"}`}>
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{background:d.color}}/>
                                    <span className="text-xs font-semibold text-slate-700 truncate">{d.name}</span>
                                    <Badge>{d.count} txns</Badge>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-xs font-bold text-slate-800 tabular-nums">{formatCurrency(d.value)}</span>
                                    <span className="text-[10px] text-slate-400 tabular-nums">{pct}%</span>
                                    <span className="text-[10px] text-indigo-400">{isOpen ? "▲" : "▼"}</span>
                                  </div>
                                </div>
                                <ProgressBar pct={Number(pct)} color={d.color}/>
                              </button>

                              {/* transaction glance — shown when subcategory row is open */}
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
                                      {/* sticky table header */}
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
                                            {acName ? (
                                              <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-full whitespace-nowrap">{acName}</span>
                                            ) : (
                                              <span className="text-[11px] text-slate-300 text-center">—</span>
                                            )}
                                            <span className="text-xs font-bold text-red-500 tabular-nums text-right whitespace-nowrap">{formatCurrency(tx.amount)}</span>
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

            {/* ── account + payment method ── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {accountBarData.length > 0 && (
                <Card>
                  <h2 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4">💳 Spending by Account</h2>
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
                              <span className="text-xs text-slate-400 tabular-nums">{pct}%</span>
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
                  <h2 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4">📲 Payment Method</h2>
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
                              <span className="text-xs text-slate-400 tabular-nums">{pct}%</span>
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

            {/* ── AI analysis ── */}
            {aiResult?.status === "ok" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-extrabold text-slate-900 tracking-tight">AI Analysis</h2>
                  {aiResult.ai_powered && (
                    <span className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-700 font-bold px-2.5 py-0.5 rounded-full">✶ Gemini</span>
                  )}
                  <span className="text-xs text-slate-400">{aiResult.period.from} → {aiResult.period.to}</span>
                </div>

                {aiResult.narrative && (
                  <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-5 shadow-lg shadow-indigo-200/50">
                    <p className="text-sm text-white/90 leading-relaxed">💬 {aiResult.narrative}</p>
                  </div>
                )}

                {aiPieData.length > 0 && (
                  <Card>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest">🎨 AI Lifestyle Themes</h3>
                      <Badge cls="bg-violet-100 text-violet-600">Gemini-generated</Badge>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">AI grouped your expenses by lifestyle theme — not standard accounting categories.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={aiPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={100}
                              paddingAngle={3} dataKey="value" stroke="none">
                              {aiPieData.map((d,i) => <Cell key={i} fill={d.color}/>)}
                            </Pie>
                            <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:"12px",border:"1px solid #e2e8f0",fontSize:"12px",boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}/>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                        {aiPieData.map(t => {
                          const tot = aiPieData.reduce((s,x) => s+x.value, 0) || 1;
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
                    <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Flags &amp; Alerts</h3>
                    {aiResult.flags.map((flag,i) => (
                      <div key={i} className={`rounded-xl border px-4 py-3 ${SEVERITY_STYLES[flag.severity] || SEVERITY_STYLES.info}`}>
                        <p className="text-sm font-semibold">{flag.title}</p>
                        <p className="text-xs mt-0.5 opacity-75">{flag.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                {aiResult.suggestions?.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest">Suggestions</h3>
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
              </div>
            )}

            {aiResult?.status === "no_data" && (
              <Card>
                <p className="text-sm text-slate-500 text-center py-4">{aiResult.message}</p>
              </Card>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

/* ─── helper sub-components ────────────────────────────────────────────────── */
function StatCard({ label, value, valueClass, icon, iconBg }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center text-xl shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium truncate">{label}</p>
        <p className={`text-lg font-extrabold truncate tabular-nums ${valueClass}`}>{value}</p>
      </div>
    </div>
  );
}
'''

target = "/Users/amolsaxena/Downloads/Advanced_Finance_Tracker/frontend/src/pages/Analytics/ExpenseAnalytics.jsx"
with open(target, "w", encoding="utf-8") as f:
    f.write(jsx)

lines = jsx.count("\n")
print(f"Written {lines} lines to {target}")
print("accountIdToName:", "accountIdToName" in jsx)
print("selectedSubCategory:", "selectedSubCategory" in jsx)
print("StatCard with iconBg:", "iconBg" in jsx)
print("getMonthStart default:", "from_date: getMonthStart()" in jsx)
