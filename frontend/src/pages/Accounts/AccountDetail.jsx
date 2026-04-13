import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import LinkedRecordSelect from "../../components/LinkedRecordSelect";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

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

  if (isLoading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!account)
    return <div className="p-8 text-rose-500">Account not found</div>;

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

  const totalCredits = txns
    .filter((t) => t.txn_type === "credit")
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalDebits = txns
    .filter((t) => t.txn_type === "debit")
    .reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={account.name}
        subtitle={`${account.account_type}${account.bank_name ? ` · ${account.bank_name}` : ""}${account.account_number ? ` · ****${account.account_number.slice(-4)}` : ""}`}
        backTo="/accounts"
        actions={
          isAdmin && (
            <>
              <Button
                variant="white"
                size="md"
                onClick={() => navigate(`/accounts/${id}/edit`)}
              >
                Edit
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={() => {
                  if (
                    window.confirm("Delete this account and all transactions?")
                  )
                    deleteSelf.mutate();
                }}
              >
                Delete
              </Button>
            </>
          )
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <HeroStat
            label="Current Balance"
            value={formatCurrency(account.current_balance)}
            sub={`Opening: ${formatCurrency(account.opening_balance)}`}
            accent="emerald"
          />
          <HeroStat
            label="Total Credits"
            value={formatCurrency(totalCredits)}
            accent="teal"
          />
          <HeroStat
            label="Total Debits"
            value={formatCurrency(totalDebits)}
            accent="rose"
          />
          <HeroStat label="Transactions" value={txns.length} accent="indigo" />
        </div>
      </PageHero>

      <PageBody>
        {/* Transaction form */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-slate-800">Transactions</h2>
            <button
              onClick={() => setShowTxnForm(!showTxnForm)}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-xl text-sm hover:bg-teal-700 shadow-sm active:scale-[0.98]"
            >
              + Add Transaction
            </button>
          </div>

          {showTxnForm && (
            <div className="mb-5 p-4 bg-teal-50 rounded-xl border border-teal-200">
              {txnError && (
                <div className="mb-2 text-rose-700 text-sm">{txnError}</div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Type *
                  </label>
                  <select
                    name="txn_type"
                    value={txnForm.txn_type}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  >
                    <option value="credit">Credit (Money In ↑)</option>
                    <option value="debit">Debit (Money Out ↓)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={txnForm.amount}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Date *
                  </label>
                  <input
                    name="txn_date"
                    type="date"
                    value={txnForm.txn_date}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Payment Mode
                  </label>
                  <select
                    name="payment_mode"
                    value={txnForm.payment_mode}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m || "— Select —"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Linked To
                  </label>
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
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                    <label className="block text-xs font-medium text-slate-500 mb-1">
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
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Description
                  </label>
                  <input
                    name="description"
                    value={txnForm.description}
                    onChange={handleTxnChange}
                    placeholder="What was this for?"
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Ref / Cheque Number
                  </label>
                  <input
                    name="reference_number"
                    value={txnForm.reference_number}
                    onChange={handleTxnChange}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                  className="px-4 py-1.5 bg-teal-600 text-white rounded-xl text-sm hover:bg-teal-700 disabled:opacity-50 shadow-sm active:scale-[0.98]"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowTxnForm(false)}
                  className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200"
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
              className="flex-1 px-3 py-1.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
            >
              <option value="">All</option>
              <option value="credit">Credits only</option>
              <option value="debit">Debits only</option>
            </select>
          </div>

          {/* Transaction ledger */}
          {filteredTxns.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">
              No transactions yet
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left bg-slate-50">
                    <th className="pb-2 pt-2 text-slate-500 font-medium">
                      Date
                    </th>
                    <th className="pb-2 pt-2 text-slate-500 font-medium">
                      Description
                    </th>
                    <th className="pb-2 pt-2 text-slate-500 font-medium">
                      Mode
                    </th>
                    <th className="pb-2 pt-2 text-slate-500 font-medium">
                      Linked
                    </th>
                    <th className="pb-2 pt-2 text-right text-slate-500 font-medium">
                      Amount
                    </th>
                    <th className="pb-2 pt-2 text-right text-slate-500 font-medium">
                      Balance
                    </th>
                    {isAdmin && <th className="pb-2 pt-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="py-2 text-slate-600">
                        {formatDate(t.txn_date)}
                      </td>
                      <td className="py-2 text-slate-800 max-w-xs truncate">
                        {t.description || "—"}
                      </td>
                      <td className="py-2 text-slate-500 capitalize">
                        {t.payment_mode || "—"}
                      </td>
                      <td className="py-2 text-slate-500">
                        {t.linked_type ? (
                          <span className="capitalize">
                            {t.linked_type} #{t.linked_id}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`py-2 text-right font-semibold ${t.txn_type === "credit" ? "text-emerald-600" : "text-rose-600"}`}
                      >
                        {t.txn_type === "credit" ? "+" : "-"}
                        {formatCurrency(t.amount)}
                      </td>
                      <td
                        className={`py-2 text-right ${(balanceMap[t.id] || 0) >= 0 ? "text-slate-800" : "text-rose-600"}`}
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
                            className="text-rose-400 hover:text-rose-600 text-xs"
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
      </PageBody>
    </div>
  );
}
