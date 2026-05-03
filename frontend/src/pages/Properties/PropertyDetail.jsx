import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

/* ─── Stage pipeline ────────────────────────────────────────────────────────── */
const STAGES = [
  { key: "negotiating",   label: "Negotiation" },
  { key: "advance_given", label: "Advance" },
  { key: "registry_done", label: "Registry" },
  { key: "buyer_found",   label: "Buyer Found" },
  { key: "settled",       label: "Settled" },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

function stageIdx(status) { return STAGE_INDEX[status] ?? 0; }

function StageBar({ status }) {
  if (status === "cancelled")
    return <div className="text-xs text-rose-400 font-medium">❌ Cancelled</div>;
  const idx = stageIdx(status);
  return (
    <div>
      <div className="flex items-center">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-cyan-500" : "bg-slate-700"}`} />
            {i < STAGES.length - 1 && (
              <div className={`w-2 h-2 rounded-full shrink-0 mx-1 border-2 ${i < idx ? "bg-cyan-500 border-cyan-500" : i === idx ? "bg-cyan-500 border-cyan-400" : "bg-slate-700 border-slate-600"}`} />
            )}
          </div>
        ))}
      </div>
      <div className="flex mt-1.5">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex-1 text-center">
            <span className={`text-[9px] font-medium ${i === idx ? "text-cyan-400" : i < idx ? "text-slate-500" : "text-slate-600"}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── PLOT DIAGRAM ──────────────────────────────────────────────────────────── */
function PlotDiagram({ left, right, top, bottom, area, roads }) {
  const hasAny = left || right || top || bottom;
  if (!hasAny) return null;
  const l = parseFloat(left) || 0, r = parseFloat(right) || 0;
  const t = parseFloat(top) || 0, b = parseFloat(bottom) || 0;
  let parsedRoads = [];
  try { if (roads) parsedRoads = typeof roads === "string" ? JSON.parse(roads) : roads; } catch { /**/ }
  const maxSide = Math.max(l, r, t, b, 1);
  const BASE_W = 200, BASE_H = 140, PAD = 55, ROAD_W = 22;
  const topW = t > 0 ? Math.max((t / maxSide) * BASE_W, 80) : BASE_W;
  const botW = b > 0 ? Math.max((b / maxSide) * BASE_W, 80) : BASE_W;
  const leftH = l > 0 ? Math.max((l / maxSide) * BASE_H, 60) : BASE_H;
  const rightH = r > 0 ? Math.max((r / maxSide) * BASE_H, 60) : BASE_H;
  const plotH = Math.max(leftH, rightH);
  const svgW = Math.max(topW, botW) + PAD * 2 + ROAD_W * 2;
  const svgH = plotH + PAD * 2 + ROAD_W * 2;
  const cx = svgW / 2, oY = PAD + ROAD_W;
  const x3 = cx + botW / 2, y4 = oY + plotH, x4 = cx - botW / 2;
  const y1L = oY + (plotH - leftH), y1R = oY + (plotH - rightH);
  const points = `${x4},${y4} ${cx - topW / 2},${y1L} ${cx + topW / 2},${y1R} ${x3},${y4}`;
  const midY = (Math.min(y1L, y1R) + y4) / 2;
  const roadRects = parsedRoads.map((rd, i) => {
    const dir = (rd.direction || "").toLowerCase();
    const w = parseFloat(rd.width_ft) || 20;
    const label = `Road ${w}ft`;
    if (dir === "north") return (<g key={i}><rect x={cx - topW / 2 - 5} y={Math.min(y1L, y1R) - ROAD_W - 2} width={topW + 10} height={ROAD_W} rx={3} fill="#1e293b" stroke="#334155" strokeWidth={1} /><text x={cx} y={Math.min(y1L, y1R) - ROAD_W / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#94a3b8">{label}</text></g>);
    if (dir === "south") return (<g key={i}><rect x={cx - botW / 2 - 5} y={y4 + 2} width={botW + 10} height={ROAD_W} rx={3} fill="#1e293b" stroke="#334155" strokeWidth={1} /><text x={cx} y={y4 + ROAD_W / 2 + 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#94a3b8">{label}</text></g>);
    if (dir === "east") return (<g key={i}><rect x={Math.max(x3, cx + topW / 2) + 2} y={Math.min(y1R, y1L)} width={ROAD_W} height={plotH} rx={3} fill="#1e293b" stroke="#334155" strokeWidth={1} /><text x={Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#94a3b8" transform={`rotate(90, ${Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2}, ${midY})`}>{label}</text></g>);
    if (dir === "west") return (<g key={i}><rect x={Math.min(x4, cx - topW / 2) - ROAD_W - 2} y={Math.min(y1L, y1R)} width={ROAD_W} height={plotH} rx={3} fill="#1e293b" stroke="#334155" strokeWidth={1} /><text x={Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#94a3b8" transform={`rotate(-90, ${Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2}, ${midY})`}>{label}</text></g>);
    return null;
  });
  return (
    <svg width={svgW} height={svgH} style={{ overflow: "visible" }}>
      {roadRects}
      <polygon points={points} fill="#0f172a" stroke="#22d3ee" strokeWidth={1.5} strokeLinejoin="round" />
      <text x={cx} y={Math.min(y1L, y1R) - 16} textAnchor="middle" fontSize={11} fill="#67e8f9">{top ? `N: ${top}ft` : "—"}</text>
      <text x={cx} y={y4 + 20} textAnchor="middle" fontSize={11} fill="#67e8f9">{bottom ? `S: ${bottom}ft` : "—"}</text>
      <text x={Math.min(x4, cx - topW / 2) - 8} y={(y1L + y4) / 2} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#67e8f9">{left ? `W: ${left}ft` : "—"}</text>
      <text x={Math.max(x3, cx + topW / 2) + 8} y={(y1R + y4) / 2} textAnchor="start" dominantBaseline="middle" fontSize={11} fill="#67e8f9">{right ? `E: ${right}ft` : "—"}</text>
      {area && <text x={cx} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#22d3ee" fontWeight="600">{Number(area).toLocaleString()} sqft</text>}
    </svg>
  );
}

/* ─── Share Summary Modal ───────────────────────────────────────────────────── */
function ShareModal({ property, members, transactions, onClose }) {
  const selfMember = members.find(m => m.member?.is_self);
  const myShare = parseFloat(selfMember?.member?.share_percentage || property.my_share_percentage || 0);
  const advancePaid = parseFloat(property.advance_paid || 0);
  const totalSeller = parseFloat(property.total_seller_value || 0);
  const lines = [
    `📋 PROPERTY DEAL SUMMARY`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🏠 ${property.title}`,
    property.location ? `📍 ${property.location}` : null,
    `Status: ${property.status?.replace(/_/g, " ").toUpperCase()}`,
    ``,
    `💰 FINANCIALS`,
    `Total Seller Value: ${formatCurrency(totalSeller)}`,
    `Advance Paid: ${formatCurrency(advancePaid)}`,
    `Remaining: ${formatCurrency(Math.max(0, totalSeller - advancePaid))}`,
    myShare > 0 ? `My Share: ${myShare}%` : null,
    property.expected_registry_date ? `Expected Registry: ${formatDate(property.expected_registry_date)}` : null,
    ``,
    `🤝 PARTNERS`,
    ...members.map(m => `  • ${m.member?.is_self ? "You" : m.contact?.name || "Partner"}: ${m.member?.share_percentage}% — ${formatCurrency(m.member?.advance_contributed)}`),
    ``,
    `Generated: ${new Date().toLocaleDateString("en-IN")}`,
  ].filter(l => l !== null).join("\n");

  function handleDownload() {
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${property.title.replace(/\s+/g, "_")}_summary.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-white">Shareable Summary</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
        </div>
        <div className="p-5">
          <pre className="bg-slate-950 border border-slate-700 rounded-xl p-4 text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
            {lines}
          </pre>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => { navigator.clipboard.writeText(lines); }}
              className="flex-1 py-2 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 rounded-xl text-xs font-semibold hover:bg-cyan-500/30 transition"
            >
              📋 Copy Text
            </button>
            <button
              onClick={handleDownload}
              className="flex-1 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-600 transition"
            >
              ⬇ Download .txt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Dark section wrapper ──────────────────────────────────────────────────── */
function Section({ title, icon, children, accent, right }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60">
        <div className="flex items-center gap-2">
          {icon && <span className="text-sm">{icon}</span>}
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">{title}</h2>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─── Metric card ───────────────────────────────────────────────────────────── */
function MetricCard({ label, value, sub, accent = "cyan", size = "md" }) {
  const ACCENT = {
    cyan:   { text: "text-cyan-400",   bg: "bg-cyan-500/10 border-cyan-500/30" },
    amber:  { text: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/30" },
    emerald:{ text: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/30" },
    rose:   { text: "text-rose-400",   bg: "bg-rose-500/10 border-rose-500/30" },
    violet: { text: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/30" },
    slate:  { text: "text-slate-300",  bg: "bg-slate-700/40 border-slate-600/40" },
  };
  const a = ACCENT[accent] || ACCENT.slate;
  return (
    <div className={`rounded-xl border p-4 ${a.bg}`}>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className={`font-bold ${a.text} ${size === "lg" ? "text-2xl" : "text-base"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─── Status badge ──────────────────────────────────────────────────────────── */
const STATUS_CHIP = {
  negotiating:  "bg-slate-700 text-slate-300",
  advance_given:"bg-amber-500/20 text-amber-300 border border-amber-500/30",
  registry_done:"bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
  buyer_found:  "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  settled:      "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  cancelled:    "bg-rose-500/20 text-rose-300 border border-rose-500/30",
};
function StatusBadge({ status }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${STATUS_CHIP[status] || STATUS_CHIP.negotiating}`}>
      {(status || "").replace(/_/g, " ")}
    </span>
  );
}

/* ─── SITE PLOTS (read-only) ────────────────────────────────────────────────── */
function SitePlotsSection({ plots }) {
  const soldCount = plots.filter(p => ["sold","registered","fully_paid"].includes(p.status)).length;
  return (
    <Section title="Site Plots" icon="🗺️"
      right={<span className="text-[10px] text-slate-500">{soldCount}/{plots.length} sold</span>}>
      <div className="space-y-2">
        {plots.map(p => {
          const val = parseFloat(p.calculated_price || 0);
          const paid = parseFloat(p.total_paid || 0);
          const pct = val > 0 ? Math.min((paid / val) * 100, 100) : 0;
          return (
            <div key={p.id} className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-xs">
                    {p.plot_number ? p.plot_number.slice(0,2).toUpperCase() : "PN"}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">{p.plot_number || p.buyer_name || `Plot #${p.id}`}</p>
                    <p className="text-[10px] text-slate-400">{p.area_sqft ? `${Number(p.area_sqft).toLocaleString()} sqft` : "—"}{p.sold_price_per_sqft ? ` · ₹${Number(p.sold_price_per_sqft).toLocaleString()}/sqft` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={p.status || "available"} />
                  <span className="text-xs font-bold text-emerald-400">{val > 0 ? formatCurrency(val) : "—"}</span>
                </div>
              </div>
              {val > 0 && (
                <div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                  <div className="flex justify-between mt-1 text-[9px] text-slate-500"><span>Paid {formatCurrency(paid)}</span><span>{formatCurrency(val - paid)} remaining</span></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ─── PLOT BUYERS (read-only) ───────────────────────────────────────────────── */
function PlotBuyersSection({ buyers, totalArea }) {
  const totalBuyerValue = buyers.reduce((s, b) => s + parseFloat(b.total_value || 0), 0);
  const totalPaid = buyers.reduce((s, b) => s + parseFloat(b.total_paid || 0), 0);
  const totalAllocated = buyers.reduce((s, b) => s + parseFloat(b.area_sqft || 0), 0);
  return (
    <Section title="Buyers" icon="👥"
      right={<span className="text-[10px] text-slate-500">{totalAllocated.toLocaleString()} sqft allocated</span>}>
      <div className="space-y-2">
        {buyers.map(b => {
          const val = parseFloat(b.total_value || 0);
          const paid = parseFloat(b.total_paid || 0);
          const pct = val > 0 ? Math.min((paid / val) * 100, 100) : 0;
          return (
            <div key={b.id} className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-[10px]">
                    {b.buyer_name ? b.buyer_name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() : "??"}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">{b.buyer_name || `Buyer #${b.id}`}</p>
                    <p className="text-[10px] text-slate-400">{b.area_sqft ? `${Number(b.area_sqft).toLocaleString()} sqft` : ""}
                    {b.rate_per_sqft ? ` · ₹${Number(b.rate_per_sqft).toLocaleString()}/sqft` : ""}</p>
                  </div>
                </div>
                <StatusBadge status={b.status} />
              </div>
              {val > 0 && (
                <div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                  <div className="flex justify-between mt-1 text-[9px] text-slate-500">
                    <span>Paid {formatCurrency(paid)}</span>
                    {val - paid > 0 && <span className="text-amber-400">{formatCurrency(val - paid)} due</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="grid grid-cols-3 gap-2 mt-1 pt-3 border-t border-slate-700/60 text-center">
          <div><p className="text-[9px] text-slate-500">Total Value</p><p className="text-xs font-bold text-slate-300">{formatCurrency(totalBuyerValue)}</p></div>
          <div><p className="text-[9px] text-slate-500">Received</p><p className="text-xs font-bold text-emerald-400">{formatCurrency(totalPaid)}</p></div>
          <div><p className="text-[9px] text-slate-500">Remaining</p><p className="text-xs font-bold text-rose-400">{formatCurrency(totalBuyerValue - totalPaid)}</p></div>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
────────────────────────────────────────────────────────────────────────────── */
export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showShare, setShowShare] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => (await api.get(`/api/properties/${id}`)).data,
    retry: 2,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await api.delete(`/api/properties/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["properties"] }); navigate("/properties"); },
    onError: err => alert(err?.response?.data?.detail || "Failed to delete"),
  });

  if (isLoading) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="w-12 h-12 border-2 border-slate-700 border-t-cyan-500 rounded-full animate-spin" />
    </div>
  );
  if (isError || !data?.property) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="text-center">
        <p className="text-slate-400 mb-4">Property deal not found.</p>
        <button onClick={() => navigate("/properties")} className="text-cyan-400 hover:underline text-sm">← Back</button>
      </div>
    </div>
  );

  /* ── Data extraction ── */
  const property = data.property;
  const seller   = data.seller;
  const lp       = data.linked_partnership;
  const isSite   = property.property_type === "site";
  const isSettled= property.status === "settled";
  const members  = lp?.members || [];
  const plotBuyers = data.plot_buyers || [];
  const transactions = data.transactions || [];
  const partnershipExpenses = data.partnership_expenses || [];

  const selfMember = members.find(m => m.member?.is_self);
  const myShare = parseFloat(selfMember?.member?.share_percentage || property.my_share_percentage || 0);
  const myInvested = parseFloat(selfMember?.member?.advance_contributed || property.my_investment || 0);
  const totalSeller = parseFloat(property.total_seller_value || 0);
  const advancePaid = parseFloat(property.advance_paid || 0);
  const totalAdvancePool = members.reduce((s, m) => s + parseFloat(m.member?.advance_contributed || 0), 0);

  const furtherPaid = transactions
    .filter(t => t.txn_type === "remaining_to_seller" || t.txn_type === "payment_to_seller")
    .reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const totalSentToSeller = advancePaid + furtherPaid;
  const remainingOwedToSeller = Math.max(0, totalSeller - totalSentToSeller);

  // My personal remaining commitment = (remaining × my share%)
  const myRemainingCommitment = myShare > 0 ? remainingOwedToSeller * (myShare / 100) : remainingOwedToSeller;
  const myProfitWithdrawn = transactions
    .filter(t => ["profit_received","profit_distributed"].includes(t.txn_type) &&
      (!t.received_by_member_id || t.received_by_member_id === selfMember?.member?.id))
    .reduce((s, t) => s + parseFloat(t.amount || 0), 0);

  // Financial breakdown
  const sellerRatePerSqft = parseFloat(property.seller_rate_per_sqft || 0);
  const totalArea = parseFloat(property.total_area_sqft || 0);
  const brokerComm = parseFloat(property.broker_commission || 0);
  const otherExp = parseFloat(property.other_expenses || 0);
  const extraExpenses = brokerComm + otherExp;
  const totalCost = totalSeller + extraExpenses;
  const breakevenRatePerSqft = totalArea > 0 ? totalCost / totalArea : 0;
  const buyerRate = parseFloat(property.buyer_rate_per_sqft || 0);
  const profitPerSqft = buyerRate > 0 && breakevenRatePerSqft > 0 ? buyerRate - breakevenRatePerSqft : 0;

  // Days to registry
  const daysToRegistry = property.expected_registry_date
    ? Math.ceil((new Date(property.expected_registry_date) - new Date()) / 86400000)
    : null;
  const registryUrgent = daysToRegistry !== null && daysToRegistry >= 0 && daysToRegistry <= 14;

  // Next action for timeline
  function getNextAction() {
    const s = property.status;
    if (s === "negotiating") return { label: "Finalise deal terms & pay advance", icon: "🤝" };
    if (s === "advance_given" && property.expected_registry_date) {
      const d = daysToRegistry;
      if (d !== null) return { label: `Registry on ${formatDate(property.expected_registry_date)}${d <= 14 ? ` — ${d < 0 ? "OVERDUE" : `${d} days away`}` : ""}`, icon: d <= 14 ? "🔴" : "📅", urgent: d <= 14 };
    }
    if (s === "advance_given") return { label: "Find buyer & arrange registry", icon: "🏡" };
    if (s === "buyer_found") return { label: "Complete registry & collect payment", icon: "📝" };
    if (s === "registry_done") return { label: "Settle remaining amounts & close deal", icon: "🏁" };
    if (s === "settled") return null;
    return null;
  }
  const nextAction = getNextAction();

  // Partner names for display
  const partnerNames = members
    .filter(m => !m.member?.is_self && m.contact?.name)
    .map(m => m.contact.name);

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {showShare && (
        <ShareModal
          property={property}
          members={members}
          transactions={transactions}
          onClose={() => setShowShare(false)}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* ── Top navigation + actions ── */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <button
              onClick={() => navigate("/properties")}
              className="text-slate-500 hover:text-slate-300 text-xs mb-2 flex items-center gap-1 transition"
            >
              ← Properties
            </button>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-white tracking-tight">{property.title}</h1>
              <StatusBadge status={property.status} />
              <span className="text-xs text-slate-500 capitalize">{property.property_type}</span>
              {property.location && <span className="text-xs text-slate-400">📍 {property.location}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowShare(true)}
              className="px-3 py-1.5 bg-slate-700 border border-slate-600 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-600 transition"
            >
              🔗 Share
            </button>
            <button
              onClick={() => navigate(`/properties/${id}/edit`)}
              className="px-3 py-1.5 bg-slate-700 border border-slate-600 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-600 transition"
            >
              ✏ Edit
            </button>
            <button
              onClick={() => { if (window.confirm("Delete this deal?")) deleteMutation.mutate(); }}
              className="px-3 py-1.5 bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-xl text-xs font-semibold hover:bg-rose-500/30 transition"
            >
              🗑
            </button>
          </div>
        </div>

        {/* ── Stage progress ── */}
        <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl px-5 py-4">
          <StageBar status={property.status} />
        </div>

        {/* ── Hero stat row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="Total Deal Value" value={formatCurrency(totalSeller)} accent="slate" />
          <MetricCard label="My Investment" value={formatCurrency(myInvested)} sub={myShare > 0 ? `${myShare}% ownership` : undefined} accent="cyan" />
          <MetricCard label="My Remaining Commitment" value={myRemainingCommitment > 0 ? formatCurrency(myRemainingCommitment) : "None"} sub={myRemainingCommitment > 0 ? `${myShare > 0 ? `${myShare}% of ` : ""}${formatCurrency(remainingOwedToSeller)} outstanding` : "Fully deployed"} accent={myRemainingCommitment > 0 ? "amber" : "emerald"} />
          <MetricCard label={isSettled ? "Net Profit" : "Projected Profit"} value={formatCurrency(property.net_profit || 0)} sub={myShare > 0 && property.net_profit > 0 ? `My share: ${formatCurrency(parseFloat(property.net_profit) * myShare / 100)}` : undefined} accent={parseFloat(property.net_profit || 0) > 0 ? "emerald" : "rose"} />
        </div>

        {/* ── Partnership link + Quick Actions ── */}
        <div className="flex flex-wrap gap-3">
          {lp ? (
            <Link to={`/partnerships/${lp.partnership.id}`}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-semibold hover:bg-cyan-500/20 transition">
              🤝 Open Partnership: {lp.partnership.title} →
            </Link>
          ) : (
            <Link to="/partnerships/new"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 rounded-xl text-xs font-semibold hover:bg-indigo-500/20 transition">
              + Create Partnership
            </Link>
          )}
          {partnerNames.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/60 border border-slate-700/60 rounded-xl">
              <span className="text-[10px] text-slate-400">Partners:</span>
              {partnerNames.map((n, i) => (
                <span key={i} className="text-[10px] font-semibold text-slate-200 bg-slate-700 px-1.5 py-0.5 rounded">{n}</span>
              ))}
            </div>
          )}
        </div>

        {/* ── Settlement banner ── */}
        {isSettled && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs">✓</div>
              <h3 className="text-sm font-bold text-emerald-300 uppercase tracking-widest">Deal Settled</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Seller Cost" value={formatCurrency(property.total_seller_value)} accent="slate" />
              <MetricCard label="Net Profit" value={formatCurrency(property.net_profit)} accent="emerald" />
              <MetricCard label="Broker" value={formatCurrency(property.broker_commission)} accent="violet" />
              <MetricCard label="Expenses" value={formatCurrency(property.other_expenses)} accent="amber" />
            </div>
          </div>
        )}

        {/* ── Main 2-column grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* ── LEFT: main column ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* My Personal Stake card */}
            <Section title="My Personal Stake" icon="👤">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3.5">
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">Invested So Far</p>
                  <p className="text-lg font-bold text-cyan-400">{formatCurrency(myInvested)}</p>
                  {advancePaid > 0 && myInvested !== advancePaid && (
                    <p className="text-[10px] text-slate-500 mt-0.5">Pool advance: {formatCurrency(advancePaid)}</p>
                  )}
                </div>
                <div className={`border rounded-xl p-3.5 ${myRemainingCommitment > 0 ? "bg-amber-500/5 border-amber-500/30" : "bg-emerald-500/5 border-emerald-500/30"}`}>
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">Still to Pay</p>
                  <p className={`text-lg font-bold ${myRemainingCommitment > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                    {myRemainingCommitment > 0 ? formatCurrency(myRemainingCommitment) : "Complete ✓"}
                  </p>
                  {myRemainingCommitment > 0 && (
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {myShare > 0 ? `${myShare}% of ` : ""}{formatCurrency(remainingOwedToSeller)} total remaining
                    </p>
                  )}
                </div>
              </div>
              {/* Investment bar */}
              {totalSeller > 0 && (
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                    <span>Paid to seller: {formatCurrency(totalSentToSeller)}</span>
                    <span>{Math.round((totalSentToSeller / totalSeller) * 100)}% of {formatCurrency(totalSeller)}</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all"
                      style={{ width: `${Math.min((totalSentToSeller / totalSeller) * 100, 100)}%` }} />
                  </div>
                  {remainingOwedToSeller > 0 && (
                    <p className="text-[10px] text-amber-400 mt-1.5">
                      ⚠ {formatCurrency(remainingOwedToSeller)} still owed to seller
                      {myShare > 0 ? ` · My share: ${formatCurrency(myRemainingCommitment)}` : ""}
                    </p>
                  )}
                </div>
              )}
              {myProfitWithdrawn > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700/60 flex items-center gap-2">
                  <span className="text-emerald-400 text-xs">✓</span>
                  <span className="text-xs text-slate-300">Profit withdrawn: <strong className="text-emerald-400">{formatCurrency(myProfitWithdrawn)}</strong></span>
                </div>
              )}
            </Section>

            {/* Financial Breakdown Table */}
            {(sellerRatePerSqft > 0 || totalArea > 0) && (
              <Section title="Financial Breakdown" icon="📊">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 text-slate-400 font-semibold uppercase tracking-wide">Metric</th>
                        <th className="text-right py-2 text-slate-400 font-semibold uppercase tracking-wide">Value</th>
                        <th className="text-right py-2 text-slate-400 font-semibold uppercase tracking-wide">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/60">
                      <tr>
                        <td className="py-2.5 text-slate-300">Seller Rate</td>
                        <td className="text-right py-2.5 font-semibold text-amber-400">
                          {sellerRatePerSqft > 0 ? `₹${Number(sellerRatePerSqft).toLocaleString()}/sqft` : "—"}
                        </td>
                        <td className="text-right py-2.5 text-slate-500">Base cost</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-slate-300">Total Area</td>
                        <td className="text-right py-2.5 font-semibold text-slate-200">
                          {totalArea > 0 ? `${Number(totalArea).toLocaleString()} sqft` : "—"}
                        </td>
                        <td className="text-right py-2.5 text-slate-500">Plot size</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-slate-300">Total Seller Cost</td>
                        <td className="text-right py-2.5 font-semibold text-slate-200">{formatCurrency(totalSeller)}</td>
                        <td className="text-right py-2.5 text-slate-500">Purchase price</td>
                      </tr>
                      {brokerComm > 0 && (
                        <tr>
                          <td className="py-2.5 text-slate-300">Broker Commission</td>
                          <td className="text-right py-2.5 font-semibold text-violet-400">{formatCurrency(brokerComm)}</td>
                          <td className="text-right py-2.5 text-slate-500">{property.broker_name || "Broker"}</td>
                        </tr>
                      )}
                      {otherExp > 0 && (
                        <tr>
                          <td className="py-2.5 text-slate-300">Extra Expenses (Kharcha)</td>
                          <td className="text-right py-2.5 font-semibold text-orange-400">{formatCurrency(otherExp)}</td>
                          <td className="text-right py-2.5 text-slate-500">Misc costs</td>
                        </tr>
                      )}
                      {extraExpenses > 0 && (
                        <tr>
                          <td className="py-2.5 text-slate-300 font-semibold">Total All-in Cost</td>
                          <td className="text-right py-2.5 font-bold text-white">{formatCurrency(totalCost)}</td>
                          <td className="text-right py-2.5 text-slate-500">Seller + expenses</td>
                        </tr>
                      )}
                      {totalArea > 0 && totalCost > 0 && (
                        <tr className="bg-slate-700/20">
                          <td className="py-2.5 text-cyan-300 font-bold">Break-even Rate</td>
                          <td className="text-right py-2.5 font-bold text-cyan-400">
                            ₹{Number(Math.round(breakevenRatePerSqft)).toLocaleString()}/sqft
                          </td>
                          <td className="text-right py-2.5 text-slate-500">Must sell above this</td>
                        </tr>
                      )}
                      {buyerRate > 0 && breakevenRatePerSqft > 0 && (
                        <tr className="bg-emerald-500/5">
                          <td className="py-2.5 text-emerald-300 font-bold">Buyer Rate</td>
                          <td className="text-right py-2.5 font-bold text-emerald-400">₹{Number(Math.round(buyerRate)).toLocaleString()}/sqft</td>
                          <td className="text-right py-2.5 text-emerald-500/70">
                            {profitPerSqft > 0 ? `+₹${Math.round(profitPerSqft).toLocaleString()}/sqft profit` : "Below breakeven"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Actionable Timeline */}
            {(() => {
              const events = [];
              if (property.negotiating_date) events.push({ date: property.negotiating_date, label: "Negotiation Started", icon: "🤝", milestone: true });
              const txnMeta = {
                advance_to_seller: ["Advance Given to Seller", "💸"],
                advance_given:     ["Advance Given to Seller", "💸"],
                remaining_to_seller:["Remaining Paid to Seller", "💰"],
                payment_to_seller: ["Payment to Seller", "💰"],
                broker_commission: ["Broker Commission Paid", "🏷"],
                broker_paid:       ["Broker Commission Paid", "🏷"],
                expense:           ["Expense Recorded", "📋"],
                other_expense:     ["Expense Recorded", "📋"],
                buyer_advance:     ["Buyer Advance Received", "🟢"],
                buyer_payment:     ["Buyer Payment Received", "🟢"],
                profit_received:   ["Profit Received", "✅"],
              };
              transactions.forEach(t => {
                const [label, icon] = txnMeta[t.txn_type] || [t.txn_type.replace(/_/g, " "), "📌"];
                const detail = [t.description, t.payer_name && `By: ${t.payer_name}`, t.receiver_name && `To: ${t.receiver_name}`].filter(Boolean).join(" · ");
                events.push({ date: t.txn_date, label: `${label} — ${formatCurrency(t.amount)}`, icon, detail });
              });
              if (property.expected_registry_date && !property.actual_registry_date)
                events.push({ date: property.expected_registry_date, label: "Expected Registry", icon: registryUrgent ? "🔴" : "📅", milestone: true, future: true, urgent: registryUrgent });
              if (property.actual_registry_date)
                events.push({ date: property.actual_registry_date, label: "Registry Completed", icon: "✓", milestone: true });
              events.sort((a, b) => a.date.localeCompare(b.date));
              const grouped = {};
              events.forEach(e => { if (!grouped[e.date]) grouped[e.date] = []; grouped[e.date].push(e); });
              const dateKeys = Object.keys(grouped).sort();
              if (dateKeys.length === 0 && !nextAction) return null;
              return (
                <Section title="Timeline" icon="📅">
                  {nextAction && (
                    <div className={`mb-4 flex items-start gap-3 px-4 py-3 rounded-xl border ${nextAction.urgent ? "bg-rose-500/10 border-rose-500/30" : "bg-cyan-500/10 border-cyan-500/30"}`}>
                      <span className="text-base mt-0.5">{nextAction.icon}</span>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Next Action</p>
                        <p className={`text-xs font-semibold ${nextAction.urgent ? "text-rose-300" : "text-cyan-300"}`}>{nextAction.label}</p>
                      </div>
                    </div>
                  )}
                  {dateKeys.length > 0 && (
                    <div className="relative">
                      {dateKeys.map((dateStr, di) => (
                        <div key={dateStr} className="relative pl-6 pb-4 last:pb-0">
                          {di < dateKeys.length - 1 && <div className="absolute left-[9px] top-5 bottom-0 w-px bg-slate-700" />}
                          <div className={`absolute left-0 top-1 w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 ${grouped[dateStr][0].future ? "bg-slate-800 border-cyan-500/60" : "bg-slate-700 border-slate-500"}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${grouped[dateStr][0].future ? "bg-cyan-400" : "bg-slate-400"}`} />
                          </div>
                          <p className="text-[10px] font-bold text-slate-400 mb-1">{formatDate(dateStr)}</p>
                          {grouped[dateStr].map((ev, ei) => (
                            <div key={ei} className={`ml-1 ${ei > 0 ? "mt-1.5" : ""} flex items-start gap-2`}>
                              <span className="text-sm shrink-0">{ev.icon}</span>
                              <div>
                                <p className={`text-xs ${ev.milestone ? "font-semibold text-slate-200" : "text-slate-300"}`}>{ev.label}</p>
                                {ev.detail && <p className="text-[10px] text-slate-500">{ev.detail}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              );
            })()}

            {/* Buyers / Site Plots */}
            {!isSite && plotBuyers.length > 0 && (
              <PlotBuyersSection buyers={plotBuyers} totalArea={property.total_area_sqft} />
            )}
            {isSite && (data.site_plots || []).length > 0 && (
              <SitePlotsSection plots={data.site_plots || []} />
            )}

            {/* Partnership members */}
            {lp && members.length > 0 && (
              <Section title="Partnership Members" icon="🤝"
                right={<Link to={`/partnerships/${lp.partnership.id}`} className="text-[10px] text-cyan-400 hover:underline">Open →</Link>}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 text-slate-400 font-semibold">Partner</th>
                        <th className="text-right py-2 text-slate-400 font-semibold">Share %</th>
                        <th className="text-right py-2 text-slate-400 font-semibold">Advance</th>
                        {isSettled && <th className="text-right py-2 text-slate-400 font-semibold">Received</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/40">
                      {members.map((m, i) => (
                        <tr key={i}>
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[9px] font-bold text-slate-300">
                                {m.member?.is_self ? "ME" : (m.contact?.name?.[0] || "P")}
                              </div>
                              <span className={`font-medium ${m.member?.is_self ? "text-cyan-300" : "text-slate-200"}`}>
                                {m.member?.is_self ? "You" : m.contact?.name || "Partner"}
                              </span>
                            </div>
                          </td>
                          <td className="text-right py-2.5 text-slate-300">{m.member?.share_percentage}%</td>
                          <td className="text-right py-2.5 text-amber-400 font-semibold">{formatCurrency(m.member?.advance_contributed)}</td>
                          {isSettled && <td className="text-right py-2.5 text-emerald-400 font-semibold">{formatCurrency(m.member?.total_received)}</td>}
                        </tr>
                      ))}
                      <tr className="border-t border-slate-600">
                        <td className="py-2 text-slate-400 font-semibold">Total</td>
                        <td className="text-right py-2 text-slate-400">{members.reduce((s,m) => s + parseFloat(m.member?.share_percentage||0),0)}%</td>
                        <td className="text-right py-2 text-amber-400 font-bold">{formatCurrency(totalAdvancePool)}</td>
                        {isSettled && <td />}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Transactions */}
            <Section title="Transactions" icon="💳"
              right={lp && <Link to={`/partnerships/${lp.partnership.id}`} className="text-[10px] text-cyan-400 hover:underline">Manage from Partnership →</Link>}>
              {transactions.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-4">No transactions recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 text-slate-400 font-semibold">Date</th>
                        <th className="text-left py-2 text-slate-400 font-semibold">Type</th>
                        <th className="text-right py-2 text-slate-400 font-semibold">Amount</th>
                        <th className="text-left py-2 text-slate-400 font-semibold">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/40">
                      {transactions.map(t => {
                        const typeStyle = {
                          advance_to_seller: "text-amber-400 bg-amber-500/10",
                          advance_given:     "text-amber-400 bg-amber-500/10",
                          remaining_to_seller:"text-amber-400 bg-amber-500/10",
                          payment_to_seller: "text-amber-400 bg-amber-500/10",
                          received_from_buyer:"text-emerald-400 bg-emerald-500/10",
                          buyer_advance:     "text-emerald-400 bg-emerald-500/10",
                          buyer_payment:     "text-emerald-400 bg-emerald-500/10",
                          profit_received:   "text-teal-400 bg-teal-500/10",
                          broker_commission: "text-violet-400 bg-violet-500/10",
                          broker_paid:       "text-violet-400 bg-violet-500/10",
                          expense:           "text-orange-400 bg-orange-500/10",
                          other_expense:     "text-orange-400 bg-orange-500/10",
                        }[t.txn_type] || "text-slate-300 bg-slate-700/50";
                        const detail = [t.description, t.payer_name && `By: ${t.payer_name}`, t.receiver_name && `→ ${t.receiver_name}`].filter(Boolean).join(" · ");
                        return (
                          <tr key={t.id} className="hover:bg-slate-700/20 transition">
                            <td className="py-2.5 text-slate-400">{formatDate(t.txn_date)}</td>
                            <td className="py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeStyle}`}>
                                {(t.txn_type || "").replace(/_/g, " ")}
                              </span>
                            </td>
                            <td className="text-right py-2.5 font-bold text-white">{formatCurrency(t.amount)}</td>
                            <td className="py-2.5 text-slate-500">{detail || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {partnershipExpenses.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700/60">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-2">Partnership Expenses</p>
                  {partnershipExpenses.map(pe => (
                    <div key={pe.id} className="flex items-center justify-between py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">{formatDate(pe.txn_date)}</span>
                        <span className="text-slate-300">{pe.description || "—"}</span>
                        <span className="text-[10px] bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">{pe.payer_name || "Partner"}</span>
                      </div>
                      <span className="font-semibold text-orange-400">{formatCurrency(pe.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

          </div>

          {/* ── RIGHT: sidebar ── */}
          <div className="space-y-5">

            {/* Money Flow */}
            <Section title="Money Flow" icon="💸">
              <div className="space-y-2">
                {[
                  { label: "Seller Asking Price", val: formatCurrency(totalSeller), cls: "text-slate-300" },
                  { label: "Advance Paid", val: formatCurrency(advancePaid), cls: "text-amber-400" },
                  furtherPaid > 0 && { label: "Further Paid", val: formatCurrency(furtherPaid), cls: "text-amber-400" },
                  brokerComm > 0 && { label: "Broker Commission", val: formatCurrency(brokerComm), cls: "text-violet-400" },
                  otherExp > 0 && { label: "Other Expenses", val: formatCurrency(otherExp), cls: "text-orange-400" },
                  parseFloat(property.total_buyer_value||0) > 0 && { label: "Buyer Value", val: formatCurrency(property.total_buyer_value), cls: "text-emerald-400" },
                ].filter(Boolean).map((row, i) => (
                  <div key={i} className="flex justify-between text-xs py-1.5 border-b border-slate-700/60 last:border-0">
                    <span className="text-slate-400">{row.label}</span>
                    <span className={`font-semibold ${row.cls}`}>{row.val}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs pt-2">
                  <span className={`font-bold ${remainingOwedToSeller > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                    Seller Remaining
                  </span>
                  <span className={`font-bold ${remainingOwedToSeller > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    {remainingOwedToSeller > 0 ? formatCurrency(remainingOwedToSeller) : "Paid ✓"}
                  </span>
                </div>
              </div>
            </Section>

            {/* Property overview + diagram */}
            <Section title="Property Overview" icon="🏠">
              {!isSite && (
                <div className="flex justify-center mb-4 overflow-hidden">
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
              {[
                ["Total Area", property.total_area_sqft ? `${Number(property.total_area_sqft).toLocaleString()} sqft` : null],
                ["Seller", seller?.name],
                ["Seller Rate", sellerRatePerSqft > 0 ? `₹${Number(sellerRatePerSqft).toLocaleString()}/sqft` : null],
                ["Buyer Rate", buyerRate > 0 ? `₹${Number(buyerRate).toLocaleString()}/sqft` : null],
                ["Broker", property.broker_name],
                isSite && ["Deal Start", property.site_deal_start_date ? formatDate(property.site_deal_start_date) : null],
                ["Expected Registry", property.expected_registry_date ? formatDate(property.expected_registry_date) : null],
                ["Actual Registry", property.actual_registry_date ? formatDate(property.actual_registry_date) : null],
              ].filter(row => row && row[1]).map(([label, value], i) => (
                <div key={i} className="flex justify-between py-1.5 border-b border-slate-700/50 last:border-0 text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className="text-slate-200 font-medium text-right max-w-[60%]">{value}</span>
                </div>
              ))}
            </Section>

            {/* Registry alert */}
            {daysToRegistry !== null && !isSettled && property.status !== "cancelled" && (
              <div className={`rounded-2xl border p-4 ${registryUrgent ? "bg-rose-500/10 border-rose-500/30" : "bg-slate-800/50 border-slate-700/60"}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg">{daysToRegistry < 0 ? "⚠️" : registryUrgent ? "🔴" : "📅"}</span>
                  <div>
                    <p className={`text-xs font-bold ${registryUrgent ? "text-rose-300" : "text-slate-300"}`}>
                      {daysToRegistry < 0 ? `Registry ${Math.abs(daysToRegistry)} days overdue`
                        : daysToRegistry === 0 ? "Registry TODAY"
                        : `Registry in ${daysToRegistry} days`}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(property.expected_registry_date)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {property.notes && (
              <Section title="Notes" icon="📝">
                <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{property.notes}</p>
              </Section>
            )}

            {/* Quick actions */}
            <Section title="Quick Actions" icon="⚡">
              <div className="space-y-2">
                <button
                  onClick={() => setShowShare(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-semibold hover:bg-cyan-500/20 transition text-left"
                >
                  <span>🔗</span>
                  <div>
                    <p>Generate Shareable Summary</p>
                    <p className="text-[10px] text-slate-500 font-normal">Copy or download deal brief</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    const lines = [
                      `DEAL RECEIPT — ${property.title}`,
                      `Date: ${new Date().toLocaleDateString("en-IN")}`,
                      `Status: ${property.status?.replace(/_/g,"  ")}`,
                      `Seller Value: ${formatCurrency(totalSeller)}`,
                      `Advance Paid: ${formatCurrency(advancePaid)}`,
                      `Remaining: ${formatCurrency(remainingOwedToSeller)}`,
                      `My Share: ${myShare}%`,
                      ``,
                      `TRANSACTIONS`,
                      ...transactions.map(t => `${formatDate(t.txn_date)} | ${t.txn_type} | ${formatCurrency(t.amount)}`),
                    ].join("\n");
                    const blob = new Blob([lines], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${property.title.replace(/\s+/g,"_")}_receipt.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-slate-700/60 border border-slate-600/60 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-700 transition text-left"
                >
                  <span>⬇</span>
                  <div>
                    <p>Download Receipt</p>
                    <p className="text-[10px] text-slate-500 font-normal">Save transaction history</p>
                  </div>
                </button>
                <button
                  onClick={() => navigate(`/properties/${id}/edit`)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-slate-700/60 border border-slate-600/60 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-700 transition text-left"
                >
                  <span>✏</span>
                  <div>
                    <p>Edit Deal Details</p>
                    <p className="text-[10px] text-slate-500 font-normal">Update rates, dates, notes</p>
                  </div>
                </button>
              </div>
            </Section>

          </div>
        </div>
      </div>
    </div>
  );
}
