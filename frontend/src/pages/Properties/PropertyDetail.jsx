import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleForm, setSettleForm] = useState({
    actual_registry_date: new Date().toISOString().split("T")[0],
    total_buyer_value: "",
    total_seller_value: "",
    broker_commission: "",
    other_expenses: "0",
  });
  const [settleResult, setSettleResult] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const response = await api.get(`/api/properties/${id}`);
      return response.data;
    },
    retry: 2,
  });

  const deletePropertyMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/properties/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      navigate("/properties");
    },
    onError: (err) => {
      alert(err?.response?.data?.detail || "Failed to delete property deal");
    },
  });

  const settleMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.post(`/api/properties/${id}/settle`, payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["property", id] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      setSettleResult(data.settlement_summary);
    },
    onError: (err) => {
      alert(err?.response?.data?.detail || "Failed to settle deal");
    },
  });

  const handleDelete = () => {
    if (window.confirm("Delete this property deal? This cannot be undone.")) {
      deletePropertyMutation.mutate();
    }
  };

  const handleSettle = () => {
    const payload = {
      actual_registry_date: settleForm.actual_registry_date || null,
      total_buyer_value: settleForm.total_buyer_value ? parseFloat(settleForm.total_buyer_value) : null,
      total_seller_value: settleForm.total_seller_value ? parseFloat(settleForm.total_seller_value) : null,
      broker_commission: settleForm.broker_commission ? parseFloat(settleForm.broker_commission) : null,
      other_expenses: settleForm.other_expenses ? parseFloat(settleForm.other_expenses) : 0,
    };
    settleMutation.mutate(payload);
  };

  // Live calculation for settle modal
  const liveGross = (() => {
    const buyer = parseFloat(settleForm.total_buyer_value || (data?.property?.total_buyer_value || 0));
    const seller = parseFloat(settleForm.total_seller_value || (data?.property?.total_seller_value || 0));
    return isNaN(buyer) || isNaN(seller) ? null : buyer - seller;
  })();
  const liveNet = (() => {
    if (liveGross === null) return null;
    const broker = parseFloat(settleForm.broker_commission || (data?.property?.broker_commission || 0));
    const other = parseFloat(settleForm.other_expenses || 0);
    return liveGross - (isNaN(broker) ? 0 : broker) - (isNaN(other) ? 0 : other);
  })();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const property = data?.property;
  if (isError || !property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isError
              ? "Failed to load property deal"
              : "Property deal not found"}
          </h2>
          <button
            onClick={() => navigate("/properties")}
            className="text-blue-600 hover:text-blue-800"
          >
            Back to Property Deals
          </button>
        </div>
      </div>
    );
  }

  const summary = data.summary || {};
  const partnerships = data.partnerships || [];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <button
              onClick={() => navigate("/properties")}
              className="text-gray-600 hover:text-gray-900 mb-3"
            >
              ← Back to Property Deals
            </button>
            <h1 className="text-3xl font-bold text-gray-900">
              {property.title}
            </h1>
            <p className="text-gray-600 mt-1">
              {property.location || "No location provided"}
            </p>
          </div>
          <div className="flex gap-3">
            {property.status !== "settled" && (
              <button
                onClick={() => { setSettleResult(null); setShowSettleModal(true); }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                ✅ Settle Deal
              </button>
            )}
            <button
              onClick={() => navigate(`/properties/${id}/edit`)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Edit Deal
            </button>
            <button
              onClick={handleDelete}
              disabled={deletePropertyMutation.isPending}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
            >
              🗑️ Delete
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Gross Profit</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(summary.gross_profit)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Net Profit</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(summary.net_profit)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Advance Paid</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(property.advance_paid)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Status</div>
            <div className="text-2xl font-bold text-gray-900 mt-1 capitalize">
              {property.status.replaceAll("_", " ")}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Deal Details */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Deal Details
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">Deal Type</div>
                  <div className="font-medium capitalize">
                    {property.deal_type.replaceAll("_", " ")}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Property Type</div>
                  <div className="font-medium capitalize">
                    {property.property_type || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Area (sqft)</div>
                  <div className="font-medium">
                    {property.total_area_sqft || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Advance Paid</div>
                  <div className="font-medium">
                    {formatCurrency(property.advance_paid)}
                  </div>
                </div>
                {property.deal_type === "middleman" && (
                  <>
                    <div>
                      <div className="text-gray-500">Seller Rate/sqft</div>
                      <div className="font-medium">
                        {property.seller_rate_per_sqft
                          ? formatCurrency(property.seller_rate_per_sqft)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Total Seller Value</div>
                      <div className="font-medium">
                        {property.total_seller_value
                          ? formatCurrency(property.total_seller_value)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Buyer Rate/sqft</div>
                      <div className="font-medium">
                        {property.buyer_rate_per_sqft
                          ? formatCurrency(property.buyer_rate_per_sqft)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Total Buyer Value</div>
                      <div className="font-medium">
                        {property.total_buyer_value
                          ? formatCurrency(property.total_buyer_value)
                          : "-"}
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <div className="text-gray-500">Broker Commission</div>
                  <div className="font-medium">
                    {formatCurrency(property.broker_commission)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Expected Registry</div>
                  <div className="font-medium">
                    {formatDate(property.expected_registry_date)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Actual Registry</div>
                  <div className="font-medium">
                    {formatDate(property.actual_registry_date)}
                  </div>
                </div>
              </div>
              {property.notes && (
                <p className="text-sm text-gray-700 mt-4 pt-4 border-t border-gray-200">
                  {property.notes}
                </p>
              )}
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* People */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                People
              </h2>
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-gray-500">Seller</div>
                  <div className="font-medium">{data.seller?.name || "-"}</div>
                </div>
                <div>
                  <div className="text-gray-500">Buyer</div>
                  <div className="font-medium">{data.buyer?.name || "-"}</div>
                </div>
              </div>
            </div>

            {/* Linked Partnerships */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Linked Partnerships
                </h2>
                <button
                  onClick={() => navigate("/partnerships/new")}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Add
                </button>
              </div>
              {partnerships.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No linked partnerships yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {partnerships.map((partnership) => (
                    <button
                      key={partnership.id}
                      onClick={() =>
                        navigate(`/partnerships/${partnership.id}`)
                      }
                      className="w-full text-left border border-gray-200 rounded-lg p-3 hover:bg-gray-50"
                    >
                      <div className="font-medium text-gray-900">
                        {partnership.title}
                      </div>
                      <div className="text-sm text-gray-500 capitalize">
                        {partnership.status}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Settle Deal Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            {settleResult ? (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-4">✅ Deal Settled!</h2>
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Gross Profit</span>
                    <span className="font-semibold">{formatCurrency(settleResult.gross_profit)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Total Expenses</span>
                    <span className="font-semibold text-red-600">- {formatCurrency(settleResult.total_expenses)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t pt-2">
                    <span>Net Profit</span>
                    <span className="text-green-600">{formatCurrency(settleResult.net_profit)}</span>
                  </div>
                  {settleResult.partner_settlements?.length > 0 && (
                    <div className="mt-4">
                      <div className="text-sm font-medium text-gray-700 mb-2">Partner Distribution</div>
                      {settleResult.partner_settlements.map((ps, i) => (
                        <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                          <span className="text-gray-700">{ps.contact_name} ({ps.share_percentage}%)</span>
                          <span className="font-semibold">{formatCurrency(ps.total_to_receive)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowSettleModal(false)}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Settle Deal</h2>
                <p className="text-sm text-gray-500 mb-4">Enter final values to settle this property deal and distribute profit.</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Registry Date</label>
                    <input
                      type="date"
                      value={settleForm.actual_registry_date}
                      onChange={(e) => setSettleForm((p) => ({ ...p, actual_registry_date: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Final Buyer Value (₹) <span className="text-gray-400 text-xs">pre-filled if available</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={property.total_buyer_value || "Enter buyer value"}
                      value={settleForm.total_buyer_value}
                      onChange={(e) => setSettleForm((p) => ({ ...p, total_buyer_value: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Final Seller Value (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={property.total_seller_value || "Enter seller value"}
                      value={settleForm.total_seller_value}
                      onChange={(e) => setSettleForm((p) => ({ ...p, total_seller_value: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Broker Commission (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={property.broker_commission || "0"}
                      value={settleForm.broker_commission}
                      onChange={(e) => setSettleForm((p) => ({ ...p, broker_commission: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Other Expenses (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={settleForm.other_expenses}
                      onChange={(e) => setSettleForm((p) => ({ ...p, other_expenses: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  {/* Live calc */}
                  {liveGross !== null && (
                    <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Gross Profit</span>
                        <span className="font-semibold">{formatCurrency(liveGross)}</span>
                      </div>
                      {liveNet !== null && (
                        <div className="flex justify-between font-bold border-t pt-1">
                          <span>Net Profit</span>
                          <span className={liveNet >= 0 ? "text-green-600" : "text-red-600"}>{formatCurrency(liveNet)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowSettleModal(false)}
                    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSettle}
                    disabled={settleMutation.isPending}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {settleMutation.isPending ? "Settling..." : "Confirm Settlement"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PropertyDetail;
