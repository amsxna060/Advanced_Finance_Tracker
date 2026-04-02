import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";

const TYPE_ICONS = {
  cash: "💵",
  savings: "🏦",
  current: "🏢",
  wallet: "📱",
  fixed_deposit: "🔒",
};

const TYPE_LABELS = {
  cash: "Cash",
  savings: "Savings",
  current: "Current",
  wallet: "Wallet",
  fixed_deposit: "FD",
};

const today = () => new Date().toISOString().slice(0, 10);

export default function AccountList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();

  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({
    from_account_id: "",
    to_account_id: "",
    amount: "",
    txn_date: today(),
    description: "",
  });
  const [transferError, setTransferError] = useState("");

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const res = await api.get("/api/accounts");
      return res.data;
    },
  });

  const transferMutation = useMutation({
    mutationFn: (payload) => api.post("/api/accounts/transfer", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setShowTransfer(false);
      setTransferForm({
        from_account_id: "",
        to_account_id: "",
        amount: "",
        txn_date: today(),
        description: "",
      });
      setTransferError("");
    },
    onError: (err) => {
      setTransferError(
        err?.response?.data?.detail || "Transfer failed. Please try again.",
      );
    },
  });

  const handleTransfer = (e) => {
    e.preventDefault();
    setTransferError("");
    if (!transferForm.from_account_id || !transferForm.to_account_id) {
      setTransferError("Please select both accounts.");
      return;
    }
    if (transferForm.from_account_id === transferForm.to_account_id) {
      setTransferError("Source and destination accounts must be different.");
      return;
    }
    if (!transferForm.amount || Number(transferForm.amount) <= 0) {
      setTransferError("Please enter a valid amount.");
      return;
    }
    transferMutation.mutate({
      ...transferForm,
      from_account_id: Number(transferForm.from_account_id),
      to_account_id: Number(transferForm.to_account_id),
      amount: Number(transferForm.amount),
    });
  };

  const totalBalance = accounts.reduce(
    (s, a) => s + Number(a.current_balance || 0),
    0,
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate("/dashboard")}
              className="text-gray-500 hover:text-gray-900 text-sm mb-2"
            >
              ← Dashboard
            </button>
            <h1 className="text-3xl font-bold text-gray-900">
              Cash & Accounts
            </h1>
            <p className="text-gray-500 mt-1">
              Track balances across all cash, bank, and wallet accounts
            </p>
          </div>
          <div className="flex items-center gap-3">
            {accounts.length >= 2 && (
              <button
                onClick={() => setShowTransfer(true)}
                className="px-5 py-2.5 bg-white border border-teal-600 text-teal-700 rounded-lg hover:bg-teal-50 font-medium"
              >
                ⇄ Transfer
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => navigate("/accounts/new")}
                className="px-5 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium"
              >
                + New Account
              </button>
            )}
          </div>
        </div>

        {/* Total balance banner */}
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-lg p-5 mb-6 text-white">
          <div className="text-sm opacity-80">
            Total Balance Across All Accounts
          </div>
          <div className="text-3xl font-bold mt-1">
            {formatCurrency(totalBalance)}
          </div>
          <div className="text-sm opacity-70 mt-1">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-500">Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <div className="text-4xl mb-3">🏦</div>
            <p className="text-gray-500">
              No accounts added yet. Add your first account!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((a) => (
              <div
                key={a.id}
                onClick={() => navigate(`/accounts/${a.id}`)}
                className="bg-white rounded-lg shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-2xl">
                    {TYPE_ICONS[a.account_type] || "💰"}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{a.name}</div>
                    <div className="text-xs text-gray-500">
                      {TYPE_LABELS[a.account_type] || a.account_type}
                      {a.bank_name ? ` · ${a.bank_name}` : ""}
                    </div>
                  </div>
                </div>
                <div
                  className={`text-2xl font-bold ${Number(a.current_balance) >= 0 ? "text-teal-700" : "text-red-600"}`}
                >
                  {formatCurrency(a.current_balance)}
                </div>
                {a.account_number && (
                  <div className="text-xs text-gray-400 mt-1">
                    ••••{a.account_number.slice(-4)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transfer Modal */}
      {showTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-900">
                Transfer Money
              </h2>
              <button
                onClick={() => {
                  setShowTransfer(false);
                  setTransferError("");
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleTransfer} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  From Account
                </label>
                <select
                  required
                  value={transferForm.from_account_id}
                  onChange={(e) =>
                    setTransferForm((f) => ({
                      ...f,
                      from_account_id: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select source account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {formatCurrency(a.current_balance)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  To Account
                </label>
                <select
                  required
                  value={transferForm.to_account_id}
                  onChange={(e) =>
                    setTransferForm((f) => ({
                      ...f,
                      to_account_id: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select destination account…</option>
                  {accounts
                    .filter(
                      (a) =>
                        String(a.id) !== String(transferForm.from_account_id),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — {formatCurrency(a.current_balance)}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={transferForm.amount}
                    onChange={(e) =>
                      setTransferForm((f) => ({ ...f, amount: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={transferForm.txn_date}
                    onChange={(e) =>
                      setTransferForm((f) => ({
                        ...f,
                        txn_date: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Monthly savings transfer"
                  value={transferForm.description}
                  onChange={(e) =>
                    setTransferForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {transferError && (
                <p className="text-sm text-red-600">{transferError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowTransfer(false);
                    setTransferError("");
                  }}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferMutation.isPending}
                  className="flex-1 px-4 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
                >
                  {transferMutation.isPending ? "Transferring…" : "Transfer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
