import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

/* ── Stage pipeline ────────────────────────────────────────────────────────── */
const STAGES = [
  { key: "negotiating",  label: "Nego",     short: "Negotiating" },
  { key: "advance_given",label: "Advance",  short: "Advance Given" },
  { key: "registry_done",label: "Registry", short: "Registry Done" },
  { key: "buyer_found",  label: "Buyer",    short: "Buyer Found" },
  { key: "settled",      label: "Settled",  short: "Settled" },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

function stageIndex(status) {
  if (status === "cancelled") return -1;
  return STAGE_INDEX[status] ?? 0;
}

/* ── Status colour mapping ─────────────────────────────────────────────────── */
const STATUS_CHIP = {
  negotiating:  "bg-slate-700/60 text-slate-200 border-slate-600",
  advance_given:"bg-amber-500/20 text-amber-300 border-amber-500/40",
  registry_done:"bg-cyan-500/20  text-cyan-300  border-cyan-500/40",
  buyer_found:  "bg-blue-500/20  text-blue-300  border-blue-500/40",
  settled:      "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  cancelled:    "bg-rose-500/20  text-rose-300  border-rose-500/40",
};

/* ── Days-to-registry helper ───────────────────────────────────────────────── */
function daysTo(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  return diff;
}

/* ── Stat card ─────────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, accent = "cyan" }) {
  const ACCENT = {
    cyan:   "text-cyan-400 border-cyan-500/30",
    amber:  "text-amber-400 border-amber-500/30",
    emerald:"text-emerald-400 border-emerald-500/30",
    rose:   "text-rose-400 border-rose-500/30",
    violet: "text-violet-400 border-violet-500/30",
  };
  return (
    <div className={`bg-slate-800/60 rounded-2xl border ${ACCENT[accent]} px-5 py-4`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${ACCENT[accent].split(" ")[0]}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── Stage progress bar ────────────────────────────────────────────────────── */
function StageBar({ status }) {
  const idx = stageIndex(status);
  if (idx < 0) return (
    <div className="flex items-center gap-1.5 mt-3">
      <span className="text-[10px] text-rose-400 font-medium">Cancelled</span>
    </div>
  );
  return (
    <div className="mt-3">
      <div className="flex items-center gap-0.5">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className={`h-1.5 flex-1 rounded-full transition-all ${i <= idx ? "bg-cyan-500" : "bg-slate-700"}`} />
            {i < STAGES.length - 1 && <div className={`w-1 h-1 rounded-full shrink-0 mx-0.5 ${i < idx ? "bg-cyan-500" : "bg-slate-700"}`} />}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {STAGES.map((s, i) => (
          <span key={s.key} className={`text-[8px] font-medium ${i === idx ? "text-cyan-400" : i < idx ? "text-slate-500" : "text-slate-600"}`}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Property card ─────────────────────────────────────────────────────────── */
function PropertyCard({ property, onClick }) {
  const days = daysTo(property.expected_registry_date);
  const registryColor = days === null ? "" : days <= 14 ? "text-rose-400" : days <= 30 ? "text-amber-400" : "text-slate-400";
  const registryDotColor = days !== null && days <= 14 ? "bg-rose-400" : days !== null && days <= 30 ? "bg-amber-400" : "";
  const registryPulse = days !== null && days <= 14;
  const chipCls = STATUS_CHIP[property.status] || STATUS_CHIP.negotiating;
  const isActive = !["settled", "cancelled"].includes(property.status);
  const myShare = parseFloat(property.my_share_percentage || 0);
  const advancePaid = parseFloat(property.advance_paid || 0);
  const totalSeller = parseFloat(property.total_seller_value || 0);
  const remaining = Math.max(0, totalSeller - advancePaid);
  const myRemaining = myShare > 0 ? remaining * (myShare / 100) : remaining;

  return (
    <div
      onClick={onClick}
      className="group relative bg-slate-800/50 border border-slate-700/60 rounded-2xl p-5 cursor-pointer
                 hover:border-cyan-500/40 hover:bg-slate-800/80 transition-all duration-200 overflow-hidden"
    >
      {/* subtle gradient accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
            {property.title}
          </h3>
          {property.location && (
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              📍 {property.location}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${chipCls}`}>
            {property.status?.replace(/_/g, " ")}
          </span>
          <span className="text-[9px] text-slate-500 capitalize">{property.property_type}</span>
        </div>
      </div>

      {/* Stage progress */}
      <StageBar status={property.status} />

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-wider">Advance Paid</p>
          <p className="text-xs font-bold text-amber-400 mt-0.5">{formatCurrency(advancePaid)}</p>
        </div>
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-wider">My Remaining</p>
          <p className={`text-xs font-bold mt-0.5 ${myRemaining > 0 ? "text-rose-400" : "text-slate-500"}`}>
            {myRemaining > 0 ? formatCurrency(myRemaining) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-wider">Area</p>
          <p className="text-xs font-bold text-slate-300 mt-0.5">
            {property.total_area_sqft ? `${Number(property.total_area_sqft).toLocaleString()} sqft` : "—"}
          </p>
        </div>
      </div>

      {/* Footer: ownership + registry */}
      <div className="flex items-end justify-between mt-4 pt-3 border-t border-slate-700/60">
        <div className="flex items-center gap-2">
          {myShare > 0 && (
            <span className="text-[10px] font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
              {myShare}% mine
            </span>
          )}
          {property.net_profit > 0 && (
            <span className="text-[10px] font-semibold text-emerald-400">
              +{formatCurrency(property.net_profit)} profit
            </span>
          )}
        </div>
        {days !== null && isActive && (
          <div className={`flex items-center gap-1 ${registryColor}`}>
            {registryDotColor && <span className={`w-1.5 h-1.5 rounded-full ${registryDotColor} ${registryPulse ? "animate-pulse" : ""}`} />}
            <span className="text-[10px] font-medium">
              {days < 0 ? `Registry ${Math.abs(days)}d overdue` : days === 0 ? "Registry Today" : `Registry in ${days}d`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────────── */
export default function PropertyList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", status: "", property_type: "" });

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ["properties", filters],
    queryFn: async () => {
      const params = { limit: 500 };
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.property_type) params.property_type = filters.property_type;
      return (await api.get("/api/properties", { params })).data;
    },
  });

  const stats = useMemo(() => {
    const active = properties.filter(p => ["negotiating","advance_given","buyer_found","registry_done"].includes(p.status));
    // My Active Capital = user's actual paid share across active deals
    const capitalDeployed = active.reduce((s, p) => {
      const paid = parseFloat(p.advance_paid || 0);
      const share = parseFloat(p.my_share_percentage || 100) / 100;
      return s + paid * share;
    }, 0);

    // Upcoming Liability = remaining × my_share_pct for active deals
    const upcomingLiability = active.reduce((s, p) => {
      const total = parseFloat(p.total_seller_value || 0);
      const paid  = parseFloat(p.advance_paid || 0);
      const remaining = Math.max(0, total - paid);
      const share = parseFloat(p.my_share_percentage || 100) / 100;
      return s + remaining * share;
    }, 0);

    // Projected Portfolio Value = total_buyer_value for active + settled
    const projected = properties
      .filter(p => p.status !== "cancelled")
      .reduce((s, p) => s + parseFloat(p.total_buyer_value || p.total_seller_value || 0), 0);

    const settledProfit = properties
      .filter(p => p.status === "settled")
      .reduce((s, p) => {
        const share = parseFloat(p.my_share_percentage || 100) / 100;
        return s + parseFloat(p.net_profit || 0) * share;
      }, 0);

    return { capitalDeployed, upcomingLiability, projected, settledProfit, activeCount: active.length, totalCount: properties.length };
  }, [properties]);

  const hasFilters = filters.search || filters.status || filters.property_type;

  return (
    <div className="min-h-screen bg-[#0d1117]">
      <div className="max-w-7xl mx-auto px-4 py-7 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 mb-1">Real Estate</p>
            <h1 className="text-2xl font-bold text-white tracking-tight">Property Portfolio</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {stats.totalCount} deal{stats.totalCount !== 1 ? "s" : ""} · {stats.activeCount} active
            </p>
          </div>
          <button
            onClick={() => navigate("/properties/new")}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500 text-slate-900 rounded-xl text-sm font-bold hover:bg-cyan-400 transition shadow-lg shadow-cyan-500/20"
          >
            <span className="text-base leading-none">+</span> New Deal
          </button>
        </div>

        {/* ── Executive stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="My Active Capital"
            value={formatCurrency(stats.capitalDeployed)}
            sub={`my share across ${stats.activeCount} active deal${stats.activeCount !== 1 ? "s" : ""}`}
            accent="cyan"
          />
          <StatCard
            label="Upcoming Liability"
            value={formatCurrency(stats.upcomingLiability)}
            sub="My share of pending payments"
            accent="amber"
          />
          <StatCard
            label="Projected Portfolio Value"
            value={formatCurrency(stats.projected)}
            sub="Total buyer value at completion"
            accent="violet"
          />
          <StatCard
            label="Settled Profit (My Share)"
            value={formatCurrency(stats.settledProfit)}
            sub="From closed deals"
            accent="emerald"
          />
        </div>

        {/* ── Filters ── */}
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl px-5 py-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search title or location…"
              className="bg-slate-900/60 border border-slate-700 text-slate-200 placeholder-slate-500 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition"
            />
            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="bg-slate-900/60 border border-slate-700 text-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-cyan-500/60 transition"
            >
              <option value="">All Status</option>
              <option value="negotiating">Negotiating</option>
              <option value="advance_given">Advance Given</option>
              <option value="buyer_found">Buyer Found</option>
              <option value="registry_done">Registry Done</option>
              <option value="settled">Settled</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={filters.property_type}
              onChange={e => setFilters(f => ({ ...f, property_type: e.target.value }))}
              className="bg-slate-900/60 border border-slate-700 text-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-cyan-500/60 transition"
            >
              <option value="">All Types</option>
              <option value="plot">Plot</option>
              <option value="site">Site</option>
            </select>
            {hasFilters ? (
              <button
                onClick={() => setFilters({ search: "", status: "", property_type: "" })}
                className="bg-slate-700 text-slate-300 hover:bg-slate-600 rounded-xl px-3.5 py-2.5 text-sm font-medium transition"
              >
                Clear
              </button>
            ) : (
              <div className="flex items-center justify-center text-slate-600 text-xs">
                {properties.length} result{properties.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {/* ── Grid ── */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 border-2 border-slate-700 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : properties.length === 0 ? (
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl py-20 text-center">
            <p className="text-3xl mb-3">🏗️</p>
            <p className="text-slate-400 text-sm">No property deals found.</p>
            <button
              onClick={() => navigate("/properties/new")}
              className="mt-4 text-cyan-400 text-sm hover:underline"
            >
              Add your first deal →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {properties.map(p => (
              <PropertyCard
                key={p.id}
                property={p}
                onClick={() => navigate(`/properties/${p.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
