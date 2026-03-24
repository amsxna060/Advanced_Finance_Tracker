import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

const STATUS_COLORS = {
  negotiating: "bg-yellow-100 text-yellow-800",
  advance_given: "bg-orange-100 text-orange-800",
  buyer_found: "bg-blue-100 text-blue-800",
  registry_done: "bg-purple-100 text-purple-800",
  settled: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

function PlotDiagram({ left, right, top, bottom, area }) {
  const hasAny = left || right || top || bottom;
  if (!hasAny) return null;
  const W = 220, H = 140, PAD = 36;
  return (
    <svg width={W + PAD * 2} height={H + PAD * 2}>
      <rect x={PAD} y={PAD} width={W} height={H} fill="#eff6ff" stroke="#3b82f6" strokeWidth={2} rx={2} />
      <text x={PAD + W / 2} y={PAD - 10} textAnchor="middle" fontSize={12} fill="#1d4ed8">{top ? `${top} ft` : "—"}</text>
      <text x={PAD + W / 2} y={PAD + H + 20} textAnchor="middle" fontSize={12} fill="#1d4ed8">{bottom ? `${bottom} ft` : "—"}</text>
      <text x={PAD - 8} y={PAD + H / 2} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="#1d4ed8">{left ? `${left} ft` : "—"}</text>
      <text x={PAD + W + 8} y={PAD + H / 2} textAnchor="start" dominantBaseline="middle" fontSize={12} fill="#1d4ed8">{right ? `${right} ft` : "—"}</text>
      {area && (
        <text x={PAD + W / 2} y={PAD + H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="#1e40af" fontWeight="600">
          {Number(area).toLocaleString()} sqft
        </text>
      )}
    </svg>
  );
}

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">{value}</span>
    </div>
  );
}

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleForm, setSettleForm] = useState({
    registry_date: new Date().toISOString().split("T")[0],
    buyer_rate_per_sqft: "",
    other_expenses: "0",
    total_profit_received: "",
    site_deal_end_date: "",
  });
  const [settleResult, setSettleResult] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const res = await api.get(`/api/properties/${id}`);
      return res.data;
    },
    retry: 2,
  });

  const deletePropertyMutation = useMutation({
    mutationFn: async () => { await api.delete(`/api/properties/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      navigate("/properties");
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete"),
  });

  const settleMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.post(`/api/properties/${id}/settle`, payload);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["property", id] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      setSettleResult(data.settlement_summary);
      setShowSettleModal(false);
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to settle"),
  });

  const handleSettle = () => {
    const isSite = property?.property_type === "site";
    if (isSite) {
      settleMutation.mutate({
        total_profit_received: settleForm.total_profit_received ? parseFloat(settleForm.total_profit_received) : null,
        site_deal_end_date: settleForm.site_deal_end_date || null,
      });
    } else {
      settleMutation.mutate({
        buyer_rate_per_sqft: settleForm.buyer_rate_per_sqft ? parseFloat(settleForm.buyer_rate_per_sqft) : null,
        registry_date: settleForm.registry_date || null,
        other_expenses: settleForm.other_expenses ? parseFloat(settleForm.other_expenses) : 0,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (isError || !data?.property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Property deal not found.</p>
          <button onClick={() => navigate("/properties")} className="text-blue-600 hover:underline">
            ← Back to Properties
          </button>
        </div>
      </div>
    );
  }

  const property = data.property;
  const seller = data.seller;
  const lp = data.linked_partnership;
  const isSite = property.property_type === "site";
  const isSettled = property.status === "settled";
  const members = lp?.members || [];

  // Calculate site settlement summary from property data (for display after page reload)
  const calculateSiteSettlementSummary = () => {
    if (!isSite || !isSettled) return null;
    
    const myInvestment = parseFloat(property.my_investment || 0);
    const totalProfitReceived = parseFloat(property.total_profit_received || 0);
    const mySharePct = parseFloat(property.my_share_percentage || 0);
    const myProfit = totalProfitReceived * (mySharePct / 100);
    const totalReturned = myInvestment + myProfit;
    
    // Calculate duration and ROI
    let durationMonths = null;
    let roiPerAnnumPercent = null;
    
    if (property.site_deal_start_date && property.site_deal_end_date) {
      const startDate = new Date(property.site_deal_start_date);
      const endDate = new Date(property.site_deal_end_date);
      const durationDays = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
      durationMonths = (durationDays / 30.44).toFixed(1);
      
      if (myInvestment > 0 && durationDays > 0) {
        roiPerAnnumPercent = ((myProfit / myInvestment) / (durationDays / 365) * 100);
      }
    }
    
    return {
      deal_type: "site",
      my_investment: myInvestment,
      my_profit: myProfit,
      total_returned_to_me: totalReturned,
      roi_per_annum_percent: roiPerAnnumPercent,
      duration_months: durationMonths ? parseFloat(durationMonths) : null,
    };
  };

  const siteSettlementSummary = calculateSiteSettlementSummary();
  const displaySettlementSummary = settleResult || siteSettlementSummary;

  // Live calculation for plot settle modal
  const area = parseFloat(property.total_area_sqft || 0);
  const sellerTotal = parseFloat(property.total_seller_value || 0);
  const brokerComm = parseFloat(property.broker_commission || 0);
  const liveBuyerTotal = (() => {
    const rate = parseFloat(settleForm.buyer_rate_per_sqft);
    return !isNaN(rate) && area > 0 ? rate * area : null;
  })();
  const liveGross = liveBuyerTotal !== null ? liveBuyerTotal - sellerTotal : null;
  const liveOther = parseFloat(settleForm.other_expenses || 0);
  const liveNet = liveGross !== null ? liveGross - brokerComm - (isNaN(liveOther) ? 0 : liveOther) : null;

  const totalAdvancePool = members.reduce((sum, m) => sum + parseFloat(m.member?.advance_contributed || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/properties")} className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200">←</button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{property.title}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[property.status] || "bg-gray-100 text-gray-700"}`}>
                  {property.status?.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {isSite ? "Site" : "Plot"} · {property.deal_type?.replace(/_/g, " ")}
                </span>
                {property.location && <span className="text-xs text-gray-500">📍 {property.location}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/properties/${id}/edit`)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              onClick={() => { if (window.confirm("Delete this deal?")) deletePropertyMutation.mutate(); }}
              className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Settlement Result Banner */}
        {displaySettlementSummary && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">✅</span>
              <h3 className="text-lg font-bold text-green-800">Deal Settled Successfully!</h3>
            </div>
            {displaySettlementSummary.deal_type === "site" ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">My Investment:</span> <span className="font-semibold">{formatCurrency(displaySettlementSummary.my_investment)}</span></div>
                <div><span className="text-gray-500">My Profit:</span> <span className="font-semibold text-green-700">{formatCurrency(displaySettlementSummary.my_profit)}</span></div>
                <div><span className="text-gray-500">Total Returned:</span> <span className="font-semibold">{formatCurrency(displaySettlementSummary.total_returned_to_me)}</span></div>
                {displaySettlementSummary.roi_per_annum_percent && (
                  <div><span className="text-gray-500">ROI p.a.:</span> <span className="font-semibold text-blue-700">{displaySettlementSummary.roi_per_annum_percent.toFixed(2)}%</span></div>
                )}
                {displaySettlementSummary.duration_months && (
                  <div><span className="text-gray-500">Duration:</span> <span className="font-semibold">{displaySettlementSummary.duration_months} months</span></div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                  <div><span className="text-gray-500">Buyer Total:</span> <span className="font-semibold">{formatCurrency(displaySettlementSummary.total_buyer_value)}</span></div>
                  <div><span className="text-gray-500">Seller Total:</span> <span className="font-semibold">{formatCurrency(displaySettlementSummary.total_seller_value)}</span></div>
                  <div><span className="text-gray-500">Gross Profit:</span> <span className="font-semibold">{formatCurrency(displaySettlementSummary.gross_profit)}</span></div>
                  <div><span className="text-gray-500">Net Profit:</span> <span className="font-semibold text-green-700">{formatCurrency(displaySettlementSummary.net_profit)}</span></div>
                </div>
                {displaySettlementSummary.partner_settlements?.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-green-200">
                          <th className="text-left py-2 text-gray-600 font-medium">Partner</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Share</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Advance Back</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Profit Share</th>
                          <th className="text-right py-2 text-gray-600 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displaySettlementSummary.partner_settlements.map((ps, i) => (
                          <tr key={i} className="border-b border-green-100">
                            <td className="py-2 font-medium">{ps.contact_name}{ps.is_self && " (You)"}</td>
                            <td className="text-right py-2">{ps.share_percentage}%</td>
                            <td className="text-right py-2">{formatCurrency(ps.advance_returned)}</td>
                            <td className="text-right py-2">{formatCurrency(ps.profit_share)}</td>
                            <td className="text-right py-2 font-semibold text-green-700">{formatCurrency(ps.total_to_receive)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-5">

            {/* Property Overview */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-800 mb-4">Property Overview</h2>

              {isSite ? (
                <>
                  <InfoRow label="Total Area" value={property.total_area_sqft ? `${Number(property.total_area_sqft).toLocaleString()} sqft` : null} />
                  <InfoRow label="Total Value to Seller" value={property.total_seller_value ? formatCurrency(property.total_seller_value) : null} />
                  <InfoRow label="My Investment" value={property.my_investment ? formatCurrency(property.my_investment) : null} />
                  <InfoRow label="My Share %" value={property.my_share_percentage ? `${property.my_share_percentage}%` : null} />
                  <InfoRow label="Deal Start Date" value={property.site_deal_start_date ? formatDate(property.site_deal_start_date) : null} />
                  {property.site_deal_end_date && <InfoRow label="Deal End Date" value={formatDate(property.site_deal_end_date)} />}
                  {property.total_profit_received && (
                    <InfoRow label="Total Profit Received" value={formatCurrency(property.total_profit_received)} />
                  )}
                </>
              ) : (
                <>
                  {/* Plot dimensions diagram — PlotDiagram renders nothing if no dimensions set */}
                  <div className="flex justify-center mb-4">
                    <PlotDiagram
                      left={property.side_left_ft}
                      right={property.side_right_ft}
                      top={property.side_top_ft}
                      bottom={property.side_bottom_ft}
                      area={property.total_area_sqft}
                    />
                  </div>
                  <InfoRow label="Total Area" value={property.total_area_sqft ? `${Number(property.total_area_sqft).toLocaleString()} sqft` : null} />
                  <InfoRow label="Seller" value={seller?.name} />
                  <InfoRow label="Seller Rate" value={property.seller_rate_per_sqft ? `₹${Number(property.seller_rate_per_sqft).toLocaleString()}/sqft` : null} />
                  <InfoRow label="Total Seller Value" value={property.total_seller_value ? formatCurrency(property.total_seller_value) : null} />
                  <InfoRow label="Advance Paid" value={property.advance_paid > 0 ? formatCurrency(property.advance_paid) : null} />
                  <InfoRow label="Broker" value={property.broker_name} />
                  <InfoRow label="Broker Commission" value={property.broker_commission > 0 ? formatCurrency(property.broker_commission) : null} />
                </>
              )}
            </div>

            {/* Timeline (plot only) */}
            {!isSite && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-4">Timeline</h2>
                <InfoRow label="Advance Date" value={property.advance_date ? formatDate(property.advance_date) : null} />
                <InfoRow label="Deal Locked" value={property.deal_locked_date ? formatDate(property.deal_locked_date) : null} />
                <InfoRow label="Expected Registry" value={property.expected_registry_date ? formatDate(property.expected_registry_date) : null} />
                {property.actual_registry_date && <InfoRow label="Actual Registry" value={formatDate(property.actual_registry_date)} />}
              </div>
            )}

            {/* Settled profit details */}
            {isSettled && !isSite && property.net_profit && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                <h2 className="text-base font-semibold text-green-800 mb-3">Settlement Details</h2>
                <InfoRow label="Total Buyer Value" value={property.total_buyer_value ? formatCurrency(property.total_buyer_value) : null} />
                <InfoRow label="Total Seller Value" value={property.total_seller_value ? formatCurrency(property.total_seller_value) : null} />
                <InfoRow label="Gross Profit" value={property.gross_profit ? formatCurrency(property.gross_profit) : null} />
                <InfoRow label="Broker Commission" value={property.broker_commission > 0 ? formatCurrency(property.broker_commission) : null} />
                <InfoRow label="Net Profit" value={property.net_profit ? formatCurrency(property.net_profit) : null} />
              </div>
            )}

            {/* Partnership Info */}
            {!isSite && lp && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-800">Partnership</h2>
                  <Link
                    to={`/partnerships/${lp.partnership.id}`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View Partnership →
                  </Link>
                </div>
                <p className="text-sm text-blue-700 bg-blue-50 px-3 py-2 rounded-lg mb-3">
                  Linked to: <strong>{lp.partnership.title}</strong> ({members.length} partner{members.length !== 1 ? "s" : ""})
                </p>
                {members.length > 0 && (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-gray-500 font-medium">Partner</th>
                        <th className="text-right py-2 text-gray-500 font-medium">Share %</th>
                        <th className="text-right py-2 text-gray-500 font-medium">Advance</th>
                        {isSettled && <th className="text-right py-2 text-gray-500 font-medium">Total Received</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-2 font-medium">
                            {m.member.is_self ? "Self (You)" : m.contact?.name || "Unknown"}
                          </td>
                          <td className="text-right py-2">{m.member.share_percentage}%</td>
                          <td className="text-right py-2">{formatCurrency(m.member.advance_contributed)}</td>
                          {isSettled && (
                            <td className="text-right py-2 text-green-700 font-semibold">
                              {formatCurrency(m.member.total_received)}
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="border-t border-gray-300 font-semibold">
                        <td className="py-2">Total</td>
                        <td className="text-right py-2"></td>
                        <td className="text-right py-2">{formatCurrency(totalAdvancePool)}</td>
                        {isSettled && <td className="text-right py-2"></td>}
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Transactions */}
            {data.transactions?.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-4">Transactions</h2>
                <div className="space-y-2">
                  {data.transactions.map((txn) => (
                    <div key={txn.id} className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-800 capitalize">{txn.txn_type.replace(/_/g, " ")}</p>
                        {txn.description && <p className="text-xs text-gray-400">{txn.description}</p>}
                        <p className="text-xs text-gray-400">{formatDate(txn.txn_date)}</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">{formatCurrency(txn.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            {/* Settle button */}
            {!isSettled && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-3">Actions</h2>
                <button
                  onClick={() => setShowSettleModal(true)}
                  className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 text-sm"
                >
                  🤝 Settle Deal
                </button>
              </div>
            )}

            {/* Property notes */}
            {property.notes && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-2">Notes</h2>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{property.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settle Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Settle Deal</h2>
              <p className="text-sm text-gray-500">{property.title}</p>
            </div>
            <div className="p-5 space-y-4">
              {isSite ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Total Profit Received (₹)</label>
                    <input
                      type="number"
                      value={settleForm.total_profit_received}
                      onChange={(e) => setSettleForm((p) => ({ ...p, total_profit_received: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Total profit from site deal"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Deal End Date</label>
                    <input
                      type="date"
                      value={settleForm.site_deal_end_date}
                      onChange={(e) => setSettleForm((p) => ({ ...p, site_deal_end_date: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  {/* Site preview */}
                  {settleForm.total_profit_received && (
                    <div className="bg-blue-50 rounded-lg p-4 text-sm space-y-1.5">
                      <div className="font-semibold text-blue-800 mb-2">Settlement Preview</div>
                      <div className="flex justify-between"><span className="text-gray-600">My Investment:</span><span className="font-medium">{formatCurrency(property.my_investment)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-600">Total Profit (project):</span><span className="font-medium">{formatCurrency(settleForm.total_profit_received)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-600">My Share %:</span><span className="font-medium">{property.my_share_percentage}%</span></div>
                      <hr className="border-blue-200" />
                      <div className="flex justify-between font-semibold text-blue-700">
                        <span>My Profit:</span>
                        <span>{formatCurrency(parseFloat(settleForm.total_profit_received) * parseFloat(property.my_share_percentage || 0) / 100)}</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Final Registry Date</label>
                    <input
                      type="date"
                      value={settleForm.registry_date}
                      onChange={(e) => setSettleForm((p) => ({ ...p, registry_date: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Buyer Rate per sqft (₹)</label>
                    <input
                      type="number"
                      value={settleForm.buyer_rate_per_sqft}
                      onChange={(e) => setSettleForm((p) => ({ ...p, buyer_rate_per_sqft: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="e.g. 800"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Other Expenses (₹)</label>
                    <input
                      type="number"
                      value={settleForm.other_expenses}
                      onChange={(e) => setSettleForm((p) => ({ ...p, other_expenses: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="0"
                      min="0"
                    />
                  </div>

                  {/* Live calculation preview */}
                  {liveBuyerTotal !== null && (
                    <div className="bg-gray-50 rounded-lg p-4 text-sm font-mono space-y-1.5 border border-gray-200">
                      <div className="flex justify-between"><span className="text-gray-500">Area:</span><span>{Number(area).toLocaleString()} sqft</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Buyer Rate:</span><span>₹{Number(settleForm.buyer_rate_per_sqft).toLocaleString()}/sqft</span></div>
                      <hr className="border-gray-300 my-1" />
                      <div className="flex justify-between font-semibold"><span>Total from Buyer:</span><span>{formatCurrency(liveBuyerTotal)}</span></div>
                      <div className="flex justify-between text-gray-600"><span>Total to Seller:</span><span>{formatCurrency(sellerTotal)}</span></div>
                      <hr className="border-gray-300 my-1" />
                      <div className="flex justify-between font-semibold"><span>Gross Profit:</span><span>{formatCurrency(liveGross)}</span></div>
                      <div className="flex justify-between text-gray-500"><span>Broker Commission:</span><span>- {formatCurrency(brokerComm)}</span></div>
                      <div className="flex justify-between text-gray-500"><span>Other Expenses:</span><span>- {formatCurrency(isNaN(liveOther) ? 0 : liveOther)}</span></div>
                      <hr className="border-gray-300 my-1" />
                      <div className="flex justify-between font-bold text-green-700 text-base"><span>Net Profit:</span><span>{formatCurrency(liveNet)}</span></div>
                      {members.length > 0 && liveNet !== null && (
                        <>
                          <div className="flex justify-between text-gray-500 mt-1"><span>Total Advance Pool:</span><span>{formatCurrency(totalAdvancePool)}</span></div>
                          <hr className="border-gray-300 my-1" />
                          <div className="font-semibold text-gray-700 mt-1">Partner Breakdown:</div>
                          {members.map((m, i) => {
                            const sharePct = parseFloat(m.member.share_percentage || 0);
                            const advance = parseFloat(m.member.advance_contributed || 0);
                            const profit = liveNet * sharePct / 100;
                            const total = advance + profit;
                            const name = m.member.is_self ? "Self (You)" : m.contact?.name || "Unknown";
                            return (
                              <div key={i} className="text-xs text-gray-600">
                                • {name} ({sharePct}%) — Advance: {formatCurrency(advance)} · Profit: {formatCurrency(profit)} · <strong>Total: {formatCurrency(total)}</strong>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => { setShowSettleModal(false); setSettleResult(null); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSettle}
                disabled={settleMutation.isPending}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {settleMutation.isPending ? "Settling..." : "Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
