import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, PageSkeleton, Button } from "../../components/ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isPastDue(p) {
  if (!p.expected_end_date || p.status === "settled") return false;
  return new Date(p.expected_end_date) < new Date();
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function PotCard({ p, onClick }) {
  const pastDue = isPastDue(p);
  const invested  = parseFloat(p.our_investment || 0);
  const share     = parseFloat(p.our_share_percentage || 0);
  const received  = parseFloat(p.total_received || 0);
  const dealValue = parseFloat(p.total_deal_value || 0);

  const chipCls = p.status === "active"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : p.status === "settled"
    ? "bg-slate-100 text-slate-500 border-slate-200"
    : "bg-rose-50 text-rose-700 border-rose-200";

  return (
    <div
      onClick={onClick}
      className={`group relative bg-white border border-slate-200/60 ${pastDue ? "border-amber-200" : ""} rounded-2xl overflow-hidden cursor-pointer hover:border-indigo-300/60 hover:shadow-md transition-all duration-150`}
    >
      {/* top accent line */}
      <div className={`h-1 w-full ${p.status === "active" ? "bg-gradient-to-r from-indigo-500 to-violet-500" : p.status === "settled" ? "bg-gradient-to-r from-emerald-400 to-teal-400" : "bg-slate-200"}`} />

      <div className="p-5">
        {/* header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-900 group-hover:text-indigo-700 transition-colors truncate pr-2">
              {p.title}
            </h2>
            {p.linked_property_deal_id && (
              <p className="text-[10px] text-indigo-500 mt-0.5 flex items-center gap-1">
                🏘 Linked to property
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${chipCls}`}>
              {p.status}
            </span>
            {pastDue && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                ⏰ Pending Settlement
              </span>
            )}
          </div>
        </div>

        {/* financials grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Capital In</p>
            <p className="text-sm font-bold text-indigo-600 font-mono tabular-nums">{formatCurrency(invested)}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Deal Value</p>
            <p className="text-sm font-bold text-slate-600 font-mono tabular-nums">{dealValue ? formatCurrency(dealValue) : "—"}</p>
          </div>
          <div className={`border rounded-xl p-3 ${received > 0 ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Received</p>
            <p className={`text-sm font-bold font-mono tabular-nums ${received > 0 ? "text-emerald-700" : "text-slate-500"}`}>
              {formatCurrency(received)}
            </p>
          </div>
          <div className={`border rounded-xl p-3 ${share > 0 ? "bg-violet-50 border-violet-200" : "bg-slate-50 border-slate-200"}`}>
            <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">My Equity</p>
            <p className={`text-sm font-bold font-mono tabular-nums ${share > 0 ? "text-violet-700" : "text-slate-500"}`}>
              {share > 0 ? `${share}%` : "—"}
            </p>
          </div>
        </div>

        {/* dates */}
        <div className="flex justify-between text-[10px] text-slate-500 border-t border-slate-200 pt-3">
          {p.start_date ? <span>Started {formatDate(p.start_date)}</span> : <span>No start date</span>}
          {p.expected_end_date && (
            <span className={pastDue ? "text-amber-700 font-semibold" : ""}>
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

  const { data: partnerships = [], isLoading } = useQuery({
    queryKey: ["partnerships", { search, status }],
    queryFn: async () => {
      const params = { limit: 500 }; // backend max — see F9 (no pagination UI yet)
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

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Partnerships"
        subtitle={`Real estate investment pools · ${stats.total} total`}
        actions={
          <Button variant="white" size="sm" onClick={() => navigate("/partnerships/new")}>
            + New Partnership
          </Button>
        }
      >
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <HeroStat label="Active Capital" value={formatCurrency(stats.activeInvested)} accent="indigo" />
          <HeroStat label="Active Pots" value={stats.active} accent="emerald" sub={`${stats.total} total`} />
          <HeroStat label="Total Received" value={formatCurrency(stats.totalReceived)} accent="teal" />
          <HeroStat
            label="Pending Settlement"
            value={stats.pendingSettlement}
            accent={stats.pendingSettlement > 0 ? "amber" : "slate"}
            sub="past expected end date"
          />
        </div>
      </PageHero>

      <PageBody className="space-y-5">
        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search partnerships…"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300/40 focus:border-indigo-400 transition-all"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300/40 focus:border-indigo-400 transition-all"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {(search || status) && (
            <button onClick={() => { setSearch(""); setStatus(""); }} className="px-3.5 py-2.5 bg-white text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors border border-slate-200">
              Clear
            </button>
          )}
        </div>

        {/* List */}
        {partnerships.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
            </div>
            <p className="text-sm font-semibold text-slate-600">No partnerships found</p>
            <p className="text-xs text-slate-500 mt-1">Create your first real estate partnership to get started</p>
            <button onClick={() => navigate("/partnerships/new")} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-500">
              + New Partnership
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {partnerships.map((p) => (
              <PotCard key={p.id} p={p} onClick={() => navigate(`/partnerships/${p.id}`)} />
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}
