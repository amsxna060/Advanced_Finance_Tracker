import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";

const PALETTE = [
  "#6366f1","#f43f5e","#10b981","#f59e0b","#8b5cf6",
  "#ec4899","#06b6d4","#f97316","#84cc16","#14b8a6",
  "#3b82f6","#ef4444","#a855f7","#d946ef","#0ea5e9",
  "#64748b","#22c55e","#e11d48","#ca8a04","#2563eb",
];
const AI_PALETTE = [
  "#7c3aed","#db2777","#0891b2","#d97706","#059669",
  "#dc2626","#4f46e5","#0d9488",
];
const MODE_ICONS = { upi:"📲", cash:"💵", bank_transfer:"🏦", card:"💳", cheque:"📄", unknown:"❓" };
const MODE_LABELS = { upi:"UPI", cash:"Cash", bank_transfer:"Bank Transfer", card:"Card", cheque:"Cheque", unknown:"Unknown" };

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
  { label: "This Month", from: getMonthStart(), to: getToday() },
  { label: "3 Months", from: (() => { const d=new Date(); d.setMonth(d.getMonth()-2); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; })(), to: getToday() },
  { label: "6 Months", from: get6MonthsAgo(), to: getToday() },
  { label: "This Year", from: `${new Date().getFullYear()}-01-01`, to: getToday() },
  { label: "All Time", from: "", to: "" },
];

const SEVERITY_STYLES = {
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
  error: "bg-red-50 border-red-200 text-red-800",
};

export default function ExpenseAnalytics() {
  const [range, setRange] = useState({ from_date: get6MonthsAgo(), to_date: getToday() });
  const [aiResult, setAiResult] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["expense-analytics", range],
    queryFn: async () => {
      const params = {};
      if (range.from_date) params.from_date = range.from_date;
      if (range.to_date) params.to_date = range.to_date;
      return (await api.get("/api/expenses/analytics/summary", { params })).data;
    },
  });

  const aiMutation = useMutation({
    mutationFn: async () =>
      (await api.post("/api/analytics/ai-expense-analysis", {
        from_date: range.from_date || "2020-01-01",
        to_date: range.to_date || getToday(),
      })).data,
    onSuccess: (result) => setAiResult(result),
  });

  const categories = data?.categories || [];
  const subCategories = data?.sub_categories || {};
  const monthly = data?.monthly || [];
  const modes = data?.payment_modes || [];
  const accounts = data?.accounts || [];
  const peakDay = data?.peak_day;
  const peakWeek = data?.peak_week;

  const donutData = useMemo(() =>
    categories.map((c,i) => ({ name:c.category, value:Number(c.total), color:PALETTE[i%PALETTE.length] })),
    [categories]);

  const barData = useMemo(() =>
    monthly.map((m) => ({
      month: new Date(m.month+"-01").toLocaleDateString("en-IN",{month:"short",year:"2-digit"}),
      amount: Number(m.total),
    })), [monthly]);

  const subDonutData = useMemo(() => {
    if (!selectedCategory) return [];
    return (subCategories[selectedCategory]||[]).map((s,i) => ({
      name:s.sub_category, value:Number(s.total), count:s.count, color:PALETTE[(i+4)%PALETTE.length],
    }));
  }, [selectedCategory, subCategories]);

  const categoryColorMap = useMemo(() => {
    const m = {};
    donutData.forEach((d) => { m[d.name]=d.color; });
    return m;
  }, [donutData]);

  const modeBarData = useMemo(() =>
    modes.map((m,i) => ({
      name: MODE_LABELS[m.mode] || m.mode.replaceAll("_"," "),
      amount: Number(m.total), count: m.count,
      icon: MODE_ICONS[m.mode] || "💳",
      color: PALETTE[i%PALETTE.length],
    })), [modes]);

  const accountBarData = useMemo(() =>
    accounts.map((a,i) => ({
      name: a.name, amount: Number(a.total), count: a.count,
      color: PALETTE[(i+3)%PALETTE.length],
    })), [accounts]);

  const aiPieData = useMemo(() =>
    (aiResult?.ai_pie_data||[]).map((t,i) => ({
      name: t.name, value: Number(t.amount), count: t.count,
      insight: t.insight, color: AI_PALETTE[i%AI_PALETTE.length],
    })), [aiResult]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Expense Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Deep-dive into your spending patterns</p>
        </div>

        {/* Controls bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <input type="date" value={range.from_date}
              onChange={(e)=>{ setRange(r=>({...r,from_date:e.target.value})); setSelectedCategory(null); }}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"/>
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={range.to_date}
              onChange={(e)=>{ setRange(r=>({...r,to_date:e.target.value})); setSelectedCategory(null); }}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"/>
          </div>
          <div className="h-6 border-l border-slate-200"/>
          {PRESETS.map((p)=>(
            <button key={p.label} onClick={()=>{ setRange({from_date:p.from,to_date:p.to}); setSelectedCategory(null); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${range.from_date===p.from&&range.to_date===p.to?"bg-indigo-600 text-white":"bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {p.label}
            </button>
          ))}
          <div className="ml-auto">
            <button onClick={()=>aiMutation.mutate()} disabled={aiMutation.isPending}
              className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium rounded-lg hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 flex items-center gap-2 shadow-sm transition-all">
              {aiMutation.isPending?(<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Analysing...</>):<>🧠 AI Analysis</>}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"/></div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total Spent" value={formatCurrency(data?.grand_total)} color="text-red-600"/>
              <StatCard label="Transactions" value={data?.expense_count||0} color="text-slate-900"/>
              <StatCard label="Categories" value={categories.length} color="text-slate-900"/>
              <StatCard label="Avg / Entry" value={formatCurrency(data?.expense_count?Number(data.grand_total)/data.expense_count:0)} color="text-slate-900"/>
            </div>

            {/* Peak Week & Peak Day */}
            {(peakWeek||peakDay)&&(
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {peakWeek&&(
                  <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl border border-amber-200 p-4 flex items-start gap-3">
                    <div className="text-2xl">🔥</div>
                    <div>
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Hottest Week</p>
                      <p className="text-base font-bold text-slate-900 mt-0.5">{formatCurrency(Number(peakWeek.total))}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{peakWeek.label} · {peakWeek.count} transactions</p>
                    </div>
                  </div>
                )}
                {peakDay&&(
                  <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-xl border border-rose-200 p-4 flex items-start gap-3">
                    <div className="text-2xl">📅</div>
                    <div>
                      <p className="text-xs font-semibold text-rose-700 uppercase tracking-wider">Most Expensive Day</p>
                      <p className="text-base font-bold text-slate-900 mt-0.5">{formatCurrency(Number(peakDay.total))}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(peakDay.date).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",year:"numeric"})} · {peakDay.count} txns
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Category Donut + Monthly Trend */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Spending by Category</h2>
                  <span className="text-xs text-slate-400">Click to drill down</span>
                </div>
                {donutData.length===0?(
                  <div className="flex items-center justify-center h-64 text-slate-400 text-sm">No data</div>
                ):(
                  <div className="flex items-center gap-6">
                    <div className="w-52 h-52 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="value" nameKey="name" stroke="none"
                            onClick={(e)=>setSelectedCategory(e.name===selectedCategory?null:e.name)}>
                            {donutData.map((d,i)=>(
                              <Cell key={i} fill={d.color} opacity={selectedCategory&&selectedCategory!==d.name?0.3:1} style={{cursor:"pointer"}}/>
                            ))}
                          </Pie>
                          <Tooltip formatter={(v)=>formatCurrency(v)} contentStyle={{borderRadius:"10px",border:"1px solid #e2e8f0",fontSize:"13px"}}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-1 max-h-52 overflow-y-auto pr-1">
                      {donutData.map((d)=>{
                        const pct=data?.grand_total>0?(d.value/Number(data.grand_total)*100).toFixed(1):"0";
                        const isSel=selectedCategory===d.name;
                        return (
                          <button key={d.name} onClick={()=>setSelectedCategory(isSel?null:d.name)}
                            className={`w-full flex items-center gap-2 text-xs rounded-lg px-2 py-1 transition-all ${isSel?"bg-indigo-50 ring-1 ring-indigo-300":"hover:bg-slate-50"}`}>
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:d.color}}/>
                            <span className="text-slate-600 truncate flex-1 text-left">{d.name}</span>
                            <span className="text-slate-400 shrink-0">{pct}%</span>
                            <span className="font-semibold text-slate-800 shrink-0 w-20 text-right">{formatCurrency(d.value)}</span>
                            {subCategories[d.name]?.length>0&&<span className="text-indigo-400 text-[10px] shrink-0">▼</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">Monthly Trend</h2>
                {barData.length===0?(
                  <div className="flex items-center justify-center h-64 text-slate-400 text-sm">No data</div>
                ):(
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{top:5,right:5,left:-15,bottom:5}}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15}/>
                        <XAxis dataKey="month" tick={{fontSize:11,fill:"#64748b"}}/>
                        <YAxis tick={{fontSize:11,fill:"#64748b"}} tickFormatter={(v)=>v>=100000?`${(v/100000).toFixed(1)}L`:v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                        <Tooltip formatter={(v)=>formatCurrency(v)} contentStyle={{borderRadius:"10px",border:"1px solid #e2e8f0",fontSize:"13px"}}/>
                        <Bar dataKey="amount" fill="#6366f1" radius={[6,6,0,0]} name="Spent"/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Sub-Category Drill-Down */}
            {selectedCategory&&(
              <div className="bg-white rounded-xl border-2 border-indigo-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{background:categoryColorMap[selectedCategory]}}/>
                    <div>
                      <h2 className="text-sm font-bold text-slate-800">{selectedCategory} — Sub-category Breakdown</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Total: {formatCurrency(categories.find(c=>c.category===selectedCategory)?.total)} · {categories.find(c=>c.category===selectedCategory)?.count} transactions
                      </p>
                    </div>
                  </div>
                  <button onClick={()=>setSelectedCategory(null)} className="text-slate-400 hover:text-slate-600 text-xs font-medium px-2 py-1 rounded hover:bg-slate-100 transition-colors">✕ Close</button>
                </div>
                {subDonutData.length===0?(
                  <p className="text-sm text-slate-400 text-center py-6">No sub-category data</p>
                ):(
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={subDonutData} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name" stroke="none">
                            {subDonutData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                          </Pie>
                          <Tooltip formatter={(v)=>formatCurrency(v)} contentStyle={{borderRadius:"10px",border:"1px solid #e2e8f0",fontSize:"13px"}}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2.5">
                      {subDonutData.map((d)=>{
                        const catTotal=Number(categories.find(c=>c.category===selectedCategory)?.total||1);
                        const pct=((d.value/catTotal)*100).toFixed(1);
                        return (
                          <div key={d.name}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:d.color}}/>
                                <span className="text-sm text-slate-700">{d.name}</span>
                                <span className="text-xs text-slate-400">({d.count} txns)</span>
                              </div>
                              <div className="text-right">
                                <span className="text-sm font-semibold text-slate-800">{formatCurrency(d.value)}</span>
                                <span className="text-xs text-slate-400 ml-2">{pct}%</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{width:`${pct}%`,backgroundColor:d.color}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Account & Payment Method */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {accountBarData.length>0&&(
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">💳 Spending by Account</h2>
                  <div className="space-y-3">
                    {accountBarData.map((a)=>{
                      const gt=Number(data?.grand_total||1);
                      const pct=((a.amount/gt)*100).toFixed(1);
                      return (
                        <div key={a.name}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{background:a.color}}/>
                              <span className="text-sm font-medium text-slate-700">{a.name}</span>
                              <span className="text-xs text-slate-400">({a.count} txns)</span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold text-slate-900">{formatCurrency(a.amount)}</span>
                              <span className="text-xs text-slate-400 ml-2">{pct}%</span>
                            </div>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{width:`${pct}%`,backgroundColor:a.color}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {modeBarData.length>0&&(
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">📲 Payment Method Breakdown</h2>
                  <div className="space-y-3">
                    {modeBarData.map((m)=>{
                      const gt=Number(data?.grand_total||1);
                      const pct=((m.amount/gt)*100).toFixed(1);
                      return (
                        <div key={m.name}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{m.icon}</span>
                              <span className="text-sm font-medium text-slate-700">{m.name}</span>
                              <span className="text-xs text-slate-400">({m.count} txns)</span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold text-slate-900">{formatCurrency(m.amount)}</span>
                              <span className="text-xs text-slate-400 ml-2">{pct}%</span>
                            </div>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{width:`${pct}%`,backgroundColor:m.color}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* AI Analysis */}
            {aiResult&&aiResult.status==="ok"&&(
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-slate-900">AI Analysis</h2>
                  {aiResult.ai_powered&&(
                    <span className="text-xs bg-violet-100 text-violet-700 font-semibold px-2 py-0.5 rounded-full">✶ Gemini</span>
                  )}
                  <span className="text-xs text-slate-400">{aiResult.analyzed_at} · {aiResult.period.from} to {aiResult.period.to}</span>
                </div>

                {aiResult.narrative&&(
                  <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4">
                    <p className="text-sm text-slate-700 leading-relaxed">💬 {aiResult.narrative}</p>
                  </div>
                )}

                {aiPieData.length>0&&(
                  <div className="bg-white rounded-xl border border-slate-200 p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">🎨 AI Lifestyle Themes</h3>
                      <span className="text-xs bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-medium">Gemini-generated</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">AI grouped your expenses by lifestyle theme — not standard accounting categories.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={aiPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={100} paddingAngle={3} dataKey="value" nameKey="name" stroke="none">
                              {aiPieData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                            </Pie>
                            <Tooltip formatter={(v)=>formatCurrency(v)} contentStyle={{borderRadius:"10px",border:"1px solid #e2e8f0",fontSize:"13px"}}/>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                        {aiPieData.map((t)=>{
                          const total=aiPieData.reduce((s,x)=>s+x.value,0)||1;
                          const pct=((t.value/total)*100).toFixed(1);
                          return (
                            <div key={t.name} className="flex items-start gap-2">
                              <div className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{background:t.color}}/>
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                                  <span className="text-sm font-bold text-slate-900">{formatCurrency(t.value)}</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{t.insight}</p>
                                <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                  <div className="h-full rounded-full" style={{width:`${pct}%`,backgroundColor:t.color}}/>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {aiResult.insights.map((insight,i)=>(
                    <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{insight.icon}</span>
                        <span className="text-sm font-semibold text-slate-800">{insight.title}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{insight.text}</p>
                    </div>
                  ))}
                </div>

                {aiResult.flags.length>0&&(
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700">Flags & Alerts</h3>
                    {aiResult.flags.map((flag,i)=>(
                      <div key={i} className={`rounded-lg border p-3 ${SEVERITY_STYLES[flag.severity]||SEVERITY_STYLES.info}`}>
                        <p className="text-sm font-medium">{flag.title}</p>
                        <p className="text-xs mt-0.5 opacity-80">{flag.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                {aiResult.suggestions.length>0&&(
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700">Suggestions</h3>
                    {aiResult.suggestions.map((s,i)=>(
                      <div key={i} className="bg-white rounded-lg border border-slate-200 p-3">
                        <span className="text-xs font-medium text-indigo-600">{s.category}</span>
                        <p className="text-xs text-slate-600 mt-0.5">{s.suggestion}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {aiResult&&aiResult.status==="no_data"&&(
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
                <p className="text-slate-500 text-sm">{aiResult.message}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
