import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import LinkedRecordSelect from "../../components/LinkedRecordSelect";

const LINKED_TYPES = [
  "",
  "loan",
  "property",
  "partnership",
  "beesi",
  "expense",
  "manual",
];
const PAYMENT_MODES = [
  "",
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "neft",
  "rtgs",
];

const EMPTY_TXN = {
  txn_type: "credit",
  amount: "",
  txn_date: new Date().toISOString().slice(0, 10),
  description: "",
  linked_type: "",
  linked_id: "",
  reference_number: "",
  payment_mode: "",
};

export default function AccountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [showTxnForm, setShowTxnForm] = useState(false);
  const [txnForm, setTxnForm] = useState(EMPTY_TXN);
  const [txnError, setTxnError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const { data: account, isLoading } = useQuery({
    queryKey: ["account", id],
    queryFn: async () => {
      const res = await api.get(`/api/accounts/${id}`);
      return res.data;
    },
  });

  const addTxn = useMutation({
    mutationFn: (data) => api.post(`/api/accounts/${id}/transactions`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowTxnForm(false);
      setTxnForm(EMPTY_TXN);
    },
    onError: (e) => setTxnError(e.response?.data?.detail || "Failed to save"),
  });

  const deleteTxn = useMutation({
    mutationFn: (txnId) => api.delete(`/api/accounts/transactions/${txnId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account", id] }),
  });

  const deleteSelf = useMutation({
    mutationFn: () => api.delete(`/api/accounts/${id}`),
    onSuccess: () => navigate("/accounts"),
  });

  const handleTxnChange = (e) =>
    setTxnForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  if (isLoading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (!account)
    return <div className="p-8 text-red-500">Account not found</div>;

  const txns = account.transactions || [];
  const filteredTxns = txns.filter((t) => {
    const matchSearch =
      !search ||
      (t.description || "").toLowerCase().includes(search.toLowerCase()) ||
      String(t.amount).includes(search);
    const matchType = !typeFilter || t.txn_type === typeFilter;
    return matchSearch && matchType;
  });

  // Build running balance (transactions are desc so we need to compute from cumulative)
  let runningBal = Number(account.opening_balance || 0);
  const txnsAsc = [...txns].reverse(); // ascending for running balance
  const balanceMap = {};
  txnsAsc.forEach((t) => {
    if (t.txn_type === "credit") runningBal += Number(t.amount);
    else runningBal -= Number(t.amount);
    balanceMap[t.id] = runningBal;
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <button
              onClick={() => navigate("/accounts")}
              className="text-gray-500 hover:text-gray-900 text-sm mb-1"
            >
              ← All Accounts
            </button>
            <h1 className="text-2xl font-bold text-gray-900">{account.name}</h1>
            <p className="text-sm text-gray-500 capitalize">
              {account.account_type}
              {account.bank_name ? ` · ${account.bank_name}` : ""}
              {account.account_number
                ? ` · ****${account.account_number.slice(-4)}`
                : ""}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/accounts/${id}/edit`)}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm("Delete this account and all transactions?")
                  )
                    deleteSelf.mutate();
                }}
                className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Balance card */}
        <div
          className={`rounded-lg p-5 mb-6 text-white ${Number(account.current_balance) >= 0 ? "bg-teal-600" : "bg-red-600"}`}
        >
          <div className="text-sm opacity-80">Current Balance</div>
          <div className="text-3xl font-bold mt-1">
            {formatCurrency(account.current_balance)}
          </div>
          <div className="text-sm opacity-70 mt-1">
            Opening: {formatCurrency(account.opening_balance)}&nbsp; · &nbsp;
            {txns.length} transactions
          </div>
        </div>

        {/* Transaction form */}
        <div className="bg-white rounded-lg shadow-sm p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">
              Transactions
            </h2>
            <button
              onClick={() => setShowTxnForm(!showTxnForm)}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700"
            >
              + Add Transaction
            </button>
          </div>

          {showTxnForm && (
            <div className="mb-5 p-4 bg-teal-50 rounded-lg border border-teal-200">
              {txnError && (
                <div className="mb-2 text-red-600 text-sm">{txnError}</div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="block text-gray-600 mb-1">Type *</label>
                  <select
                    name="txn_type"
                    value={txnForm.txn_type}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-teal-400"
                  >
                    <option value="credit">Credit (Money In ↑)</option>
                    <option value="debit">Debit (Money Out ↓)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={txnForm.amount}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">Date *</label>
                  <input
                    name="txn_date"
                    type="date"
                    value={txnForm.txn_date}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">
                    Payment Mode
                  </label>
                  <select
                    name="payment_mode"
                    value={txnForm.payment_mode}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-teal-400"
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m || "— Select —"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">Linked To</label>
                  <select
                    name="linked_type"
                    value={txnForm.linked_type}
                    onChange={(e) =>
                      setTxnForm((p) => ({
                        ...p,
                        linked_type: e.target.value,
                        linked_id: "",
                      }))
                    }
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-teal-400"
                  >
                    {LINKED_TYPES.map((m) => (
                      <option key={m} value={m}>
                        {m || "— None —"}
                      </option>
                    ))}
                  </select>
                </div>
                {txnForm.linked_type && txnForm.linked_type !== "manual" && (
                  <div>
                    <label className="block text-gray-600 mb-1">
                      Linked Record
                    </label>
                    <LinkedRecordSelect
                      linkedType={txnForm.linked_type}
                      value={txnForm.linked_id}
                      onChange={(val) =>
                        setTxnForm((p) => ({ ...p, linked_id: val }))
                      }
                    />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-gray-600 mb-1">
                    Description
                  </label>
                  <input
                    name="description"
                    value={txnForm.description}
                    onChange={handleTxnChange}
                    placeholder="What was this for?"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">
                    Ref / Cheque Number
                  </label>
                  <input
                    name="reference_number"
                    value={txnForm.reference_number}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-teal-400"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setTxnError("");
                    addTxn.mutate({
                      ...txnForm,
                      amount: Number(txnForm.amount),
                      linked_id: txnForm.linked_id
                        ? Number(txnForm.linked_id)
                        : undefined,
                    });
                  }}
                  disabled={addTxn.isPending}
                  className="px-4 py-1.5 bg-teal-600 text-white rounded text-sm hover:bg-teal-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowTxnForm(false)}
                  className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input
              placeholder="Search transactions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-400"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-400"
            >
              <option value="">All</option>
              <option value="credit">Credits only</option>
              <option value="debit">Debits only</option>
            </select>
          </div>

          {/* Transaction ledger */}
          {filteredTxns.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              No transactions yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="pb-2 text-gray-500 font-medium">Date</th>
                    <th className="pb-2 text-gray-500 font-medium">
                      Description
                    </th>
                    <th className="pb-2 text-gray-500 font-medium">Mode</th>
                    <th className="pb-2 text-gray-500 font-medium">Linked</th>
                    <th className="pb-2 text-right text-gray-500 font-medium">
                      Amount
                    </th>
                    <th className="pb-2 text-right text-gray-500 font-medium">
                      Balance
                    </th>
                    {isAdmin && <th className="pb-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 text-gray-600">
                        {formatDate(t.txn_date)}
                      </td>
                      <td className="py-2 text-gray-800 max-w-xs truncate">
                        {t.description || "—"}
                      </td>
                      <td className="py-2 text-gray-500 capitalize">
                        {t.payment_mode || "—"}
                      </td>
                      <td className="py-2 text-gray-500">
                        {t.linked_type ? (
                          <span className="capitalize">
                            {t.linked_type} #{t.linked_id}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`py-2 text-right font-semibold ${t.txn_type === "credit" ? "text-green-600" : "text-red-600"}`}
                      >
                        {t.txn_type === "credit" ? "+" : "-"}
                        {formatCurrency(t.amount)}
                      </td>
                      <td
                        className={`py-2 text-right ${(balanceMap[t.id] || 0) >= 0 ? "text-gray-800" : "text-red-600"}`}
                      >
                        {formatCurrency(balanceMap[t.id] || 0)}
                      </td>
                      {isAdmin && (
                        <td className="py-2 text-right">
                          <button
                            onClick={() => {
                              if (window.confirm("Delete this transaction?"))
                                deleteTxn.mutate(t.id);
                            }}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
