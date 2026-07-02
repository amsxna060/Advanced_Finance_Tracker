import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, PageBody, HeroStat, Button } from "../../components/ui";
/* ─── Stage pipeline ────────────────────────────────────────────────────────── */
const STAGES = [
  { key: "negotiating",   label: "Negotiation" },
  { key: "advance_given", label: "Advance" },
  { key: "buyer_found",   label: "Buyer Found" },
  { key: "registry_done", label: "Registry" },
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
            <div className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-indigo-500" : "bg-slate-200"}`} />
            {i < STAGES.length - 1 && (
              <div className={`w-2 h-2 rounded-full shrink-0 mx-1 border-2 ${i < idx ? "bg-indigo-500 border-indigo-500" : i === idx ? "bg-indigo-500 border-indigo-400" : "bg-slate-200 border-slate-300"}`} />
            )}
          </div>
        ))}
      </div>
      <div className="flex mt-1.5">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex-1 text-center">
            <span className={`text-[9px] font-medium ${i === idx ? "text-indigo-600" : i < idx ? "text-slate-400" : "text-slate-300"}`}>
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
    if (dir === "north") return (<g key={i}><rect x={cx - topW / 2 - 5} y={Math.min(y1L, y1R) - ROAD_W - 2} width={topW + 10} height={ROAD_W} rx={3} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={1} /><text x={cx} y={Math.min(y1L, y1R) - ROAD_W / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569">{label}</text></g>);
    if (dir === "south") return (<g key={i}><rect x={cx - botW / 2 - 5} y={y4 + 2} width={botW + 10} height={ROAD_W} rx={3} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={1} /><text x={cx} y={y4 + ROAD_W / 2 + 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569">{label}</text></g>);
    if (dir === "east") return (<g key={i}><rect x={Math.max(x3, cx + topW / 2) + 2} y={Math.min(y1R, y1L)} width={ROAD_W} height={plotH} rx={3} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={1} /><text x={Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" transform={`rotate(90, ${Math.max(x3, cx + topW / 2) + ROAD_W / 2 + 2}, ${midY})`}>{label}</text></g>);
    if (dir === "west") return (<g key={i}><rect x={Math.min(x4, cx - topW / 2) - ROAD_W - 2} y={Math.min(y1L, y1R)} width={ROAD_W} height={plotH} rx={3} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={1} /><text x={Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#475569" transform={`rotate(-90, ${Math.min(x4, cx - topW / 2) - ROAD_W / 2 - 2}, ${midY})`}>{label}</text></g>);
    return null;
  });
  return (
    <svg width={svgW} height={svgH} style={{ overflow: "visible" }}>
      {roadRects}
      <polygon points={points} fill="#eef2ff" stroke="#6366f1" strokeWidth={1.5} strokeLinejoin="round" />
      <text x={cx} y={Math.min(y1L, y1R) - 16} textAnchor="middle" fontSize={11} fill="#374151">{top ? `N: ${top}ft` : "—"}</text>
      <text x={cx} y={y4 + 20} textAnchor="middle" fontSize={11} fill="#374151">{bottom ? `S: ${bottom}ft` : "—"}</text>
      <text x={Math.min(x4, cx - topW / 2) - 8} y={(y1L + y4) / 2} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#374151">{left ? `W: ${left}ft` : "—"}</text>
      <text x={Math.max(x3, cx + topW / 2) + 8} y={(y1R + y4) / 2} textAnchor="start" dominantBaseline="middle" fontSize={11} fill="#374151">{right ? `E: ${right}ft` : "—"}</text>
      {area && <text x={cx} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#4f46e5" fontWeight="600">{Number(area).toLocaleString()} sqft</text>}
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
      <div className="bg-white border border-slate-200/60 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Shareable Summary</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
        </div>
        <div className="p-5">
          <pre className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 font-mono whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
            {lines}
          </pre>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => { navigator.clipboard.writeText(lines); }}
              className="flex-1 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-semibold hover:bg-indigo-100 transition"
            >
              📋 Copy Text
            </button>
            <button
              onClick={handleDownload}
              className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition"
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
    <div className="bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          {icon && <span className="text-sm">{icon}</span>}
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h2>
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
    cyan:   { text: "text-sky-700",     bg: "bg-sky-50 border-sky-200" },
    amber:  { text: "text-amber-700",   bg: "bg-amber-50 border-amber-200" },
    emerald:{ text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    rose:   { text: "text-rose-700",    bg: "bg-rose-50 border-rose-200" },
    violet: { text: "text-violet-700",  bg: "bg-violet-50 border-violet-200" },
    slate:  { text: "text-slate-700",   bg: "bg-slate-50 border-slate-200" },
  };
  const a = ACCENT[accent] || ACCENT.slate;
  return (
    <div className={`rounded-xl border p-4 ${a.bg}`}>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className={`font-bold ${a.text} ${size === "lg" ? "text-2xl" : "text-base"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5 font-normal">{sub}</p>}
    </div>
  );
}

/* ─── Status badge ──────────────────────────────────────────────────────────── */
const STATUS_CHIP = {
  negotiating:  "bg-slate-100 text-slate-600 border border-slate-200",
  advance_given:"bg-amber-50 text-amber-700 border border-amber-200",
  registry_done:"bg-sky-50 text-sky-700 border border-sky-200",
  buyer_found:  "bg-blue-50 text-blue-700 border border-blue-200",
  settled:      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  cancelled:    "bg-rose-50 text-rose-700 border border-rose-200",
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
  // "payment_done" is the legacy label for "fully_paid" (kept for un-migrated rows)
  const soldCount = plots.filter(p => ["sold","registered","fully_paid","payment_done"].includes(p.status)).length;
  return (
    <Section title="Site Plots" icon="🗺️"
      right={<span className="text-[10px] text-slate-500">{soldCount}/{plots.length} sold</span>}>
      <div className="space-y-2">
        {plots.map(p => {
          const val = parseFloat(p.calculated_price || 0);
          const paid = parseFloat(p.total_paid || 0);
          const pct = val > 0 ? Math.min((paid / val) * 100, 100) : 0;
          return (
            <div key={p.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 font-bold text-xs">
                    {p.plot_number ? p.plot_number.slice(0,2).toUpperCase() : "PN"}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{p.plot_number || p.buyer_name || `Plot #${p.id}`}</p>
                    <p className="text-[10px] text-slate-400">{p.area_sqft ? `${Number(p.area_sqft).toLocaleString()} sqft` : "—"}{p.sold_price_per_sqft ? ` · ₹${Number(p.sold_price_per_sqft).toLocaleString()}/sqft` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={p.status || "available"} />
                  <span className="text-xs font-bold text-emerald-700">{val > 0 ? formatCurrency(val) : "—"}</span>
                </div>
              </div>
              {val > 0 && (
                <div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
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
            <div key={b.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 font-bold text-[10px]">
                    {b.buyer_name ? b.buyer_name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase() : "??"}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{b.buyer_name || `Buyer #${b.id}`}</p>
                    <p className="text-[10px] text-slate-400">{b.area_sqft ? `${Number(b.area_sqft).toLocaleString()} sqft` : ""}
                    {b.rate_per_sqft ? ` · ₹${Number(b.rate_per_sqft).toLocaleString()}/sqft` : ""}</p>
                  </div>
                </div>
                <StatusBadge status={b.status} />
              </div>
              {val > 0 && (
                <div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                  <div className="flex justify-between mt-1 text-[9px] text-slate-500">
                    <span>Paid {formatCurrency(paid)}</span>
                    {val - paid > 0 && <span className="text-amber-700">{formatCurrency(val - paid)} due</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="grid grid-cols-3 gap-2 mt-1 pt-3 border-t border-slate-200 text-center">
          <div><p className="text-[9px] text-slate-500">Total Value</p><p className="text-xs font-bold text-slate-700">{formatCurrency(totalBuyerValue)}</p></div>
          <div><p className="text-[9px] text-slate-500">Received</p><p className="text-xs font-bold text-emerald-700">{formatCurrency(totalPaid)}</p></div>
          <div><p className="text-[9px] text-slate-500">Remaining</p><p className="text-xs font-bold text-rose-700">{formatCurrency(totalBuyerValue - totalPaid)}</p></div>
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-12 h-12 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  );
  if (isError || !data?.property) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-slate-500 mb-4">Property deal not found.</p>
        <button onClick={() => navigate("/properties")} className="text-indigo-600 hover:underline text-sm">← Back</button>
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
    .filter(t => t.txn_type === "remaining_to_seller" || t.txn_type === "payment_to_seller" || t.paid_to_seller)
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
    <div className="min-h-screen bg-slate-50">
      {showShare && (
        <ShareModal
          property={property}
          members={members}
          transactions={transactions}
          onClose={() => setShowShare(false)}
        />
      )}

      <PageHero
        title={property.title}
        subtitle={[property.property_type, property.location].filter(Boolean).join(" · ")}
        backTo="/properties"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="white" size="sm" onClick={() => navigate(`/properties/${id}/simulator`)}>🧪 Simulate</Button>
            <Button variant="white" size="sm" onClick={() => setShowShare(true)}>🔗 Share</Button>
            <Button variant="white" size="sm" onClick={() => navigate(`/properties/${id}/edit`)}>✏ Edit</Button>
            <Button variant="white" size="sm"
              onClick={() => { if (window.confirm("Delete this deal?")) deleteMutation.mutate(); }}
              className="!text-rose-600 hover:!text-rose-700"
            >🗑</Button>
          </div>
        }
      >
        <div className="flex items-center gap-2 mt-3">
          <StatusBadge status={property.status} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <HeroStat label="Total Deal Value" value={formatCurrency(totalSeller)} accent="indigo" />
          <HeroStat label="My Investment" value={formatCurrency(myInvested)} sub={myShare > 0 ? `${myShare}% ownership` : undefined} accent="sky" />
          <HeroStat
            label="My Remaining"
            value={myRemainingCommitment > 0 ? formatCurrency(myRemainingCommitment) : "None ✓"}
            accent={myRemainingCommitment > 0 ? "amber" : "emerald"}
          />
          <HeroStat
            label={isSettled ? "Net Profit (realized)" : "Projected Profit"}
            value={formatCurrency(
              isSettled
                ? (data?.summary?.realized_pnl ?? data?.summary?.net_profit ?? 0)
                : (data?.summary?.projected_pnl ?? data?.summary?.net_profit ?? 0)
            )}
            sub={isSettled
              ? undefined
              : `Realized so far: ${formatCurrency(data?.summary?.realized_pnl ?? data?.summary?.net_profit ?? 0)}`}
            accent={parseFloat((isSettled ? data?.summary?.realized_pnl : data?.summary?.projected_pnl) ?? data?.summary?.net_profit ?? 0) > 0 ? "emerald" : "rose"}
          />
        </div>
      </PageHero>

      <PageBody>
      <div className="space-y-5">

        {/* ── Stage progress ── */}
        <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm px-5 py-4">
          <StageBar status={property.status} />
        </div>

        {/* ── Partnership link + Quick Actions ── */}
        <div className="flex flex-wrap gap-3">
          {lp ? (
            <Link to={`/partnerships/${lp.partnership.id}`}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-semibold hover:bg-indigo-100 transition">
              🤝 Open Partnership: {lp.partnership.title} →
            </Link>
          ) : (
            <Link to="/partnerships/new"
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-200 transition">
              + Create Partnership
            </Link>
          )}
          {partnerNames.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl shadow-sm">
              <span className="text-[10px] text-slate-400">Partners:</span>
              {partnerNames.map((n, i) => (
                <span key={i} className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">{n}</span>
              ))}
            </div>
          )}
        </div>

        {/* ── Settlement banner ── */}
        {isSettled && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-xs">✓</div>
              <h3 className="text-sm font-bold text-emerald-700 uppercase tracking-widest">Deal Settled</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Seller Cost" value={formatCurrency(property.total_seller_value)} accent="slate" />
              <MetricCard label="Net Profit" value={formatCurrency(data?.summary?.net_profit || 0)} accent="emerald" />
              <MetricCard label="Broker" value={formatCurrency(property.broker_commission)} accent="violet" />
              <MetricCard label="Expenses" value={formatCurrency(property.other_expenses)} accent="amber" />
            </div>
          </div>
        )}

        {/* ── Main 2-column grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* ── LEFT: main column ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* ── SELLER MASTER CARD ── */}
            {totalSeller > 0 && (
              <div className="bg-white border border-violet-200 rounded-2xl shadow-sm p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center text-base">💳</div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Seller Payment Tracker</h3>
                    <p className="text-[10px] text-slate-400">Total deal value vs. payments made</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-slate-400 mb-2">
                    <span>Paid to Seller</span>
                    <span>Total Deal Value</span>
                  </div>
                  <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min((totalSentToSeller / totalSeller) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5 text-xs">
                    <span className="text-violet-700 font-bold font-mono tabular-nums">{formatCurrency(totalSentToSeller)}</span>
                    <span className="text-slate-500 font-mono tabular-nums">{formatCurrency(totalSeller)}</span>
                  </div>
                  <div className="flex justify-between mt-1 text-[10px]">
                    <span className="text-slate-500">{Math.round((totalSentToSeller / totalSeller) * 100)}% paid</span>
                    <span className={remainingOwedToSeller > 0 ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>
                      {remainingOwedToSeller > 0 ? `${formatCurrency(remainingOwedToSeller)} remaining` : "Fully paid ✓"}
                    </span>
                  </div>
                </div>

                {/* User's liability highlight */}
                {myRemainingCommitment > 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
                    <span className="text-amber-600 text-base mt-0.5">⚠</span>
                    <div>
                      <p className="text-[9px] text-amber-700 font-semibold uppercase tracking-wider mb-0.5">Your Share of Remaining Liability</p>
                      <p className="text-xl font-bold text-amber-700 font-mono tabular-nums">{formatCurrency(myRemainingCommitment)}</p>
                      {myShare > 0 && <p className="text-[10px] text-slate-500 mt-0.5">{myShare}% of {formatCurrency(remainingOwedToSeller)} outstanding</p>}
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
                    <span className="text-emerald-600">✓</span>
                    <p className="text-sm font-semibold text-emerald-700">Your share fully paid</p>
                  </div>
                )}
              </div>
            )}

            {/* My Personal Stake card */}
            <Section title="My Personal Stake" icon="👤">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">Invested So Far</p>
                  <p className="text-lg font-bold text-sky-700">{formatCurrency(myInvested)}</p>
                  {advancePaid > 0 && myInvested !== advancePaid && (
                    <p className="text-[10px] text-slate-400 mt-0.5">Pool advance: {formatCurrency(advancePaid)}</p>
                  )}
                </div>
                <div className={`border rounded-xl p-3.5 ${myRemainingCommitment > 0 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">Still to Pay</p>
                  <p className={`text-lg font-bold ${myRemainingCommitment > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                    {myRemainingCommitment > 0 ? formatCurrency(myRemainingCommitment) : "Complete ✓"}
                  </p>
                  {myRemainingCommitment > 0 && (
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {myShare > 0 ? `${myShare}% of ` : ""}{formatCurrency(remainingOwedToSeller)} total remaining
                    </p>
                  )}
                </div>
              </div>
              {myProfitWithdrawn > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-emerald-700 text-xs">✓</span>
                  <span className="text-xs text-slate-600">Profit withdrawn: <strong className="text-emerald-700">{formatCurrency(myProfitWithdrawn)}</strong></span>
                </div>
              )}
            </Section>

            {/* Financial Breakdown Table */}
            {(sellerRatePerSqft > 0 || totalArea > 0) && (
              <Section title="Financial Breakdown" icon="📊">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 text-slate-500 font-semibold uppercase tracking-wide">Metric</th>
                        <th className="text-right py-2 text-slate-500 font-semibold uppercase tracking-wide">Value</th>
                        <th className="text-right py-2 text-slate-500 font-semibold uppercase tracking-wide">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-2.5 text-slate-600">Seller Rate</td>
                        <td className="text-right py-2.5 font-semibold text-amber-700">
                          {sellerRatePerSqft > 0 ? `₹${Number(sellerRatePerSqft).toLocaleString()}/sqft` : "—"}
                        </td>
                        <td className="text-right py-2.5 text-slate-500">Base cost</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-slate-600">Total Area</td>
                        <td className="text-right py-2.5 font-semibold text-slate-700">
                          {totalArea > 0 ? `${Number(totalArea).toLocaleString()} sqft` : "—"}
                        </td>
                        <td className="text-right py-2.5 text-slate-500">Plot size</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 text-slate-600">Total Seller Cost</td>
                        <td className="text-right py-2.5 font-semibold text-slate-700">{formatCurrency(totalSeller)}</td>
                        <td className="text-right py-2.5 text-slate-500">Purchase price</td>
                      </tr>
                      {brokerComm > 0 && (
                        <tr>
                          <td className="py-2.5 text-slate-600">Broker Commission</td>
                          <td className="text-right py-2.5 font-semibold text-violet-700">{formatCurrency(brokerComm)}</td>
                          <td className="text-right py-2.5 text-slate-500">{property.broker_name || "Broker"}</td>
                        </tr>
                      )}
                      {otherExp > 0 && (
                        <tr>
                          <td className="py-2.5 text-slate-600">Extra Expenses (Kharcha)</td>
                          <td className="text-right py-2.5 font-semibold text-orange-700">{formatCurrency(otherExp)}</td>
                          <td className="text-right py-2.5 text-slate-500">Misc costs</td>
                        </tr>
                      )}
                      {extraExpenses > 0 && (
                        <tr>
                          <td className="py-2.5 text-slate-700 font-semibold">Total All-in Cost</td>
                          <td className="text-right py-2.5 font-bold text-slate-900">{formatCurrency(totalCost)}</td>
                          <td className="text-right py-2.5 text-slate-500">Seller + expenses</td>
                        </tr>
                      )}
                      {totalArea > 0 && totalCost > 0 && (
                        <tr className="bg-sky-50/50">
                          <td className="py-2.5 text-sky-700 font-bold">Break-even Rate</td>
                          <td className="text-right py-2.5 font-bold text-sky-700">
                            ₹{Number(Math.round(breakevenRatePerSqft)).toLocaleString()}/sqft
                          </td>
                          <td className="text-right py-2.5 text-slate-500">Must sell above this</td>
                        </tr>
                      )}
                      {buyerRate > 0 && breakevenRatePerSqft > 0 && (
                        <tr className="bg-emerald-50/60">
                          <td className="py-2.5 text-emerald-700 font-bold">Buyer Rate</td>
                          <td className="text-right py-2.5 font-bold text-emerald-700">₹{Number(Math.round(buyerRate)).toLocaleString()}/sqft</td>
                          <td className="text-right py-2.5 text-emerald-600/80">
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
                    <div className={`mb-4 flex items-start gap-3 px-4 py-3 rounded-xl border ${nextAction.urgent ? "bg-rose-50 border-rose-200" : "bg-indigo-50 border-indigo-200"}`}>
                      <span className="text-base mt-0.5">{nextAction.icon}</span>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Next Action</p>
                        <p className={`text-xs font-semibold ${nextAction.urgent ? "text-rose-700" : "text-indigo-700"}`}>{nextAction.label}</p>
                      </div>
                    </div>
                  )}
                  {dateKeys.length > 0 && (
                    <div className="relative">
                      {dateKeys.map((dateStr, di) => (
                        <div key={dateStr} className="relative pl-6 pb-4 last:pb-0">
                          {di < dateKeys.length - 1 && <div className="absolute left-[9px] top-5 bottom-0 w-px bg-slate-200" />}
                          <div className={`absolute left-0 top-1 w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 ${grouped[dateStr][0].future ? "bg-white border-indigo-400" : "bg-white border-slate-300"}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${grouped[dateStr][0].future ? "bg-indigo-500" : "bg-slate-400"}`} />
                          </div>
                          <p className="text-[10px] font-bold text-slate-400 mb-1">{formatDate(dateStr)}</p>
                          {grouped[dateStr].map((ev, ei) => (
                            <div key={ei} className={`ml-1 ${ei > 0 ? "mt-1.5" : ""} flex items-start gap-2`}>
                              <span className="text-sm shrink-0">{ev.icon}</span>
                              <div>
                                <p className={`text-xs ${ev.milestone ? "font-semibold text-slate-800" : "text-slate-600"}`}>{ev.label}</p>
                                {ev.detail && <p className="text-[10px] text-slate-400">{ev.detail}</p>}
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
                right={<Link to={`/partnerships/${lp.partnership.id}`} className="text-[10px] text-indigo-600 hover:underline">Open →</Link>}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 text-slate-500 font-semibold">Partner</th>
                        <th className="text-right py-2 text-slate-500 font-semibold">Share %</th>
                        <th className="text-right py-2 text-slate-500 font-semibold">Advance</th>
                        {isSettled && <th className="text-right py-2 text-slate-500 font-semibold">Received</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {members.map((m, i) => (
                        <tr key={i}>
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[9px] font-bold text-slate-600">
                                {m.member?.is_self ? "ME" : (m.contact?.name?.[0] || "P")}
                              </div>
                              <span className={`font-medium ${m.member?.is_self ? "text-indigo-700" : "text-slate-700"}`}>
                                {m.member?.is_self ? "You" : m.contact?.name || "Partner"}
                              </span>
                            </div>
                          </td>
                          <td className="text-right py-2.5 text-slate-600">{m.member?.share_percentage}%</td>
                          <td className="text-right py-2.5 text-amber-700 font-semibold">{formatCurrency(m.member?.advance_contributed)}</td>
                          {isSettled && <td className="text-right py-2.5 text-emerald-700 font-semibold">{formatCurrency(m.member?.total_received)}</td>}
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200">
                        <td className="py-2 text-slate-500 font-semibold">Total</td>
                        <td className="text-right py-2 text-slate-500">{members.reduce((s,m) => s + parseFloat(m.member?.share_percentage||0),0)}%</td>
                        <td className="text-right py-2 text-amber-700 font-bold">{formatCurrency(totalAdvancePool)}</td>
                        {isSettled && <td />}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Transactions */}
            <Section title="Transactions" icon="💳"
              right={lp && <Link to={`/partnerships/${lp.partnership.id}`} className="text-[10px] text-indigo-600 hover:underline">Manage from Partnership →</Link>}>
              {transactions.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-4">No transactions recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 text-slate-500 font-semibold">Date</th>
                        <th className="text-left py-2 text-slate-500 font-semibold">Type</th>
                        <th className="text-right py-2 text-slate-500 font-semibold">Amount</th>
                        <th className="text-left py-2 text-slate-500 font-semibold">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map(t => {
                        const typeStyle = {
                          advance_to_seller: "text-amber-700 bg-amber-50",
                          advance_given:     "text-amber-700 bg-amber-50",
                          remaining_to_seller:"text-amber-700 bg-amber-50",
                          payment_to_seller: "text-amber-700 bg-amber-50",
                          received_from_buyer:"text-emerald-700 bg-emerald-50",
                          buyer_advance:     "text-emerald-700 bg-emerald-50",
                          buyer_payment:     "text-emerald-700 bg-emerald-50",
                          profit_received:   "text-teal-700 bg-teal-50",
                          broker_commission: "text-violet-700 bg-violet-50",
                          broker_paid:       "text-violet-700 bg-violet-50",
                          expense:           "text-orange-700 bg-orange-50",
                          other_expense:     "text-orange-700 bg-orange-50",
                        }[t.txn_type] || "text-slate-600 bg-slate-100";
                        const detail = [t.description, t.payer_name && `By: ${t.payer_name}`, t.receiver_name && `→ ${t.receiver_name}`].filter(Boolean).join(" · ");
                        return (
                          <tr key={t.id} className="hover:bg-slate-50 transition">
                            <td className="py-2.5 text-slate-500">{formatDate(t.txn_date)}</td>
                            <td className="py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeStyle}`}>
                                {(t.txn_type || "").replace(/_/g, " ")}
                              </span>
                            </td>
                            <td className="text-right py-2.5 font-bold text-slate-900">{formatCurrency(t.amount)}</td>
                            <td className="py-2.5 text-slate-400">{detail || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {partnershipExpenses.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Partnership Expenses</p>
                  {partnershipExpenses.map(pe => (
                    <div key={pe.id} className="flex items-center justify-between py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">{formatDate(pe.txn_date)}</span>
                        <span className="text-slate-600">{pe.description || "—"}</span>
                        <span className="text-[10px] bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded">{pe.payer_name || "Partner"}</span>
                      </div>
                      <span className="font-semibold text-orange-700">{formatCurrency(pe.amount)}</span>
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
                  { label: "Seller Asking Price", val: formatCurrency(totalSeller), cls: "text-slate-700" },
                  { label: "Advance Paid", val: formatCurrency(advancePaid), cls: "text-amber-700" },
                  furtherPaid > 0 && { label: "Further Paid", val: formatCurrency(furtherPaid), cls: "text-amber-700" },
                  brokerComm > 0 && { label: "Broker Commission", val: formatCurrency(brokerComm), cls: "text-violet-700" },
                  otherExp > 0 && { label: "Other Expenses", val: formatCurrency(otherExp), cls: "text-orange-700" },
                  parseFloat(property.total_buyer_value||0) > 0 && { label: "Buyer Value", val: formatCurrency(property.total_buyer_value), cls: "text-emerald-700" },
                ].filter(Boolean).map((row, i) => (
                  <div key={i} className="flex justify-between text-xs py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-slate-500">{row.label}</span>
                    <span className={`font-semibold ${row.cls}`}>{row.val}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs pt-2">
                  <span className={`font-bold ${remainingOwedToSeller > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    Seller Remaining
                  </span>
                  <span className={`font-bold ${remainingOwedToSeller > 0 ? "text-rose-700" : "text-emerald-700"}`}>
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
                <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0 text-xs">
                  <span className="text-slate-500">{label}</span>
                  <span className="text-slate-700 font-medium text-right max-w-[60%]">{value}</span>
                </div>
              ))}
            </Section>

            {/* Registry alert */}
            {daysToRegistry !== null && !isSettled && property.status !== "cancelled" && (
              <div className={`rounded-2xl border p-4 ${registryUrgent ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200"}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg">{daysToRegistry < 0 ? "⚠️" : registryUrgent ? "🔴" : "📅"}</span>
                  <div>
                    <p className={`text-xs font-bold ${registryUrgent ? "text-rose-700" : "text-slate-700"}`}>
                      {daysToRegistry < 0 ? `Registry ${Math.abs(daysToRegistry)} days overdue`
                        : daysToRegistry === 0 ? "Registry TODAY"
                        : `Registry in ${daysToRegistry} days`}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(property.expected_registry_date)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {property.notes && (
              <Section title="Notes" icon="📝">
                <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{property.notes}</p>
              </Section>
            )}

            {/* Quick actions */}
            <Section title="Quick Actions" icon="⚡">
              <div className="space-y-2">
                <button
                  onClick={() => setShowShare(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-semibold hover:bg-indigo-100 transition text-left"
                >
                  <span>🔗</span>
                  <div>
                    <p>Generate Shareable Summary</p>
                    <p className="text-[10px] text-slate-400 font-normal">Copy or download deal brief</p>
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
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition text-left"
                >
                  <span>⬇</span>
                  <div>
                    <p>Download Receipt</p>
                    <p className="text-[10px] text-slate-400 font-normal">Save transaction history</p>
                  </div>
                </button>
                <button
                  onClick={() => navigate(`/properties/${id}/edit`)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition text-left"
                >
                  <span>✏</span>
                  <div>
                    <p>Edit Deal Details</p>
                    <p className="text-[10px] text-slate-400 font-normal">Update rates, dates, notes</p>
                  </div>
                </button>
              </div>
            </Section>

          </div>
        </div>
      </div>
      </PageBody>
    </div>
  );
}
