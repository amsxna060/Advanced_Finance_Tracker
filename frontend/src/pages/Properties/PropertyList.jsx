import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency } from "../../lib/utils";
import { PageHero, PageBody, Button } from "../../components/ui";

/* ── Portfolio stat card (larger, more readable) ───────────────────────────── */
function PortfolioStat({ label, value, sub, accent }) {
  const C = {
    sky:     { border: "border-l-sky-400",     val: "text-sky-300" },
    amber:   { border: "border-l-amber-400",   val: "text-amber-300" },
    emerald: { border: "border-l-emerald-400", val: "text-emerald-300" },
  }[accent] || { border: "border-l-indigo-400", val: "text-white" };

  return (
    <div className={`bg-white/[0.06] backdrop-blur border border-white/[0.10] border-l-[3px] ${C.border} rounded-2xl px-6 py-5 flex flex-col gap-2`}>
      <p className="text-white/50 text-[11px] font-semibold uppercase tracking-[0.18em] leading-none">{label}</p>
      <p className={`text-[1.75rem] font-black tracking-tight leading-none ${C.val}`}>{value}</p>
      {sub && <p className="text-white/40 text-xs leading-snug">{sub}</p>}
    </div>
  );
}

/* ── Stage pipeline ────────────────────────────────────────────────────────── */
const STAGES = [
  { key: "negotiating",  label: "Nego",     short: "Negotiating" },
  { key: "advance_given",label: "Advance",  short: "Advance Given" },
  { key: "buyer_found",  label: "Buyer",    short: "Buyer Found" },
  { key: "registry_done",label: "Registry", short: "Registry Done" },
  { key: "settled",      label: "Settled",  short: "Settled" },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

function stageIndex(status) {
  if (status === "cancelled") return -1;
  return STAGE_INDEX[status] ?? 0;
}

/* ── Status colour mapping ─────────────────────────────────────────────────── */
const STATUS_CHIP = {
  negotiating:  "bg-slate-100 text-slate-600 border-slate-200",
  advance_given:"bg-amber-50  text-amber-700 border-amber-200",
  registry_done:"bg-sky-50    text-sky-700   border-sky-200",
  buyer_found:  "bg-blue-50   text-blue-700  border-blue-200",
  settled:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled:    "bg-rose-50   text-rose-700  border-rose-200",
};

/* ── Days-to-registry helper ───────────────────────────────────────────────── */
function daysTo(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  return diff;
}

/* ── Stage progress bar ────────────────────────────────────────────────────── */
function StageBar({ status }) {
  const idx = stageIndex(status);
  if (idx < 0) return (
    <div className="flex items-center gap-1.5 mt-3">
      <span className="text-[10px] text-rose-600 font-medium">Cancelled</span>
    </div>
  );
  return (
    <div className="mt-3">
      <div className="flex items-center gap-0.5">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className={`h-2 flex-1 rounded-full transition-all ${i <= idx ? "bg-indigo-500" : "bg-slate-200"}`} />
            {i < STAGES.length - 1 && <div className={`w-1.5 h-1.5 rounded-full shrink-0 mx-0.5 ${i < idx ? "bg-indigo-500" : "bg-slate-200"}`} />}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2">
        {STAGES.map((s, i) => (
          <span key={s.key} className={`text-[11px] font-semibold ${i === idx ? "text-indigo-600" : i < idx ? "text-slate-400" : "text-slate-300"}`}>
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
  const registryColor = days === null ? "" : days <= 14 ? "text-rose-500" : days <= 30 ? "text-amber-500" : "text-slate-500";
  const registryDotColor = days !== null && days <= 14 ? "bg-rose-500" : days !== null && days <= 30 ? "bg-amber-400" : "";
  const registryPulse = days !== null && days <= 14;
  const chipCls = STATUS_CHIP[property.status] || STATUS_CHIP.negotiating;
  const isActive = !["settled", "cancelled"].includes(property.status);
  const myShare = property.my_share_percentage != null ? parseFloat(property.my_share_percentage) : 100;
  const advancePaid = parseFloat(property.advance_paid || 0);
  const totalSeller = parseFloat(property.total_seller_value || 0);
  const remaining = Math.max(0, totalSeller - advancePaid);
  const myRemaining = remaining * (myShare / 100);

  return (
    <div
      onClick={onClick}
      className="group bg-white rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-lg hover:border-indigo-300/60 transition-all duration-200 cursor-pointer p-7 overflow-hidden"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-slate-900 truncate group-hover:text-indigo-700 transition-colors leading-tight">
            {property.title}
          </h3>
          {property.location && (
            <p className="text-sm text-slate-400 mt-1.5 truncate">📍 {property.location}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`text-xs px-3 py-1 rounded-full border font-semibold uppercase tracking-wide ${chipCls}`}>
            {property.status?.replace(/_/g, " ")}
          </span>
          <span className="text-xs text-slate-400 capitalize font-medium">{property.property_type}</span>
        </div>
      </div>

      {/* Stage progress */}
      <StageBar status={property.status} />

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 gap-4 mt-6">
        <div>
          <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Advance Paid</p>
          <p className="text-base font-bold text-amber-600 mt-1.5">{formatCurrency(advancePaid)}</p>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Remaining</p>
          <p className={`text-base font-bold mt-1.5 ${myRemaining > 0 ? "text-rose-600" : "text-slate-400"}`}>
            {myRemaining > 0 ? formatCurrency(myRemaining) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Area</p>
          <p className="text-base font-bold text-slate-700 mt-1.5">
            {property.total_area_sqft ? `${Number(property.total_area_sqft).toLocaleString()} sqft` : "—"}
          </p>
        </div>
      </div>

      {/* Footer: ownership + registry */}
      <div className="flex items-end justify-between mt-6 pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2">
          {myShare > 0 && myShare < 100 && (
            <span className="text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
              {myShare}% mine
            </span>
          )}
          {property.net_profit > 0 && (
            <span className="text-sm font-semibold text-emerald-600">
              +{formatCurrency(property.net_profit)} profit
            </span>
          )}
        </div>
        {days !== null && isActive && (
          <div className={`flex items-center gap-1.5 ${registryColor}`}>
            {registryDotColor && <span className={`w-2 h-2 rounded-full ${registryDotColor} ${registryPulse ? "animate-pulse" : ""}`} />}
            <span className="text-sm font-semibold">
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

  const { data: stats = {} } = useQuery({
    queryKey: ["properties-stats"],
    queryFn: () => api.get("/api/properties/stats").then(r => r.data),
    staleTime: 30_000,
  });

  const hasFilters = filters.search || filters.status || filters.property_type;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Property Portfolio"
        subtitle={`${stats.total_count ?? "—"} deal${stats.total_count !== 1 ? "s" : ""} · ${stats.active_count ?? "—"} active`}
        backTo="/dashboard"
        actions={
          <Button variant="white" onClick={() => navigate("/properties/new")}>
            + New Deal
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-7">
          <PortfolioStat
            label="My Active Capital"
            value={stats.my_capital != null ? formatCurrency(stats.my_capital) : "—"}
            sub={`my advance + expenses · ${stats.active_count ?? 0} active deals`}
            accent="sky"
          />
          <PortfolioStat
            label="My Upcoming Liability"
            value={stats.my_liability != null ? formatCurrency(stats.my_liability) : "—"}
            sub="remaining seller amount × my share%"
            accent="amber"
          />
          <PortfolioStat
            label="Settled Profit (My Share)"
            value={stats.settled_profit != null ? formatCurrency(stats.settled_profit) : "—"}
            sub="net profit × my share% for closed deals"
            accent="emerald"
          />
        </div>
      </PageHero>

      <PageBody>
        {/* ── Filters ── */}
        <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm px-5 py-4 mb-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search title or location…"
              className="bg-white border border-slate-200 text-slate-700 placeholder-slate-400 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300/40 transition"
            />
            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-400 transition"
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
              className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-400 transition"
            >
              <option value="">All Types</option>
              <option value="plot">Plot</option>
              <option value="site">Site</option>
            </select>
            {hasFilters ? (
              <button
                onClick={() => setFilters({ search: "", status: "", property_type: "" })}
                className="bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium transition"
              >
                Clear
              </button>
            ) : (
              <div className="flex items-center justify-center text-slate-400 text-xs">
                {properties.length} result{properties.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {/* ── Grid ── */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : properties.length === 0 ? (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm py-20 text-center">
            <p className="text-3xl mb-3">🏗️</p>
            <p className="text-slate-500 text-sm">No property deals found.</p>
            <button
              onClick={() => navigate("/properties/new")}
              className="mt-4 text-indigo-600 text-sm hover:underline"
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
      </PageBody>
    </div>
  );
}
