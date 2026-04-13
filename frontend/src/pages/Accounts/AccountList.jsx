import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

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

  const activeAccounts = accounts.filter((a) => Number(a.current_balance) !== 0).length;
  const accountTypes = new Set(accounts.map((a) => a.account_type)).size;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Accounts"
        subtitle="Manage your financial accounts"
        backTo="/dashboard"
        actions={
          <>
            {accounts.length >= 2 && (
              <Button variant="white" size="lg" onClick={() => setShowTransfer(true)}>⇄ Transfer</Button>
            )}
            {isAdmin && (
              <Button variant="white" size="lg" onClick={() => navigate("/accounts/new")}>+ New Account</Button>
            )}
          </>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <HeroStat label="Total Accounts" value={accounts.length} accent="indigo" />
          <HeroStat label="Total Balance" value={formatCurrency(totalBalance)} accent="emerald" />
          <HeroStat label="Active Accounts" value={activeAccounts} accent="teal" />
          <HeroStat label="Account Types" value={accountTypes} accent="violet" />
        </div>
      </PageHero>

      <PageBody>
        {isLoading ? (
          <div className="text-center py-16 text-slate-500">Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/60 shadow-sm">
            <div className="text-4xl mb-3">🏦</div>
            <p className="text-slate-400 text-sm">
              No accounts added yet. Add your first account!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((a) => (
              <div
                key={a.id}
                onClick={() => navigate(`/accounts/${a.id}`)}
                className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-2xl">
                    {TYPE_ICONS[a.account_type] || "💰"}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{a.name}</div>
                    <div className="text-xs text-slate-500">
                      {TYPE_LABELS[a.account_type] || a.account_type}
                      {a.bank_name ? ` · ${a.bank_name}` : ""}
                    </div>
                  </div>
                </div>
                <div
                  className={`text-2xl font-bold ${Number(a.current_balance) >= 0 ? "text-teal-700" : "text-rose-600"}`}
                >
                  {formatCurrency(a.current_balance)}
                </div>
                {a.account_number && (
                  <div className="text-xs text-slate-400 mt-1">
                    ••••{a.account_number.slice(-4)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PageBody>

      {/* Transfer Modal */}
      {showTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-slate-900">
                Transfer Money
              </h2>
              <button
                onClick={() => {
                  setShowTransfer(false);
                  setTransferError("");
                }}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleTransfer} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
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
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                <label className="block text-xs font-medium text-slate-500 mb-1">
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
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                  <label className="block text-xs font-medium text-slate-500 mb-1">
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
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
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
                    className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
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
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                />
              </div>

              {transferError && (
                <p className="text-sm text-rose-700">{transferError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowTransfer(false);
                    setTransferError("");
                  }}
                  className="flex-1 px-3.5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferMutation.isPending}
                  className="flex-1 px-3.5 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-50 shadow-sm active:scale-[0.98]"
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
