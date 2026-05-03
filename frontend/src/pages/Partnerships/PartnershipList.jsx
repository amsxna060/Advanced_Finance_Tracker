import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

// ─── Card ─────────────────────────────────────────────────────────────────────
function PotCard({ p, onClick, myView }) {
  const pastDue = isPastDue(p);
  const invested  = parseFloat(p.our_investment || 0);
  const share     = parseFloat(p.our_share_percentage || 0);
  const received  = parseFloat(p.total_received || 0);
  const dealValue = parseFloat(p.total_deal_value || 0);
  // My View: scale to user's equity portion
  const myCapital  = share > 0 ? invested * (share / 100) : invested;
  const myReceived = share > 0 ? received * (share / 100) : received;

  const chipCls = p.status === "active"
    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    : p.status === "settled"
    ? "bg-slate-700/40 text-slate-400 border-slate-600/40"
    : "bg-rose-500/20 text-rose-400 border-rose-500/30";

  return (
    <div
      onClick={onClick}
      className={`group relative bg-slate-800/50 border ${pastDue ? "border-amber-500/40" : "border-slate-700/60"} rounded-2xl overflow-hidden cursor-pointer hover:border-cyan-500/40 hover:bg-slate-800/80 transition-all duration-150`}
    >
      {/* top accent line */}
      <div className={`h-0.5 w-full ${p.status === "active" ? "bg-gradient-to-r from-cyan-500 to-violet-500" : p.status === "settled" ? "bg-gradient-to-r from-emerald-400 to-teal-400" : "bg-slate-700"}`} />

      <div className="p-5">
        {/* header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors truncate pr-2">
              {p.title}
            </h2>
            {p.linked_property_deal_id && (
              <p className="text-[10px] text-cyan-500/70 mt-0.5 flex items-center gap-1">
                🏘 Linked to property
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${chipCls}`}>
              {p.status}
            </span>
            {pastDue && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                ⏰ Pending Settlement
              </span>
            )}
          </div>
        </div>

        {/* financials grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">{myView ? "My Capital" : "Capital In"}</p>
            <p className="text-sm font-bold text-cyan-400 font-mono tabular-nums">{formatCurrency(myView ? myCapital : invested)}</p>
            {myView && share > 0 && <p className="text-[9px] text-slate-500 mt-0.5">{share}% of {formatCurrency(invested)}</p>}
          </div>
          <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-3">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Deal Value</p>
            <p className="text-sm font-bold text-slate-300 font-mono tabular-nums">{dealValue ? formatCurrency(dealValue) : "—"}</p>
          </div>
          <div className={`border rounded-xl p-3 ${received > 0 ? "bg-emerald-500/5 border-emerald-500/20" : "bg-slate-900/60 border-slate-700/50"}`}>
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">{myView ? "My Received" : "Received"}</p>
            <p className={`text-sm font-bold font-mono tabular-nums ${received > 0 ? "text-emerald-400" : "text-slate-500"}`}>
              {formatCurrency(myView ? myReceived : received)}
            </p>
          </div>
          <div className={`border rounded-xl p-3 ${share > 0 ? "bg-violet-500/5 border-violet-500/20" : "bg-slate-900/60 border-slate-700/50"}`}>
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">My Equity</p>
            <p className={`text-sm font-bold font-mono tabular-nums ${share > 0 ? "text-violet-400" : "text-slate-500"}`}>
              {share > 0 ? `${share}%` : "—"}
            </p>
          </div>
        </div>

        {/* dates */}
        <div className="flex justify-between text-[10px] text-slate-500 border-t border-slate-700/60 pt-3">
          {p.start_date ? <span>Started {formatDate(p.start_date)}</span> : <span>No start date</span>}
          {p.expected_end_date && (
            <span className={pastDue ? "text-amber-400 font-semibold" : ""}>
              {pastDue ? "⚠ Due " : "Expected "}{formatDate(p.expected_end_date)}
            </span>
          )}
        </div>
      </div>

      {/* hover chevron */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-500">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PartnershipList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [myView, setMyView] = useState(false);

  const { data: partnerships = [], isLoading } = useQuery({
    queryKey: ["partnerships", { search, status }],
    queryFn: async () => {
      const params = { limit: 200 };
      if (search) params.search = search;
      if (status) params.status = status;
      return (await api.get("/api/partnerships", { params })).data;
    },
  });

  const stats = useMemo(() => {
    const active = partnerships.filter((p) => p.status === "active");
    const activeInvested = active.reduce((s, p) => s + parseFloat(p.our_investment || 0), 0);
    const totalReceived  = partnerships.reduce((s, p) => s + parseFloat(p.total_received || 0), 0);
    const pendingSettlement = partnerships.filter(isPastDue).length;
    return { total: partnerships.length, active: active.length, activeInvested, totalReceived, pendingSettlement };
  }, [partnerships]);

  // My-view: scale active capital by equity share
  const displayInvested = myView
    ? partnerships
        .filter((p) => p.status === "active")
        .reduce((s, p) => s + parseFloat(p.our_investment || 0) * (parseFloat(p.our_share_percentage || 100) / 100), 0)
    : stats.activeInvested;

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* ── Header ── */}
      <div className="border-b border-slate-800 px-6 pt-7 pb-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <button
                onClick={() => navigate("/dashboard")}
                className="text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1 mb-2 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                Dashboard
              </button>
              <h1 className="text-2xl font-bold text-white tracking-tight">Partnerships</h1>
              <p className="text-slate-500 text-sm mt-0.5">Real estate investment pools · {stats.total} total</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMyView((v) => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${myView ? "bg-cyan-500 text-slate-900 border-cyan-400 shadow-lg shadow-cyan-500/20" : "bg-slate-800/60 text-slate-300 border-slate-700/60 hover:bg-slate-700/60"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                My View
              </button>
              <button
                onClick={() => navigate("/partnerships/new")}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/20 text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                New Partnership
              </button>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
              <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">{myView ? "My Active Capital" : "Active Capital"}</p>
              <p className="text-cyan-400 text-xl font-bold mt-1 font-mono tabular-nums">{formatCurrency(displayInvested)}</p>
              {myView && <p className="text-slate-500 text-[10px] mt-0.5">scaled to your equity share</p>}
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
              <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Active Pots</p>
              <p className="text-white text-xl font-bold mt-1">{stats.active}</p>
              <p className="text-slate-500 text-[10px] mt-0.5">{stats.total} total</p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
              <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Total Received</p>
              <p className="text-emerald-400 text-xl font-bold mt-1 font-mono tabular-nums">{formatCurrency(stats.totalReceived)}</p>
            </div>
            <div className={`rounded-2xl p-4 border ${stats.pendingSettlement > 0 ? "bg-amber-500/10 border-amber-500/30" : "bg-slate-800/60 border-slate-700/60"}`}>
              <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Pending Settlement</p>
              <p className={`text-xl font-bold mt-1 ${stats.pendingSettlement > 0 ? "text-amber-400" : "text-white"}`}>{stats.pendingSettlement}</p>
              <p className="text-slate-500 text-[10px] mt-0.5">past expected end date</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Filters */}
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search partnerships…"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/60 transition-all"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3.5 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/60 transition-all"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {(search || status) && (
            <button onClick={() => { setSearch(""); setStatus(""); }} className="px-3.5 py-2.5 bg-slate-700/60 text-slate-300 rounded-xl text-sm hover:bg-slate-700 transition-colors border border-slate-600/60">
              Clear
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-700 border-t-cyan-500" />
          </div>
        ) : partnerships.length === 0 ? (
          <div className="bg-slate-800/50 border border-dashed border-slate-700/60 rounded-2xl p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
            </div>
            <p className="text-sm font-semibold text-slate-300">No partnerships found</p>
            <p className="text-xs text-slate-500 mt-1">Create your first real estate partnership to get started</p>
            <button onClick={() => navigate("/partnerships/new")} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-500">
              + New Partnership
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {partnerships.map((p) => (
              <PotCard key={p.id} p={p} myView={myView} onClick={() => navigate(`/partnerships/${p.id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
