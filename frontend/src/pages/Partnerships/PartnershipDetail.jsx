import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

function PartnershipDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleResult, setSettleResult] = useState(null);
  const [memberForm, setMemberForm] = useState({
    contact_id: "",
    is_self: false,
    share_percentage: "",
    advance_contributed: "0",
    notes: "",
  });
  const [settleForm, setSettleForm] = useState({
    total_received: "",
    actual_end_date: new Date().toISOString().split("T")[0],
    notes: "",
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["partnership", id],
    queryFn: async () => {
      const response = await api.get(`/api/partnerships/${id}`);
      return response.data;
    },
    retry: 2,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", "partnership-members"],
    queryFn: async () => {
      const response = await api.get("/api/contacts");
      return response.data;
    },
  });

  const memberMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.post(
        `/api/partnerships/${id}/members`,
        payload,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      setShowMemberModal(false);
      setMemberForm({
        contact_id: "",
        is_self: false,
        share_percentage: "",
        advance_contributed: "0",
        notes: "",
      });
    },
    onError: (err) => {
      alert(err?.response?.data?.detail || "Failed to add member");
    },
  });

  const settleMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.put(`/api/partnerships/${id}/settle`, payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      queryClient.invalidateQueries({ queryKey: ["partnerships"] });
      setSettleResult(data.summary);
    },
    onError: (err) => {
      alert(err?.response?.data?.detail || "Failed to settle partnership");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const partnership = data?.partnership;
  if (isError || !partnership) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isError ? "Failed to load partnership" : "Partnership not found"}
          </h2>
          <button
            onClick={() => navigate("/partnerships")}
            className="text-blue-600 hover:text-blue-800"
          >
            Back to Partnerships
          </button>
        </div>
      </div>
    );
  }

  const members = data.members || [];

  // Distribution calculation
  const totalAdvance = members.reduce(
    (sum, { member }) => sum + Number(member.advance_contributed || 0),
    0,
  );
  const totalReceived = Number(partnership.total_received || 0);
  const profit =
    totalReceived > 0 ? Math.max(0, totalReceived - totalAdvance) : null;

  const memberDistribution = members.map(({ member, contact }) => {
    const advance = Number(member.advance_contributed || 0);
    const share = Number(member.share_percentage || 0);
    const profitShare = profit !== null ? (share / 100) * profit : null;
    const totalDue = profit !== null ? advance + profitShare : null;
    const totalReceivedByMember = Number(member.total_received || 0);
    return {
      member,
      contact,
      advance,
      share,
      profitShare,
      totalDue,
      totalReceivedByMember,
    };
  });

  const submitMember = () => {
    memberMutation.mutate({
      contact_id: memberForm.is_self ? null : Number(memberForm.contact_id),
      is_self: memberForm.is_self,
      share_percentage: Number(memberForm.share_percentage),
      advance_contributed: Number(memberForm.advance_contributed || 0),
      total_received: 0,
      notes: memberForm.notes || null,
    });
  };

  const submitSettlement = () => {
    settleMutation.mutate({
      total_received: settleForm.total_received
        ? Number(settleForm.total_received)
        : null,
      actual_end_date: settleForm.actual_end_date || null,
      notes: settleForm.notes || null,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <button
              onClick={() => navigate("/partnerships")}
              className="text-gray-600 hover:text-gray-900 mb-3"
            >
              ← Back to Partnerships
            </button>
            <h1 className="text-3xl font-bold text-gray-900">
              {partnership.title}
            </h1>
            <p className="text-gray-600 mt-1 capitalize">
              Status: {partnership.status}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/partnerships/${id}/edit`)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Edit
            </button>
            {partnership.status !== "settled" && (
              <button
                onClick={() => { setSettleResult(null); setShowSettleModal(true); }}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
              >
                Record Deal Receipt
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Total Advance</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(totalAdvance)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Total Received</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(totalReceived)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Profit (after advances)</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {profit !== null ? formatCurrency(profit) : "—"}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Partners</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {members.length}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Partnership Details */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Partnership Details
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">Linked Property</div>
                  <div className="font-medium">
                    {data.linked_property ? (
                      <button
                        onClick={() =>
                          navigate(`/properties/${data.linked_property.id}`)
                        }
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {data.linked_property.title}
                      </button>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Total Deal Value</div>
                  <div className="font-medium">
                    {formatCurrency(partnership.total_deal_value)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Start Date</div>
                  <div className="font-medium">
                    {formatDate(partnership.start_date)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Expected End</div>
                  <div className="font-medium">
                    {formatDate(partnership.expected_end_date)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Actual End</div>
                  <div className="font-medium">
                    {formatDate(partnership.actual_end_date)}
                  </div>
                </div>
              </div>
              {partnership.notes && (
                <p className="text-sm text-gray-700 mt-4 pt-4 border-t border-gray-200">
                  {partnership.notes}
                </p>
              )}
            </div>

            {/* Distribution Table */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Partner Distribution
              </h2>
              {members.length === 0 ? (
                <p className="text-sm text-gray-500">No partners added yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-3 text-gray-500 font-medium">
                          Partner
                        </th>
                        <th className="text-right py-2 px-3 text-gray-500 font-medium">
                          Share%
                        </th>
                        <th className="text-right py-2 px-3 text-gray-500 font-medium">
                          Advance
                        </th>
                        <th className="text-right py-2 px-3 text-gray-500 font-medium">
                          Profit Share
                        </th>
                        <th className="text-right py-2 px-3 text-gray-500 font-medium">
                          Total Due
                        </th>
                        <th className="text-right py-2 px-3 text-gray-500 font-medium">
                          Received
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {memberDistribution.map(
                        ({
                          member,
                          contact,
                          advance,
                          share,
                          profitShare,
                          totalDue,
                          totalReceivedByMember,
                        }) => (
                          <tr key={member.id} className="hover:bg-gray-50">
                            <td className="py-3 px-3 font-medium text-gray-900">
                              {member.is_self
                                ? "Self"
                                : contact?.name || "Unknown"}
                            </td>
                            <td className="py-3 px-3 text-right text-gray-700">
                              {share}%
                            </td>
                            <td className="py-3 px-3 text-right text-gray-700">
                              {formatCurrency(advance)}
                            </td>
                            <td className="py-3 px-3 text-right text-gray-700">
                              {profitShare !== null
                                ? formatCurrency(profitShare)
                                : "—"}
                            </td>
                            <td className="py-3 px-3 text-right font-semibold text-gray-900">
                              {totalDue !== null
                                ? formatCurrency(totalDue)
                                : "—"}
                            </td>
                            <td className="py-3 px-3 text-right text-gray-700">
                              {totalReceivedByMember > 0 ? (
                                <span
                                  className={
                                    totalDue !== null &&
                                    totalReceivedByMember >= totalDue
                                      ? "text-green-600 font-medium"
                                      : "text-orange-600"
                                  }
                                >
                                  {formatCurrency(totalReceivedByMember)}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200">
                      <tr className="font-semibold">
                        <td className="py-3 px-3 text-gray-900">Total</td>
                        <td className="py-3 px-3 text-right text-gray-900">
                          {memberDistribution.reduce((s, r) => s + r.share, 0)}%
                        </td>
                        <td className="py-3 px-3 text-right text-gray-900">
                          {formatCurrency(totalAdvance)}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-900">
                          {profit !== null ? formatCurrency(profit) : "—"}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-900">
                          {profit !== null
                            ? formatCurrency(totalAdvance + profit)
                            : "—"}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-900">
                          {formatCurrency(
                            memberDistribution.reduce(
                              (s, r) => s + r.totalReceivedByMember,
                              0,
                            ),
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {profit === null && totalReceived === 0 && (
                <p className="text-xs text-gray-400 mt-3">
                  * Profit share and total due will show once the deal is
                  received via "Record Deal Receipt".
                </p>
              )}
            </div>
          </div>

          {/* Right sidebar - Partners */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Partners
                </h2>
                {partnership.status !== "settled" && (
                  <button
                    onClick={() => setShowMemberModal(true)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    + Add
                  </button>
                )}
              </div>
              {members.length === 0 ? (
                <p className="text-sm text-gray-500">No partners added yet.</p>
              ) : (
                <div className="space-y-3">
                  {members.map(({ member, contact }) => (
                    <div
                      key={member.id}
                      className="border border-gray-200 rounded-lg p-3"
                    >
                      <div className="font-medium text-gray-900">
                        {member.is_self ? "Self" : contact?.name || "Unknown"}
                      </div>
                      <div className="text-sm text-gray-500">
                        Share: {member.share_percentage}%
                      </div>
                      <div className="text-sm text-gray-500">
                        Advance: {formatCurrency(member.advance_contributed)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Partner Modal */}
      {showMemberModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Add Partner
            </h2>
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={memberForm.is_self}
                  onChange={(e) =>
                    setMemberForm((prev) => ({
                      ...prev,
                      is_self: e.target.checked,
                      contact_id: "",
                    }))
                  }
                />
                This is my own share
              </label>
              {!memberForm.is_self && (
                <select
                  value={memberForm.contact_id}
                  onChange={(e) =>
                    setMemberForm((prev) => ({
                      ...prev,
                      contact_id: e.target.value,
                    }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select contact</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="number"
                step="0.001"
                placeholder="Share Percentage (e.g. 25)"
                value={memberForm.share_percentage}
                onChange={(e) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    share_percentage: e.target.value,
                  }))
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Advance Contributed"
                value={memberForm.advance_contributed}
                onChange={(e) =>
                  setMemberForm((prev) => ({
                    ...prev,
                    advance_contributed: e.target.value,
                  }))
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
              <textarea
                rows="2"
                placeholder="Notes (optional)"
                value={memberForm.notes}
                onChange={(e) =>
                  setMemberForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowMemberModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={submitMember}
                disabled={
                  !memberForm.share_percentage ||
                  memberMutation.isPending ||
                  (!memberForm.is_self && !memberForm.contact_id)
                }
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {memberMutation.isPending ? "Saving..." : "Add Partner"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Deal Receipt Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            {settleResult ? (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-4">✅ Partnership Settled!</h2>
                <div className="space-y-2 mb-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Invested</span>
                    <span className="font-semibold">{formatCurrency(settleResult.our_investment)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Received</span>
                    <span className="font-semibold">{formatCurrency(settleResult.total_received)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Net P&amp;L</span>
                    <span className={Number(settleResult.our_pnl) >= 0 ? "text-green-600" : "text-red-600"}>
                      {Number(settleResult.our_pnl) >= 0 ? "+" : ""}{formatCurrency(settleResult.our_pnl)}
                    </span>
                  </div>
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
                <h2 className="text-xl font-bold text-gray-900 mb-1">
                  Record Deal Receipt
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  Enter the total amount received from this deal. Profit will be
                  distributed after returning all advances.
                </p>

                {settleForm.total_received &&
                  members.length > 0 &&
                  (() => {
                    const received = Number(settleForm.total_received);
                    const calculatedProfit = Math.max(0, received - totalAdvance);
                    return (
                      <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm">
                        <div className="font-medium text-gray-700 mb-2">
                          Distribution Preview
                        </div>
                        <div className="space-y-1">
                          {members.map(({ member, contact }) => {
                            const advance = Number(member.advance_contributed || 0);
                            const share = Number(member.share_percentage || 0);
                            const pShare = (share / 100) * calculatedProfit;
                            const due = advance + pShare;
                            return (
                              <div key={member.id} className="flex justify-between">
                                <span className="text-gray-600">
                                  {member.is_self
                                    ? "Self"
                                    : contact?.name || "Unknown"}{" "}
                                  ({share}%)
                                </span>
                                <span className="font-medium text-gray-900">
                                  {formatCurrency(due)}
                                </span>
                              </div>
                            );
                          })}
                          <div className="flex justify-between pt-1 border-t border-gray-200 font-semibold">
                            <span>Total</span>
                            <span>{formatCurrency(received)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Total Amount Received
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 5000000"
                      value={settleForm.total_received}
                      onChange={(e) =>
                        setSettleForm((prev) => ({
                          ...prev,
                          total_received: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Deal Close Date
                    </label>
                    <input
                      type="date"
                      value={settleForm.actual_end_date}
                      onChange={(e) =>
                        setSettleForm((prev) => ({
                          ...prev,
                          actual_end_date: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Notes (optional)
                    </label>
                    <textarea
                      rows="2"
                      placeholder="Any settlement notes"
                      value={settleForm.notes}
                      onChange={(e) =>
                        setSettleForm((prev) => ({
                          ...prev,
                          notes: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowSettleModal(false)}
                    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitSettlement}
                    disabled={
                      !settleForm.total_received || settleMutation.isPending
                    }
                    className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                  >
                    {settleMutation.isPending ? "Saving..." : "Confirm Receipt"}
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

export default PartnershipDetail;
