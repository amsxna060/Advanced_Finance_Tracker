import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Trash2, Users, IndianRupee, Calendar, FileText, Building, ArrowRight } from "lucide-react";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

/* ─── PLOT DIAGRAM (SVG) ──────────────────────────────────────────────────── */
function PlotDiagram({ left, right, top, bottom, area, roads }) {
  const hasAny = left || right || top || bottom;
  if (!hasAny) return null;

  const l = parseFloat(left) || 0;
  const r = parseFloat(right) || 0;
  const t = parseFloat(top) || 0;
  const b = parseFloat(bottom) || 0;

  let parsedRoads = [];
  try {
    if (roads) parsedRoads = typeof roads === "string" ? JSON.parse(roads) : roads;
  } catch { /* ignore */ }

  const maxSide = Math.max(l, r, t, b, 1);
  const BASE_W = 200, BASE_H = 140, PAD = 55;
  const ROAD_W = 22;

  const topW = t > 0 ? Math.max((t / maxSide) * BASE_W, 80) : BASE_W;
  const botW = b > 0 ? Math.max((b / maxSide) * BASE_W, 80) : BASE_W;
  const leftH = l > 0 ? Math.max((l / maxSide) * BASE_H, 60) : BASE_H;
  const rightH = r > 0 ? Math.max((r / maxSide) * BASE_H, 60) : BASE_H;
  const plotH = Math.max(leftH, rightH);

  const svgW = Math.max(topW, botW) + PAD * 2 + ROAD_W * 2;
  const svgH = plotH + PAD * 2 + ROAD_W * 2;
  const cx = svgW / 2;
  const oY = PAD + ROAD_W;

  const x3 = cx + botW / 2, y4 = oY + plotH;
  const x4 = cx - botW / 2;
  const y1L = oY + (plotH - leftH);
  const y1R = oY + (plotH - rightH);

  const points = `${x4},${y4} ${cx - topW / 2},${y1L} ${cx + topW / 2},${y1R} ${x3},${y4}`;
  const midY = (Math.min(y1L, y1R) + y4) / 2;

  const hasRoadN = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "north");
  const hasRoadS = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "south");
  const hasRoadE = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "east");
  const hasRoadW = parsedRoads.some((rd) => (rd.direction || "").toLowerCase() === "west");

  const roadRects = parsedRoads.map((rd, i) => {
    const dir = (rd.direction || "").toLowerCase();
    const w = parseFloat(rd.width_ft) || 20;
    const label = `Road ${w}ft`;
    if (dir === "north") {
      return (<g key={i}><rect x={cx - topW / 2 - 5} y={Math.min(y1L, y1R) - ROAD_W - 2} width={topW + 10} height={ROAD_W} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} /><text x={cx} y={Math.min(y1L, y1R) - ROAD_W / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569">{label}</text></g>);
    }
    if (dir === "south") {
      return (<g key={i}><rect x={cx - botW / 2 - 5} y={y4 + 2} width={botW + 10} height={ROAD_W} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} /><text x={cx} y={y4 + ROAD_W / 2 + 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569">{label}</text></g>);
    }
    if (dir === "east") {
      return (<g key={i}><rect x={Math.max(x3, cx + topW / 2) + 2} y={Math.min(y1R, y1L)} width={ROAD_W} height={plotH} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} /><text x={Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" transform={`rotate(90, ${Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2}, ${midY})`}>{label}</text></g>);
    }
    if (dir === "west") {
      return (<g key={i}><rect x={Math.min(x4, cx - topW / 2) - ROAD_W - 2} y={Math.min(y1L, y1R)} width={ROAD_W} height={plotH} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} /><text x={Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" transform={`rotate(-90, ${Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2}, ${midY})`}>{label}</text></g>);
    }
    return null;
  });

  return (
    <svg width={svgW} height={svgH} style={{ overflow: "visible" }}>
      {roadRects}
      <polygon points={points} fill="#eff6ff" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />
      <text x={cx} y={Math.min(y1L, y1R) - (hasRoadN ? ROAD_W + 10 : 10)} textAnchor="middle" fontSize={12} fill="#1d4ed8">{top ? `N: ${top} ft` : "—"}</text>
      <text x={cx} y={y4 + (hasRoadS ? ROAD_W + 10 : 20)} textAnchor="middle" fontSize={12} fill="#1d4ed8">{bottom ? `S: ${bottom} ft` : "—"}</text>
      <text x={Math.min(x4, cx - topW / 2) - (hasRoadW ? ROAD_W + 8 : 8)} y={(y1L + y4) / 2} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="#1d4ed8">{left ? `W: ${left} ft` : "—"}</text>
      <text x={Math.max(x3, cx + topW / 2) + (hasRoadE ? ROAD_W + 8 : 8)} y={(y1R + y4) / 2} textAnchor="start" dominantBaseline="middle" fontSize={12} fill="#1d4ed8">{right ? `E: ${right} ft` : "—"}</text>
      {area && (<text x={cx} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#1e40af" fontWeight="600">{Number(area).toLocaleString()} sqft</text>)}
    </svg>
  );
}

/* ─── HELPERS ──────────────────────────────────────────────────────────────── */
function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900 text-right max-w-[60%]">{value}</span>
    </div>
  );
}

const statusColors = {
  pending: "bg-slate-100 text-slate-600",
  negotiating: "bg-slate-100 text-slate-600",
  advance_received: "bg-amber-100 text-amber-700",
  advance_given: "bg-amber-100 text-amber-700",
  buyer_found: "bg-blue-100 text-blue-700",
  registry_done: "bg-blue-100 text-blue-700",
  fully_paid: "bg-emerald-100 text-emerald-700",
  settled: "bg-emerald-100 text-emerald-700",
  available: "bg-slate-100 text-slate-600",
  sold: "bg-emerald-100 text-emerald-700",
  registered: "bg-blue-100 text-blue-700",
};

function StatusBadge({ status }) {
  const label = (status || "pending").replace(/_/g, " ");
  const cls = statusColors[status] || statusColors.pending;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
}

/* ─── SITE PLOTS SECTION (READ-ONLY) ─────────────────────────────────────── */
function SitePlotsSection({ plots }) {
  const totalRevenue = plots.reduce((s, p) => s + parseFloat(p.calculated_price || 0), 0);
  const soldCount = plots.filter((p) => ["sold", "registered", "fully_paid"].includes(p.status)).length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
      <h2 className="text-base font-bold text-slate-800 mb-1">Site Plots</h2>
      <p className="text-xs text-slate-500 mb-4">{plots.length} plots · {soldCount} sold · {formatCurrency(totalRevenue)} revenue</p>
      {plots.length > 0 ? (
        <div className="space-y-2">
          {plots.map((p) => (
            <div key={p.id} className="border border-slate-200/60 rounded-xl p-3 hover:bg-slate-50/50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm">{p.plot_number || "#"}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{p.plot_number || "Unnamed"}</span>
                      <StatusBadge status={p.status || "available"} />
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {p.area_sqft ? `${Number(p.area_sqft).toLocaleString()} sqft` : "—"}
                      {p.sold_price_per_sqft ? ` · ₹${Number(p.sold_price_per_sqft).toLocaleString()}/sqft` : ""}
                      {p.buyer_name ? ` · ${p.buyer_name}` : ""}
                    </div>
                  </div>
                </div>
                <span className="text-sm font-bold text-emerald-700">{p.calculated_price ? formatCurrency(p.calculated_price) : "—"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400 italic text-center py-4">No plots yet. Manage from Partnership page.</p>
      )}
    </div>
  );
}

/* ─── PLOT BUYERS SECTION (READ-ONLY) ─────────────────────────────────────── */
function PlotBuyersSection({ buyers, totalArea }) {
  const totalBuyerValue = buyers.reduce((s, b) => s + parseFloat(b.total_value || 0), 0);
  const totalAreaAllocated = buyers.reduce((s, b) => s + parseFloat(b.area_sqft || 0), 0);
  const totalPaid = buyers.reduce((s, b) => s + parseFloat(b.total_paid || 0), 0);
  const remainingArea = parseFloat(totalArea || 0) - totalAreaAllocated;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
      <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-1">
        <Users size={16} className="text-indigo-500" /> Buyers
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        {buyers.length} buyer{buyers.length !== 1 ? "s" : ""} · {totalAreaAllocated.toLocaleString()} sqft allocated
        {remainingArea > 0 ? ` · ${remainingArea.toLocaleString()} sqft remaining` : ""}
      </p>
      {buyers.length > 0 ? (
        <div className="space-y-2">
          {buyers.map((b) => {
            const val = parseFloat(b.total_value || 0);
            const paid = parseFloat(b.total_paid || 0);
            const remaining = val - paid;
            const paidPct = val > 0 ? Math.min((paid / val) * 100, 100) : 0;
            return (
              <div key={b.id} className="border border-slate-200/60 rounded-xl p-3.5 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600 font-bold text-xs">{(b.buyer_name || "?")[0].toUpperCase()}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{b.buyer_name || "Unnamed"}</span>
                        <StatusBadge status={b.status} />
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {b.area_sqft ? `${Number(b.area_sqft).toLocaleString()} sqft` : ""}
                        {b.rate_per_sqft ? ` · ₹${Number(b.rate_per_sqft).toLocaleString()}/sqft` : ""}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-500">Paid: {formatCurrency(paid)}</span>
                      <span className="font-medium text-slate-700">Total: {formatCurrency(val)}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className="bg-emerald-500 h-1.5 rounded-full transition-all" style={{ width: `${paidPct}%` }}></div>
                    </div>
                  </div>
                  {remaining > 0 && (
                    <span className="text-rose-600 font-medium whitespace-nowrap">{formatCurrency(remaining)} due</span>
                  )}
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 mt-2">
            <div className="text-center"><div className="text-[10px] text-slate-500">Total Value</div><div className="text-sm font-bold text-slate-800">{formatCurrency(totalBuyerValue)}</div></div>
            <div className="text-center"><div className="text-[10px] text-slate-500">Total Received</div><div className="text-sm font-bold text-emerald-700">{formatCurrency(totalPaid)}</div></div>
            <div className="text-center"><div className="text-[10px] text-slate-500">Remaining</div><div className="text-sm font-bold text-rose-600">{formatCurrency(totalBuyerValue - totalPaid)}</div></div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400 italic text-center py-4">No buyers yet. Manage from Partnership page.</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* MAIN COMPONENT (READ-ONLY)                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => (await api.get(`/api/properties/${id}`)).data,
    retry: 2,
  });

  const deletePropertyMutation = useMutation({
    mutationFn: async () => { await api.delete(`/api/properties/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["properties"] }); navigate("/properties"); },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete"),
  });

  if (isLoading) {
    return (<div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-2 border-indigo-200 border-t-indigo-600"></div></div>);
  }
  if (isError || !data?.property) {
    return (<div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-center"><p className="text-slate-500 mb-4">Property deal not found.</p><button onClick={() => navigate("/properties")} className="text-blue-600 hover:underline">← Back to Properties</button></div></div>);
  }

  const property = data.property;
  const seller = data.seller;
  const lp = data.linked_partnership;
  const isSite = property.property_type === "site";
  const isSettled = property.status === "settled";
  const members = lp?.members || [];
  const plotBuyers = data.plot_buyers || [];
  const partnershipExpenses = data.partnership_expenses || [];

  // Partnership-synced transaction data from the API
  const transactions = data.transactions || [];
  const totalAdvancePool = members.reduce((sum, m) => sum + parseFloat(m.member?.advance_contributed || 0), 0);

  /* ─── RENDER ─── */
  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={property.title || "Property Details"}
        subtitle={`${isSite ? "Site" : "Plot"} · ${property.status?.replace(/_/g, " ")}${property.location ? ` · 📍 ${property.location}` : ""}`}
        backTo="/properties"
        actions={
          <div className="flex gap-2">
            <Button variant="white" icon={Edit} onClick={() => navigate(`/properties/${id}/edit`)}>Edit</Button>
            <Button variant="white" icon={Trash2} onClick={() => { if (window.confirm("Delete this deal?")) deletePropertyMutation.mutate(); }}>Delete</Button>
          </div>
        }
      >
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat label="Total Seller Value" value={formatCurrency(property.total_seller_value || 0)} accent="indigo" />
          <HeroStat label="Advance Paid" value={formatCurrency(property.advance_paid || 0)} accent="amber" />
          <HeroStat label="Broker Commission" value={formatCurrency(property.broker_commission || 0)} accent="violet" />
          <HeroStat label="Status" value={property.status?.replace(/_/g, " ")} accent={isSettled ? "teal" : "amber"} />
        </div>
      </PageHero>

      <PageBody className="max-w-5xl">
        <div className="space-y-5">

          {/* ─── MANAGE FROM PARTNERSHIP NOTICE (always visible) ─── */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
            <h2 className="text-base font-bold text-indigo-800 mb-2">
              {lp ? "Manage from Partnership" : "Create a Partnership"}
            </h2>
            <p className="text-sm text-indigo-700 mb-3">
              {lp
                ? "All transactions, buyer management, and settlement are managed from the linked Partnership page. This page is read-only."
                : "Create a partnership linked to this property to manage transactions, buyers, and settlement."
              }
            </p>
            {lp ? (
              <Link to={`/partnerships/${lp.partnership.id}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] text-sm">
                Open Partnership <ArrowRight size={16} />
              </Link>
            ) : (
              <Link to="/partnerships/new"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] text-sm">
                Create Partnership <ArrowRight size={16} />
              </Link>
            )}
          </div>

          {/* ─── SETTLEMENT BANNER ─── */}
          {isSettled && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-3 flex items-center gap-2">
                <span className="text-white text-lg">✓</span>
                <h3 className="text-sm font-bold text-white tracking-wide">DEAL SETTLED</h3>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                    <div className="text-[11px] font-medium text-blue-700 opacity-70">Total Seller Value</div>
                    <div className="text-base font-bold text-blue-800">{formatCurrency(property.total_seller_value)}</div>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                    <div className="text-[11px] font-medium text-emerald-700 opacity-70">Net Profit</div>
                    <div className="text-base font-bold text-emerald-800">{formatCurrency(property.net_profit)}</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                    <div className="text-[11px] font-medium text-amber-700 opacity-70">Broker Commission</div>
                    <div className="text-base font-bold text-amber-800">{formatCurrency(property.broker_commission)}</div>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
                    <div className="text-[11px] font-medium text-orange-700 opacity-70">Expenses</div>
                    <div className="text-base font-bold text-orange-800">{formatCurrency(property.other_expenses)}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* ─── MAIN COLUMN ─── */}
            <div className="lg:col-span-2 space-y-5">

              {/* Property Overview */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Building size={16} className="text-indigo-500" /> Property Overview
                </h2>
                {!isSite && (
                  <div className="flex justify-center mb-4">
                    <PlotDiagram
                      left={property.side_west_ft || property.side_left_ft}
                      right={property.side_east_ft || property.side_right_ft}
                      top={property.side_north_ft || property.side_top_ft}
                      bottom={property.side_south_ft || property.side_bottom_ft}
                      area={property.total_area_sqft}
                      roads={property.roads_json}
                    />
                  </div>
                )}
                <InfoRow label="Total Area" value={property.total_area_sqft ? `${Number(property.total_area_sqft).toLocaleString()} sqft` : null} />
                <InfoRow label="Seller" value={seller?.name} />
                <InfoRow label="Seller Rate" value={property.seller_rate_per_sqft ? `₹${Number(property.seller_rate_per_sqft).toLocaleString()}/sqft` : null} />
                <InfoRow label="Total Seller Value" value={property.total_seller_value ? formatCurrency(property.total_seller_value) : null} />
                <InfoRow label="Advance Paid" value={parseFloat(property.advance_paid || 0) > 0 ? formatCurrency(property.advance_paid) : null} />
                <InfoRow label="Broker" value={property.broker_name} />
                <InfoRow label="Broker Commission" value={parseFloat(property.broker_commission || 0) > 0 ? formatCurrency(property.broker_commission) : null} />
                {isSite && <InfoRow label="Deal Start Date" value={property.site_deal_start_date ? formatDate(property.site_deal_start_date) : null} />}
              </div>

              {/* Timeline */}
              {(property.negotiating_date || property.deal_locked_date || property.expected_registry_date || property.actual_registry_date) && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Calendar size={16} className="text-indigo-500" /> Timeline
                  </h2>
                  <InfoRow label="Negotiating Date" value={property.negotiating_date ? formatDate(property.negotiating_date) : (property.deal_locked_date ? formatDate(property.deal_locked_date) : null)} />
                  <InfoRow label="Expected Registry" value={property.expected_registry_date ? formatDate(property.expected_registry_date) : null} />
                  {property.actual_registry_date && <InfoRow label="Actual Registry" value={formatDate(property.actual_registry_date)} />}
                </div>
              )}

              {/* PLOT BUYERS (read-only) */}
              {!isSite && plotBuyers.length > 0 && (
                <PlotBuyersSection buyers={plotBuyers} totalArea={property.total_area_sqft} />
              )}

              {/* SITE PLOTS (read-only) */}
              {isSite && (data.site_plots || []).length > 0 && (
                <SitePlotsSection plots={data.site_plots || []} />
              )}

              {/* Partnership Info */}
              {lp && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                      <Users size={16} className="text-indigo-500" /> Partnership
                    </h2>
                    <Link to={`/partnerships/${lp.partnership.id}`} className="text-sm text-blue-600 hover:underline">View Partnership →</Link>
                  </div>
                  <p className="text-sm text-blue-700 bg-blue-50 px-3 py-2.5 rounded-xl mb-3">
                    Linked to: <strong>{lp.partnership.title}</strong> ({members.length} partner{members.length !== 1 ? "s" : ""})
                  </p>
                  {members.length > 0 && (
                    <div className="border border-slate-200/60 rounded-xl overflow-hidden">
                      <table className="min-w-full text-sm">
                        <thead><tr className="border-b border-slate-200 bg-slate-50/50">
                          <th className="text-left py-2.5 px-4 text-slate-500 font-medium text-xs">Partner</th>
                          <th className="text-right py-2.5 px-4 text-slate-500 font-medium text-xs">Share %</th>
                          <th className="text-right py-2.5 px-4 text-slate-500 font-medium text-xs">Advance</th>
                          {isSettled && <th className="text-right py-2.5 px-4 text-slate-500 font-medium text-xs">Total Received</th>}
                        </tr></thead>
                        <tbody>
                          {members.map((m, i) => (
                            <tr key={i} className="border-b border-slate-100 last:border-0">
                              <td className="py-2.5 px-4 font-medium">{m.member.is_self ? "Self (You)" : m.contact?.name || "Unknown"}</td>
                              <td className="text-right py-2.5 px-4">{m.member.share_percentage}%</td>
                              <td className="text-right py-2.5 px-4">{formatCurrency(m.member.advance_contributed)}</td>
                              {isSettled && <td className="text-right py-2.5 px-4 text-emerald-700 font-semibold">{formatCurrency(m.member.total_received)}</td>}
                            </tr>
                          ))}
                          <tr className="border-t border-slate-300 font-semibold bg-slate-50/30">
                            <td className="py-2 px-4">Total</td>
                            <td className="text-right py-2 px-4"></td>
                            <td className="text-right py-2 px-4">{formatCurrency(totalAdvancePool)}</td>
                            {isSettled && <td className="text-right py-2 px-4"></td>}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ─── TRANSACTIONS (read-only) ─── */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <IndianRupee size={16} className="text-indigo-500" /> Transactions
                  </h2>
                  {lp && (
                    <Link to={`/partnerships/${lp.partnership.id}`} className="text-xs text-indigo-600 hover:underline">
                      Manage from Partnership →
                    </Link>
                  )}
                </div>

                {transactions.length > 0 ? (
                  <div className="border border-slate-200/60 rounded-xl overflow-hidden">
                    <table className="min-w-full text-sm">
                      <thead><tr className="border-b border-slate-200 bg-slate-50/50">
                        <th className="text-left py-2.5 px-4 text-slate-500 font-medium text-xs">Date</th>
                        <th className="text-left py-2.5 px-4 text-slate-500 font-medium text-xs">Type</th>
                        <th className="text-right py-2.5 px-4 text-slate-500 font-medium text-xs">Amount</th>
                        <th className="text-left py-2.5 px-4 text-slate-500 font-medium text-xs">Details</th>
                      </tr></thead>
                      <tbody>
                        {transactions.map((t) => {
                          const typeColors = {
                            advance_to_seller: "bg-amber-50 text-amber-700",
                            remaining_to_seller: "bg-amber-50 text-amber-700",
                            advance_given: "bg-amber-50 text-amber-700",
                            received_from_buyer: "bg-emerald-50 text-emerald-700",
                            buyer_advance: "bg-emerald-50 text-emerald-700",
                            buyer_payment: "bg-emerald-50 text-emerald-700",
                            buyer_payment_received: "bg-emerald-50 text-emerald-700",
                            profit_received: "bg-teal-50 text-teal-700",
                            broker_commission: "bg-violet-50 text-violet-700",
                            broker_paid: "bg-violet-50 text-violet-700",
                            expense: "bg-orange-50 text-orange-700",
                            other_expense: "bg-orange-50 text-orange-700",
                            invested: "bg-blue-50 text-blue-700",
                          };
                          const detail = [t.description, t.payer_name && `By: ${t.payer_name}`, t.receiver_name && `To: ${t.receiver_name}`, t.broker_name && `Broker: ${t.broker_name}`].filter(Boolean).join(" · ");
                          return (
                            <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                              <td className="py-2.5 px-4 text-slate-700 text-xs">{formatDate(t.txn_date)}</td>
                              <td className="py-2.5 px-4">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${typeColors[t.txn_type] || "bg-slate-100 text-slate-600"}`}>
                                  {(t.txn_type || "").replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="text-right py-2.5 px-4 font-semibold text-slate-900">{formatCurrency(t.amount)}</td>
                              <td className="py-2.5 px-4 text-xs text-slate-500">{detail || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic text-center py-4">No transactions recorded yet.</p>
                )}

                {partnershipExpenses.length > 0 && (
                  <div className="mt-3 border border-slate-200/60 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200/60">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Partnership Expenses</span>
                    </div>
                    <table className="min-w-full text-sm">
                      <tbody>
                        {partnershipExpenses.map((pe) => (
                          <tr key={`pe-${pe.id}`} className="border-b border-slate-100 last:border-0">
                            <td className="py-2 px-4 text-xs text-slate-700">{formatDate(pe.txn_date)}</td>
                            <td className="py-2 px-4 text-xs text-slate-600">{pe.description || "—"}</td>
                            <td className="py-2 px-4"><span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">{pe.payer_name || "Partner"}</span></td>
                            <td className="text-right py-2 px-4 font-medium text-orange-700 text-xs">{formatCurrency(pe.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* ─── SIDEBAR ─── */}
            <div className="space-y-5">
              {/* Money Flow Summary */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <IndianRupee size={16} className="text-indigo-500" /> Money Flow
                </h2>
                <div className="space-y-2">
                  <div className="flex justify-between py-1.5 border-b border-slate-100">
                    <span className="text-xs text-slate-500">Total Seller Value</span>
                    <span className="text-xs font-semibold text-slate-700">{formatCurrency(property.total_seller_value || 0)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-100">
                    <span className="text-xs text-slate-500">Advance Paid</span>
                    <span className="text-xs font-semibold text-amber-700">{formatCurrency(property.advance_paid || 0)}</span>
                  </div>
                  {parseFloat(property.broker_commission || 0) > 0 && (
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-xs text-slate-500">Broker Commission</span>
                      <span className="text-xs font-semibold text-violet-700">{formatCurrency(property.broker_commission)}</span>
                    </div>
                  )}
                  {parseFloat(property.other_expenses || 0) > 0 && (
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-xs text-slate-500">Expenses</span>
                      <span className="text-xs font-semibold text-orange-700">{formatCurrency(property.other_expenses)}</span>
                    </div>
                  )}
                  {parseFloat(property.total_buyer_value || 0) > 0 && (
                    <div className="flex justify-between py-1.5 border-b border-slate-100">
                      <span className="text-xs text-slate-500">Total Buyer Value</span>
                      <span className="text-xs font-semibold text-emerald-700">{formatCurrency(property.total_buyer_value)}</span>
                    </div>
                  )}
                  {parseFloat(property.total_seller_value || 0) > 0 && (
                    <div className="flex justify-between py-1.5 border-t border-slate-300 mt-2">
                      <span className="text-xs font-semibold text-slate-700">Seller Remaining</span>
                      <span className="text-xs font-bold text-rose-600">
                        {formatCurrency(parseFloat(property.total_seller_value || 0) - parseFloat(property.advance_paid || 0))}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {property.notes && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-5">
                  <h2 className="text-base font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <FileText size={16} className="text-indigo-500" /> Notes
                  </h2>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{property.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
