import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

const STATUS_COLORS = {
  active: "bg-blue-100 text-blue-800",
  settled: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">
        {value}
      </span>
    </div>
  );
}

export default function PartnershipDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [memberForm, setMemberForm] = useState({
    contact_id: "",
    is_self: false,
    share_percentage: "",
    advance_contributed: "0",
    advance_account_id: "1",
    notes: "",
  });

  // Edit member modal
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [editMemberId, setEditMemberId] = useState(null);
  const [editMemberForm, setEditMemberForm] = useState({
    share_percentage: "",
    advance_contributed: "",
    notes: "",
  });

  // Add transaction form
  const [showTxnForm, setShowTxnForm] = useState(false);
  const [txnFormType, setTxnFormType] = useState("advance_given"); // advance_given | buyer_payment_received
  const [txnForm, setTxnForm] = useState({
    txn_type: "advance_given",
    amount: "",
    txn_date: new Date().toISOString().split("T")[0],
    payment_mode: "cash",
    description: "",
    account_id: "1",
    received_by: "self",
    given_by: "self", // member_id or "self"
  });

  // Edit transaction
  const [editingTxnId, setEditingTxnId] = useState(null);
  const [editTxnForm, setEditTxnForm] = useState(null);

  // Standalone settle modal (only when NOT linked to property)
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleForm, setSettleForm] = useState({
    total_received: "",
    actual_end_date: "",
    notes: "",
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["partnership", id],
    queryFn: async () => {
      const res = await api.get(`/api/partnerships/${id}`);
      return res.data;
    },
    retry: 2,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", "for-form"],
    queryFn: async () => {
      const res = await api.get("/api/contacts", { params: { limit: 500 } });
      return res.data;
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", "for-form"],
    queryFn: async () => {
      const res = await api.get("/api/accounts");
      return res.data;
    },
  });

  const deletePartnershipMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/partnerships/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnerships"] });
      navigate("/partnerships");
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to delete"),
  });

  const addMemberMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.post(`/api/partnerships/${id}/members`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      setShowAddMemberModal(false);
      setMemberForm({
        contact_id: "",
        is_self: false,
        share_percentage: "",
        advance_contributed: "0",
        advance_account_id: "1",
        notes: "",
      });
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || "Failed to add member"),
  });

  const settleMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.put(`/api/partnerships/${id}/settle`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      setShowSettleModal(false);
    },
    onError: (err) => alert(err?.response?.data?.detail || "Failed to settle"),
  });

  const editMemberMutation = useMutation({
    mutationFn: async ({ memberId, payload }) => {
      const res = await api.put(
        `/api/partnerships/${id}/members/${memberId}`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      setShowEditMemberModal(false);
      setEditMemberId(null);
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || "Failed to update member"),
  });

  const deleteMemberMutation = useMutation({
    mutationFn: async (memberId) => {
      await api.delete(`/api/partnerships/${id}/members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || "Failed to remove member"),
  });

  const addTxnMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await api.post(
        `/api/partnerships/${id}/transactions`,
        payload,
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      if (variables?.txn_type === "buyer_payment_received") {
        queryClient.invalidateQueries({ queryKey: ["obligations"] });
        queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
      }
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setShowTxnForm(false);
      setTxnForm({
        txn_type: "advance_given",
        amount: "",
        txn_date: new Date().toISOString().split("T")[0],
        payment_mode: "cash",
        description: "",
        account_id: "1",
        received_by: "self",
        given_by: "self",
      });
      setTxnFormType("advance_given");
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || "Failed to add transaction"),
  });

  const handleAddTxn = () => {
    if (txnFormType === "advance_given") {
      const isSelf = txnForm.given_by === "self";
      const selfMember = members.find((m) => m.member?.is_self);
      const memberId = isSelf
        ? selfMember?.member?.id || null
        : parseInt(txnForm.given_by);
      addTxnMutation.mutate({
        txn_type: "advance_given",
        amount: parseFloat(txnForm.amount) || 0,
        txn_date: txnForm.txn_date,
        payment_mode: txnForm.payment_mode,
        description: txnForm.description?.trim() || null,
        account_id:
          isSelf && txnForm.account_id ? parseInt(txnForm.account_id) : null,
        member_id: memberId,
        received_by_member_id: null,
      });
    } else if (txnFormType === "other_expense") {
      const isSelf = txnForm.given_by === "self";
      const selfMember = members.find((m) => m.member?.is_self);
      const memberId = isSelf
        ? selfMember?.member?.id || null
        : parseInt(txnForm.given_by);
      addTxnMutation.mutate({
        txn_type: "other_expense",
        amount: parseFloat(txnForm.amount) || 0,
        txn_date: txnForm.txn_date,
        payment_mode: txnForm.payment_mode,
        description: txnForm.description?.trim() || null,
        account_id:
          isSelf && txnForm.account_id ? parseInt(txnForm.account_id) : null,
        member_id: memberId,
        received_by_member_id: null,
      });
    } else {
      // buyer_payment_received
      const receivedByPartner = txnForm.received_by !== "self";
      addTxnMutation.mutate({
        txn_type: "buyer_payment_received",
        amount: parseFloat(txnForm.amount) || 0,
        txn_date: txnForm.txn_date,
        payment_mode: txnForm.payment_mode,
        description: txnForm.description?.trim() || null,
        account_id: receivedByPartner
          ? null
          : txnForm.account_id
            ? parseInt(txnForm.account_id)
            : null,
        member_id: null,
        received_by_member_id: receivedByPartner
          ? parseInt(txnForm.received_by)
          : null,
      });
    }
  };

  // Delete transaction
  const deleteTxnMutation = useMutation({
    mutationFn: async (txnId) => {
      await api.delete(`/api/partnerships/${id}/transactions/${txnId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || "Failed to delete transaction"),
  });

  // Update transaction
  const updateTxnMutation = useMutation({
    mutationFn: async ({ txnId, payload }) => {
      const res = await api.put(
        `/api/partnerships/${id}/transactions/${txnId}`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnership", id] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setEditingTxnId(null);
      setEditTxnForm(null);
    },
    onError: (err) =>
      alert(err?.response?.data?.detail || "Failed to update transaction"),
  });

  const openEditTxn = (txn) => {
    setEditingTxnId(txn.id);
    setEditTxnForm({
      txn_type: txn.txn_type,
      amount: String(txn.amount),
      txn_date: txn.txn_date,
      payment_mode: txn.payment_mode || "cash",
      description: txn.description || "",
      account_id: txn.account_id ? String(txn.account_id) : "",
      member_id: txn.member_id ? String(txn.member_id) : "",
      received_by_member_id: txn.received_by_member_id
        ? String(txn.received_by_member_id)
        : "",
    });
  };

  const handleUpdateTxn = () => {
    if (!editTxnForm || !editingTxnId) return;
    updateTxnMutation.mutate({
      txnId: editingTxnId,
      payload: {
        txn_type: editTxnForm.txn_type,
        amount: parseFloat(editTxnForm.amount) || 0,
        txn_date: editTxnForm.txn_date,
        payment_mode: editTxnForm.payment_mode,
        description: editTxnForm.description?.trim() || null,
        account_id: editTxnForm.account_id
          ? parseInt(editTxnForm.account_id)
          : null,
        member_id: editTxnForm.member_id
          ? parseInt(editTxnForm.member_id)
          : null,
        received_by_member_id: editTxnForm.received_by_member_id
          ? parseInt(editTxnForm.received_by_member_id)
          : null,
      },
    });
  };

  const handleAddMember = () => {
    const advance = parseFloat(memberForm.advance_contributed) || 0;
    const payload = {
      contact_id: memberForm.is_self
        ? null
        : memberForm.contact_id
          ? parseInt(memberForm.contact_id)
          : null,
      is_self: memberForm.is_self,
      share_percentage: parseFloat(memberForm.share_percentage) || 0,
      advance_contributed: advance,
      notes: memberForm.notes?.trim() || null,
      advance_account_id:
        memberForm.is_self && advance > 0
          ? parseInt(memberForm.advance_account_id || "1")
          : null,
    };
    addMemberMutation.mutate(payload);
  };

  const handleSettle = () => {
    settleMutation.mutate({
      total_received: settleForm.total_received
        ? parseFloat(settleForm.total_received)
        : null,
      actual_end_date: settleForm.actual_end_date || null,
      notes: settleForm.notes?.trim() || null,
    });
  };

  const openEditMember = (m) => {
    setEditMemberId(m.member?.id);
    setEditMemberForm({
      share_percentage: String(m.member?.share_percentage ?? ""),
      advance_contributed: String(m.member?.advance_contributed ?? ""),
      notes: m.member?.notes || "",
    });
    setShowEditMemberModal(true);
  };

  const handleEditMember = () => {
    const payload = {};
    if (editMemberForm.share_percentage !== "")
      payload.share_percentage = parseFloat(editMemberForm.share_percentage);
    if (editMemberForm.advance_contributed !== "")
      payload.advance_contributed = parseFloat(
        editMemberForm.advance_contributed,
      );
    payload.notes = editMemberForm.notes?.trim() || null;
    editMemberMutation.mutate({ memberId: editMemberId, payload });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (isError || !data?.partnership) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Partnership not found.</p>
          <button
            onClick={() => navigate("/partnerships")}
            className="text-blue-600 hover:underline"
          >
            ← Back to Partnerships
          </button>
        </div>
      </div>
    );
  }

  const partnership = data.partnership;
  const members = data.members || [];
  const linkedProperty = data.linked_property;
  const isLinkedToProperty = Boolean(partnership.linked_property_deal_id);
  const isActive = partnership.status === "active";
  const isSettled = partnership.status === "settled";

  const totalAdvance = members.reduce(
    (sum, m) => sum + parseFloat(m.member?.advance_contributed || 0),
    0,
  );
  const totalReceived = members.reduce(
    (sum, m) => sum + parseFloat(m.member?.total_received || 0),
    0,
  );

  // Compute buyer payments total from actual transactions (not partnership.total_received)
  const buyerPaymentsTotal = (data.transactions || [])
    .filter((t) => t.txn_type === "buyer_payment_received")
    .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  // Compute other expense total from transactions
  const otherExpenseTotal = (data.transactions || [])
    .filter((t) => t.txn_type === "other_expense")
    .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  // Net profit: prefer linked property's net_profit (already deducts broker + other expenses)
  const netProfit =
    linkedProperty && linkedProperty.net_profit != null
      ? parseFloat(linkedProperty.net_profit)
      : parseFloat(partnership.total_received || 0) - totalAdvance;

  // Standalone settle preview (when not linked to property)
  const settleTotal = parseFloat(settleForm.total_received || 0);
  const settleAdvancePool = totalAdvance;
  const settleProfit = settleTotal - settleAdvancePool;

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/partnerships")}
              className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200"
            >
              ←
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {partnership.title}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[partnership.status] || "bg-gray-100 text-gray-700"}`}
                >
                  {partnership.status}
                </span>
                <span className="text-xs text-gray-400">
                  {members.length} partner{members.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/partnerships/${id}/edit`)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (window.confirm("Delete this partnership?"))
                  deletePartnershipMutation.mutate();
              }}
              className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Linked property notice */}
        {isLinkedToProperty && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <span className="text-blue-500 text-xl">🏘</span>
            <div>
              <p className="text-sm font-semibold text-blue-800">
                This partnership is linked to a property deal.
              </p>
              {linkedProperty ? (
                <Link
                  to={`/properties/${partnership.linked_property_deal_id}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  View Property: {linkedProperty.title} →
                </Link>
              ) : (
                <Link
                  to={`/properties/${partnership.linked_property_deal_id}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  View Linked Property Deal →
                </Link>
              )}
              <p className="text-xs text-blue-600 mt-1">
                Settlement is managed from the linked Property Deal page.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-xs text-gray-400 mb-1">Total Advance</div>
                <div className="text-lg font-bold text-gray-900">
                  {formatCurrency(totalAdvance)}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-xs text-gray-400 mb-1">
                  Received from Buyer
                </div>
                <div className="text-lg font-bold text-green-700">
                  {formatCurrency(buyerPaymentsTotal)}
                </div>
              </div>
              {otherExpenseTotal > 0 && (
                <div className="bg-white rounded-xl border border-orange-200 p-4 text-center">
                  <div className="text-xs text-orange-500 mb-1">Other Expenses</div>
                  <div className="text-lg font-bold text-orange-700">
                    {formatCurrency(otherExpenseTotal)}
                  </div>
                </div>
              )}
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-xs text-gray-400 mb-1">Net Profit</div>
                <div
                  className={`text-lg font-bold ${netProfit >= 0 ? "text-green-700" : "text-red-600"}`}
                >
                  {formatCurrency(netProfit)}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-xs text-gray-400 mb-1">Partners</div>
                <div className="text-lg font-bold text-gray-900">
                  {members.length}
                </div>
              </div>
            </div>

            {/* Partners table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-800">
                  Partner Distribution
                </h2>
                {isActive && (
                  <button
                    onClick={() => setShowAddMemberModal(true)}
                    className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm hover:bg-blue-100"
                  >
                    + Add Partner
                  </button>
                )}
              </div>

              {members.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  No partners added yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 text-gray-500 font-medium">
                          Partner
                        </th>
                        <th className="text-right py-2 text-gray-500 font-medium">
                          Share %
                        </th>
                        <th className="text-right py-2 text-gray-500 font-medium">
                          Advance
                        </th>
                        <th className="text-right py-2 text-gray-500 font-medium">
                          Total Received
                        </th>
                        {isActive && (
                          <th className="text-right py-2 text-gray-500 font-medium">
                            Actions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m, i) => {
                        const received = parseFloat(
                          m.member?.total_received || 0,
                        );
                        const advance = parseFloat(
                          m.member?.advance_contributed || 0,
                        );
                        const isFullyReceived = isSettled && received > 0;
                        const name = m.member?.is_self
                          ? "Self (You)"
                          : m.contact?.name || "Unknown";
                        return (
                          <tr
                            key={i}
                            className={`border-b border-gray-100 ${isFullyReceived ? "bg-green-50" : ""}`}
                          >
                            <td className="py-2 font-medium">
                              {name}
                              {m.member?.is_self && (
                                <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 rounded-full">
                                  you
                                </span>
                              )}
                            </td>
                            <td className="text-right py-2">
                              {m.member?.share_percentage}%
                            </td>
                            <td className="text-right py-2">
                              {formatCurrency(advance)}
                            </td>
                            <td
                              className={`text-right py-2 font-semibold ${isFullyReceived ? "text-green-700" : "text-gray-400"}`}
                            >
                              {isFullyReceived ? formatCurrency(received) : "—"}
                            </td>
                            {isActive && (
                              <td className="text-right py-2 space-x-1">
                                <button
                                  onClick={() => openEditMember(m)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove ${name} from this partnership?`,
                                      )
                                    )
                                      deleteMemberMutation.mutate(m.member?.id);
                                  }}
                                  className="text-xs text-red-600 hover:underline"
                                >
                                  Delete
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      <tr className="border-t border-gray-300 font-semibold">
                        <td className="py-2">Total</td>
                        <td className="text-right py-2">
                          {members
                            .reduce(
                              (s, m) =>
                                s + parseFloat(m.member?.share_percentage || 0),
                              0,
                            )
                            .toFixed(1)}
                          %
                        </td>
                        <td className="text-right py-2">
                          {formatCurrency(totalAdvance)}
                        </td>
                        <td className="text-right py-2">
                          {isSettled ? formatCurrency(totalReceived) : "—"}
                        </td>
                        {isActive && <td />}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Transactions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-800">
                  Transactions
                </h2>
                <button
                  onClick={() => {
                    setShowTxnForm(!showTxnForm);
                  }}
                  className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm hover:bg-blue-100"
                >
                  + Add Transaction
                </button>
              </div>

              {showTxnForm && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                  {/* Transaction Type Selector */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Transaction Type
                    </label>
                    <select
                      value={txnFormType}
                      onChange={(e) => {
                        setTxnFormType(e.target.value);
                        setTxnForm((p) => ({
                          ...p,
                          txn_type: e.target.value,
                          amount: "",
                          given_by: "self",
                          received_by: "self",
                        }));
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="advance_given">Advance</option>
                      <option value="buyer_payment_received">
                        Money Received from Buyer
                      </option>
                      <option value="other_expense">Other Expense</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Amount (₹)
                      </label>
                      <input
                        type="number"
                        value={txnForm.amount}
                        onChange={(e) =>
                          setTxnForm((p) => ({ ...p, amount: e.target.value }))
                        }
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="0"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={txnForm.txn_date}
                        onChange={(e) =>
                          setTxnForm((p) => ({
                            ...p,
                            txn_date: e.target.value,
                          }))
                        }
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  {/* Advance-specific fields */}
                  {txnFormType === "advance_given" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Given by
                        </label>
                        <select
                          value={txnForm.given_by}
                          onChange={(e) =>
                            setTxnForm((p) => ({
                              ...p,
                              given_by: e.target.value,
                            }))
                          }
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="self">Self (Me)</option>
                          {members
                            .filter((m) => !m.member?.is_self)
                            .map((m) => (
                              <option
                                key={m.member?.id}
                                value={String(m.member?.id)}
                              >
                                {m.contact?.name || "Partner"}
                              </option>
                            ))}
                        </select>
                      </div>
                      {txnForm.given_by === "self" ? (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            From Account
                          </label>
                          <select
                            value={txnForm.account_id}
                            onChange={(e) =>
                              setTxnForm((p) => ({
                                ...p,
                                account_id: e.target.value,
                              }))
                            }
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">— Select Account —</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                  )}

                  {/* Buyer Payment fields */}
                  {txnFormType === "buyer_payment_received" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Received by
                        </label>
                        <select
                          value={txnForm.received_by}
                          onChange={(e) =>
                            setTxnForm((p) => ({
                              ...p,
                              received_by: e.target.value,
                            }))
                          }
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="self">Self (Me)</option>
                          {members
                            .filter((m) => !m.member?.is_self)
                            .map((m) => (
                              <option
                                key={m.member?.id}
                                value={String(m.member?.id)}
                              >
                                {m.contact?.name || "Partner"}
                              </option>
                            ))}
                        </select>
                      </div>
                      {txnForm.received_by === "self" ? (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Deposit to Account
                          </label>
                          <select
                            value={txnForm.account_id}
                            onChange={(e) =>
                              setTxnForm((p) => ({
                                ...p,
                                account_id: e.target.value,
                              }))
                            }
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">— Select Account —</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                  )}

                  {/* Other Expense fields */}
                  {txnFormType === "other_expense" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Given by
                        </label>
                        <select
                          value={txnForm.given_by}
                          onChange={(e) =>
                            setTxnForm((p) => ({
                              ...p,
                              given_by: e.target.value,
                            }))
                          }
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="self">Self (Me)</option>
                          {members
                            .filter((m) => !m.member?.is_self)
                            .map((m) => (
                              <option
                                key={m.member?.id}
                                value={String(m.member?.id)}
                              >
                                {m.contact?.name || "Partner"}
                              </option>
                            ))}
                        </select>
                      </div>
                      {txnForm.given_by === "self" ? (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            From Account
                          </label>
                          <select
                            value={txnForm.account_id}
                            onChange={(e) =>
                              setTxnForm((p) => ({
                                ...p,
                                account_id: e.target.value,
                              }))
                            }
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">— Select Account —</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={txnForm.description}
                      onChange={(e) =>
                        setTxnForm((p) => ({
                          ...p,
                          description: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="Optional"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowTxnForm(false)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddTxn}
                      disabled={!txnForm.amount || addTxnMutation.isPending}
                      className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {addTxnMutation.isPending ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}

              {data.transactions?.length > 0 ? (
                <div className="space-y-2">
                  {data.transactions.map((txn) => (
                    <div
                      key={txn.id}
                      className="py-2 border-b border-gray-100 last:border-0"
                    >
                      {editingTxnId === txn.id && editTxnForm ? (
                        /* ── Inline Edit Form ── */
                        <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-gray-500 mb-0.5">
                                Amount
                              </label>
                              <input
                                type="number"
                                value={editTxnForm.amount}
                                onChange={(e) =>
                                  setEditTxnForm((p) => ({
                                    ...p,
                                    amount: e.target.value,
                                  }))
                                }
                                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-0.5">
                                Date
                              </label>
                              <input
                                type="date"
                                value={editTxnForm.txn_date}
                                onChange={(e) =>
                                  setEditTxnForm((p) => ({
                                    ...p,
                                    txn_date: e.target.value,
                                  }))
                                }
                                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-0.5">
                                Account
                              </label>
                              <select
                                value={editTxnForm.account_id}
                                onChange={(e) =>
                                  setEditTxnForm((p) => ({
                                    ...p,
                                    account_id: e.target.value,
                                  }))
                                }
                                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                              >
                                <option value="">None</option>
                                {accounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-0.5">
                              Description
                            </label>
                            <input
                              type="text"
                              value={editTxnForm.description}
                              onChange={(e) =>
                                setEditTxnForm((p) => ({
                                  ...p,
                                  description: e.target.value,
                                }))
                              }
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                            />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => {
                                setEditingTxnId(null);
                                setEditTxnForm(null);
                              }}
                              className="px-2 py-1 border border-gray-300 rounded text-xs text-gray-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleUpdateTxn}
                              disabled={updateTxnMutation.isPending}
                              className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              {updateTxnMutation.isPending
                                ? "Saving..."
                                : "Update"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── Normal Display ── */
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-medium text-gray-800 capitalize">
                              {txn.txn_type.replace(/_/g, " ")}
                            </p>
                            {txn.txn_type === "advance_given" &&
                              txn.member_id && (
                                <p className="text-xs text-blue-600">
                                  Given by:{" "}
                                  {members.find(
                                    (m) => m.member?.id === txn.member_id,
                                  )?.member?.is_self
                                    ? "Self"
                                    : members.find(
                                        (m) => m.member?.id === txn.member_id,
                                      )?.contact?.name || "Partner"}
                                </p>
                              )}
                            {txn.txn_type === "buyer_payment_received" &&
                              txn.received_by_member_id && (
                                <p className="text-xs text-amber-600">
                                  Received by:{" "}
                                  {members.find(
                                    (m) =>
                                      m.member?.id ===
                                      txn.received_by_member_id,
                                  )?.contact?.name || "Partner"}{" "}
                                  — obligation created
                                </p>
                              )}
                            {txn.txn_type === "buyer_payment_received" &&
                              !txn.received_by_member_id && (
                                <p className="text-xs text-green-600">
                                  Received by you — see{" "}
                                  <Link to="/obligations" className="underline">
                                    Money Flow
                                  </Link>{" "}
                                  for distribution
                                </p>
                              )}
                            {txn.txn_type === "other_expense" && (
                              <p className="text-xs text-orange-600">
                                Other expense — tracked in investment
                              </p>
                            )}
                            {txn.description && (
                              <p className="text-xs text-gray-400">
                                {txn.description}
                              </p>
                            )}
                            <p className="text-xs text-gray-400">
                              {formatDate(txn.txn_date)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                              {formatCurrency(txn.amount)}
                            </span>
                            <button
                              onClick={() => openEditTxn(txn)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Delete this transaction? This will reverse all linked entries.",
                                  )
                                )
                                  deleteTxnMutation.mutate(txn.id);
                              }}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">
                  No transactions yet.
                </p>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            {/* Details */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-800 mb-4">
                Details
              </h2>
              <InfoRow
                label="Start Date"
                value={
                  partnership.start_date
                    ? formatDate(partnership.start_date)
                    : null
                }
              />
              <InfoRow
                label="Expected End"
                value={
                  partnership.expected_end_date
                    ? formatDate(partnership.expected_end_date)
                    : null
                }
              />
              {isSettled && (
                <InfoRow
                  label="Actual End"
                  value={
                    partnership.actual_end_date
                      ? formatDate(partnership.actual_end_date)
                      : null
                  }
                />
              )}
              <InfoRow
                label="Created"
                value={formatDate(partnership.created_at)}
              />
            </div>

            {/* Settle (standalone only) */}
            {!isLinkedToProperty && isActive && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-3">
                  Actions
                </h2>
                <button
                  onClick={() => setShowSettleModal(true)}
                  className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 text-sm"
                >
                  🤝 Record Settlement
                </button>
              </div>
            )}

            {isLinkedToProperty && isActive && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                <p className="font-medium mb-1">Settlement via Property Deal</p>
                <p className="text-xs">
                  Use the <strong>Settle Deal</strong> button on the linked
                  property deal page to settle this partnership.
                </p>
              </div>
            )}

            {/* Notes */}
            {partnership.notes && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-800 mb-2">
                  Notes
                </h2>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">
                  {partnership.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Add Partner</h2>
            </div>
            <div className="p-5 space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={memberForm.is_self}
                  onChange={(e) =>
                    setMemberForm((p) => ({
                      ...p,
                      is_self: e.target.checked,
                      contact_id: "",
                    }))
                  }
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700">
                  This is me (Self)
                </span>
              </label>

              {!memberForm.is_self && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Contact
                  </label>
                  <select
                    value={memberForm.contact_id}
                    onChange={(e) =>
                      setMemberForm((p) => ({
                        ...p,
                        contact_id: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Select Contact —</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.phone ? ` (${c.phone})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Share %
                </label>
                <input
                  type="number"
                  value={memberForm.share_percentage}
                  onChange={(e) =>
                    setMemberForm((p) => ({
                      ...p,
                      share_percentage: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 40"
                  min="0"
                  max="100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Advance Contributed (₹)
                </label>
                <input
                  type="number"
                  value={memberForm.advance_contributed}
                  onChange={(e) =>
                    setMemberForm((p) => ({
                      ...p,
                      advance_contributed: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                  min="0"
                />
              </div>

              {memberForm.is_self &&
                parseFloat(memberForm.advance_contributed) > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Debit from Account (for advance)
                    </label>
                    <select
                      value={memberForm.advance_account_id}
                      onChange={(e) =>
                        setMemberForm((p) => ({
                          ...p,
                          advance_account_id: e.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      Advance will be auto-debited from this account and
                      recorded as a transaction.
                    </p>
                  </div>
                )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={memberForm.notes}
                  onChange={(e) =>
                    setMemberForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => setShowAddMemberModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                disabled={addMemberMutation.isPending}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {addMemberMutation.isPending ? "Adding..." : "Add Partner"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {showEditMemberModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Edit Partner</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Share %
                </label>
                <input
                  type="number"
                  value={editMemberForm.share_percentage}
                  onChange={(e) =>
                    setEditMemberForm((p) => ({
                      ...p,
                      share_percentage: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 40"
                  min="0"
                  max="100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Advance Contributed (₹)
                </label>
                <input
                  type="number"
                  value={editMemberForm.advance_contributed}
                  onChange={(e) =>
                    setEditMemberForm((p) => ({
                      ...p,
                      advance_contributed: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={editMemberForm.notes}
                  onChange={(e) =>
                    setEditMemberForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowEditMemberModal(false);
                  setEditMemberId(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEditMember}
                disabled={editMemberMutation.isPending}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {editMemberMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Settle Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                Record Settlement
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Received (₹)
                </label>
                <input
                  type="number"
                  value={settleForm.total_received}
                  onChange={(e) =>
                    setSettleForm((p) => ({
                      ...p,
                      total_received: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Total amount received"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Settlement Date
                </label>
                <input
                  type="date"
                  value={settleForm.actual_end_date}
                  onChange={(e) =>
                    setSettleForm((p) => ({
                      ...p,
                      actual_end_date: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={settleForm.notes}
                  onChange={(e) =>
                    setSettleForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Optional"
                />
              </div>

              {settleForm.total_received && members.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1.5 border border-gray-200">
                  <div className="font-semibold text-gray-700 mb-2">
                    Settlement Preview
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Received:</span>
                    <span>{formatCurrency(settleTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Advance Pool:</span>
                    <span>{formatCurrency(settleAdvancePool)}</span>
                  </div>
                  <hr className="border-gray-300" />
                  <div className="flex justify-between font-semibold">
                    <span>Net Profit:</span>
                    <span>{formatCurrency(settleProfit)}</span>
                  </div>
                  <hr className="border-gray-300" />
                  {members.map((m, i) => {
                    const sharePct = parseFloat(
                      m.member?.share_percentage || 0,
                    );
                    const advance = parseFloat(
                      m.member?.advance_contributed || 0,
                    );
                    const profit = (settleProfit * sharePct) / 100;
                    const total = advance + profit;
                    const name = m.member?.is_self
                      ? "Self (You)"
                      : m.contact?.name || "Unknown";
                    return (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-gray-600">
                          {name} ({sharePct}%):
                        </span>
                        <span className="font-medium">
                          {formatCurrency(total)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => setShowSettleModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSettle}
                disabled={settleMutation.isPending}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {settleMutation.isPending
                  ? "Settling..."
                  : "Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
