import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import LinkedRecordSelect from "../../components/LinkedRecordSelect";

const defaultForm = {
  obligation_type: "receivable",
  contact_id: "",
  amount: "",
  reason: "",
  linked_type: "",
  linked_id: "",
  due_date: new Date().toISOString().split("T")[0],
  account_id: "",
  notes: "",
};

const defaultSettleForm = {
  amount: "",
  settlement_date: new Date().toISOString().split("T")[0],
  payment_mode: "cash",
  account_id: "",
  notes: "",
};

function ObligationList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    obligation_type: "",
    status: "",
    contact_id: "",
    search: "",
  });
  const [showModal, setShowModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleTarget, setSettleTarget] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [settleForm, setSettleForm] = useState(defaultSettleForm);
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const { data: obligations = [], isLoading } = useQuery({
    queryKey: ["obligations", filters],
    queryFn: async () => {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params[k] = v;
      });
      const res = await api.get("/api/obligations", { params });
      return res.data;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["obligations-summary"],
    queryFn: async () =>
      (await api.get("/api/obligations/summary/overview")).data,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => (await api.get("/api/contacts")).data,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await api.get("/api/accounts")).data,
  });

  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["obligation-detail", expandedId],
    queryFn: async () => (await api.get(`/api/obligations/${expandedId}`)).data,
    enabled: !!expandedId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      (await api.post("/api/obligations", payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
      setShowModal(false);
      setForm(defaultForm);
      setErrorMessage("");
    },
    onError: (e) =>
      setErrorMessage(
        e.response?.data?.detail || "Failed to create obligation",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => api.delete(`/api/obligations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
    },
  });

  const settleMutation = useMutation({
    mutationFn: async ({ id, payload }) =>
      (await api.post(`/api/obligations/${id}/settle`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["obligations"] });
      queryClient.invalidateQueries({ queryKey: ["obligations-summary"] });
      queryClient.invalidateQueries({
        queryKey: ["obligation-detail", settleTarget],
      });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setShowSettleModal(false);
      setSettleTarget(null);
      setSettleForm(defaultSettleForm);
      setErrorMessage("");
    },
    onError: (e) =>
      setErrorMessage(e.response?.data?.detail || "Settlement failed"),
  });

  const totals = useMemo(() => {
    let receivable = 0,
      payable = 0;
    obligations.forEach((o) => {
      const remaining =
        parseFloat(o.obligation?.amount || 0) -
        parseFloat(o.obligation?.amount_settled || 0);
      if (o.obligation?.obligation_type === "receivable")
        receivable += remaining;
      else payable += remaining;
    });
    return { receivable, payable };
  }, [obligations]);

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      amount: parseFloat(form.amount),
      contact_id: parseInt(form.contact_id),
      linked_type: form.linked_type || null,
      linked_id: form.linked_id ? parseInt(form.linked_id) : null,
      due_date: form.due_date || null,
      account_id: form.account_id ? parseInt(form.account_id) : null,
    });
  };

  const handleSettle = (e) => {
    e.preventDefault();
    settleMutation.mutate({
      id: settleTarget,
      payload: {
        amount: parseFloat(settleForm.amount),
        settlement_date: settleForm.settlement_date,
        payment_mode: settleForm.payment_mode || null,
        account_id: settleForm.account_id
          ? parseInt(settleForm.account_id)
          : null,
        notes: settleForm.notes || null,
      },
    });
  };

  const openSettle = (ob) => {
    const remaining = parseFloat(ob.amount) - parseFloat(ob.amount_settled);
    setSettleTarget(ob.id);
    setSettleForm({ ...defaultSettleForm, amount: remaining.toString() });
    setShowSettleModal(true);
    setErrorMessage("");
  };

  const statusColor = (s) => {
    if (s === "settled") return "bg-green-100 text-green-700";
    if (s === "partial") return "bg-yellow-100 text-yellow-700";
    return "bg-red-100 text-red-700";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate("/dashboard")}
              className="text-gray-500 hover:text-gray-700 text-sm mb-1"
            >
              ← Dashboard
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Money Flow Log</h1>
            <p className="text-sm text-gray-500">
              Track receivables &amp; payables
            </p>
          </div>
          <button
            onClick={() => {
              setShowModal(true);
              setErrorMessage("");
            }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium"
          >
            + New Obligation
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-xs text-green-600 font-medium">To Receive</p>
              <p className="text-xl font-bold text-green-700">
                {formatCurrency(summary.total_receivable)}
              </p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-xs text-red-600 font-medium">To Pay</p>
              <p className="text-xl font-bold text-red-700">
                {formatCurrency(summary.total_payable)}
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs text-blue-600 font-medium">Net Position</p>
              <p className="text-xl font-bold text-blue-700">
                {formatCurrency(summary.net_position)}
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-600 font-medium">Pending</p>
              <p className="text-xl font-bold text-gray-700">
                {summary.pending_count}
              </p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select
              value={filters.obligation_type}
              onChange={(e) =>
                setFilters({ ...filters, obligation_type: e.target.value })
              }
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              <option value="receivable">Receivable</option>
              <option value="payable">Payable</option>
            </select>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="settled">Settled</option>
            </select>
            <select
              value={filters.contact_id}
              onChange={(e) =>
                setFilters({ ...filters, contact_id: e.target.value })
              }
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Contacts</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search reason / notes..."
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : obligations.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No obligations found
          </div>
        ) : (
          <div className="space-y-3">
            {obligations.map(({ obligation: ob, contact }) => {
              const remaining =
                parseFloat(ob.amount) - parseFloat(ob.amount_settled);
              const isExpanded = expandedId === ob.id;
              return (
                <div
                  key={ob.id}
                  className="bg-white rounded-xl shadow-sm border overflow-hidden"
                >
                  <div
                    className="p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
                    onClick={() => {
                      setExpandedId(isExpanded ? null : ob.id);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${ob.obligation_type === "receivable" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                        >
                          {ob.obligation_type === "receivable"
                            ? "▲ Receivable"
                            : "▼ Payable"}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${statusColor(ob.status)}`}
                        >
                          {ob.status}
                        </span>
                        {ob.linked_type && (
                          <span className="text-xs text-gray-400">
                            via {ob.linked_type} #{ob.linked_id}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-gray-900 mt-1">
                        {ob.contact_id === null
                          ? "Self (You)"
                          : contact?.name || "Unknown"}
                      </p>
                      {ob.reason && (
                        <p className="text-sm text-gray-500 truncate">
                          {ob.reason}
                        </p>
                      )}
                    </div>
                    <div className="text-right ml-4 flex-shrink-0">
                      <p className="text-lg font-bold text-gray-900">
                        {formatCurrency(ob.amount)}
                      </p>
                      {ob.amount_settled > 0 && (
                        <p className="text-xs text-gray-500">
                          Settled: {formatCurrency(ob.amount_settled)}
                        </p>
                      )}
                      {remaining > 0 && ob.status !== "settled" && (
                        <p className="text-xs font-medium text-orange-600">
                          Due: {formatCurrency(remaining)}
                        </p>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t px-4 py-3 bg-gray-50 space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        {ob.due_date && (
                          <div>
                            <span className="text-gray-400">Due:</span>{" "}
                            {formatDate(ob.due_date)}
                          </div>
                        )}
                        {ob.notes && (
                          <div className="col-span-2">
                            <span className="text-gray-400">Notes:</span>{" "}
                            {ob.notes}
                          </div>
                        )}
                        <div>
                          <span className="text-gray-400">Created:</span>{" "}
                          {formatDate(ob.created_at)}
                        </div>
                      </div>

                      {/* Settlements */}
                      {detailData?.settlements?.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                            Settlements
                          </h4>
                          <div className="space-y-1">
                            {detailData.settlements.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center justify-between text-sm bg-white rounded px-3 py-2 border"
                              >
                                <div>
                                  <span className="font-medium">
                                    {formatCurrency(s.amount)}
                                  </span>
                                  <span className="text-gray-400 ml-2">
                                    {formatDate(s.settlement_date)}
                                  </span>
                                  {s.payment_mode && (
                                    <span className="text-xs text-gray-400 ml-2">
                                      ({s.payment_mode})
                                    </span>
                                  )}
                                </div>
                                {s.notes && (
                                  <span className="text-xs text-gray-400">
                                    {s.notes}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        {ob.status !== "settled" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openSettle(ob);
                            }}
                            className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700"
                          >
                            Record Settlement
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm("Delete this obligation?"))
                              deleteMutation.mutate(ob.id);
                          }}
                          className="bg-red-100 text-red-700 px-3 py-1.5 rounded text-sm hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-bold mb-4">New Obligation</h2>
              {errorMessage && (
                <p className="text-red-600 text-sm mb-3">{errorMessage}</p>
              )}
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Type
                    </label>
                    <select
                      value={form.obligation_type}
                      onChange={(e) =>
                        setForm({ ...form, obligation_type: e.target.value })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="receivable">
                        Receivable (they owe me)
                      </option>
                      <option value="payable">Payable (I owe them)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Contact *
                    </label>
                    <select
                      required
                      value={form.contact_id}
                      onChange={(e) =>
                        setForm({ ...form, contact_id: e.target.value })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select contact</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Amount *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) =>
                        setForm({ ...form, amount: e.target.value })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={form.due_date}
                      onChange={(e) =>
                        setForm({ ...form, due_date: e.target.value })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Reason
                  </label>
                  <input
                    type="text"
                    value={form.reason}
                    onChange={(e) =>
                      setForm({ ...form, reason: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="e.g. Property sale balance, partnership profit share"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Linked Type
                    </label>
                    <select
                      value={form.linked_type}
                      onChange={(e) =>
                        setForm({ ...form, linked_type: e.target.value, linked_id: "" })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">None</option>
                      <option value="property">Property</option>
                      <option value="partnership">Partnership</option>
                      <option value="loan">Loan</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Linked Record
                    </label>
                    {form.linked_type && form.linked_type !== "other" ? (
                      <LinkedRecordSelect
                        linkedType={form.linked_type}
                        value={form.linked_id}
                        onChange={(val) =>
                          setForm({ ...form, linked_id: val })
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        value={form.linked_id}
                        onChange={(e) =>
                          setForm({ ...form, linked_id: e.target.value })
                        }
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                        placeholder={form.linked_type === "other" ? "Reference" : "Select linked type first"}
                        disabled={!form.linked_type}
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Account
                  </label>
                  <select
                    value={form.account_id}
                    onChange={(e) =>
                      setForm({ ...form, account_id: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">— No account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    rows={2}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setForm(defaultForm);
                    }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {createMutation.isPending ? "Saving…" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Settlement Modal */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h2 className="text-lg font-bold mb-4">Record Settlement</h2>
              {errorMessage && (
                <p className="text-red-600 text-sm mb-3">{errorMessage}</p>
              )}
              <form onSubmit={handleSettle} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Amount *
                    </label>
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={settleForm.amount}
                      onChange={(e) =>
                        setSettleForm({ ...settleForm, amount: e.target.value })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={settleForm.settlement_date}
                      onChange={(e) =>
                        setSettleForm({
                          ...settleForm,
                          settlement_date: e.target.value,
                        })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Payment Mode
                    </label>
                    <select
                      value={settleForm.payment_mode}
                      onChange={(e) =>
                        setSettleForm({
                          ...settleForm,
                          payment_mode: e.target.value,
                        })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Account
                    </label>
                    <select
                      value={settleForm.account_id}
                      onChange={(e) =>
                        setSettleForm({
                          ...settleForm,
                          account_id: e.target.value,
                        })
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">— no ledger entry —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={settleForm.notes}
                    onChange={(e) =>
                      setSettleForm({ ...settleForm, notes: e.target.value })
                    }
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettleModal(false);
                      setSettleTarget(null);
                    }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={settleMutation.isPending}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                  >
                    {settleMutation.isPending ? "Saving…" : "Record Settlement"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ObligationList;
