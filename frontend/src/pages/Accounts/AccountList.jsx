import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";
import {
  Wallet,
  Landmark,
  CreditCard,
  Smartphone,
  Lock,
  Building2,
  ArrowLeftRight,
  Plus,
  TrendingUp,
  ShieldCheck,
  Percent,
  DollarSign,
} from "lucide-react";

const CARD_CONFIG = {
  cash: {
    icon: Wallet,
    label: "Cash",
    gradient: "from-emerald-600 via-emerald-700 to-teal-800",
    hoverGlow: "hover:shadow-emerald-500/30",
    chipColor: "bg-emerald-400/30",
    textAccent: "text-emerald-200",
  },
  savings: {
    icon: Landmark,
    label: "Savings",
    gradient: "from-blue-700 via-indigo-800 to-blue-900",
    hoverGlow: "hover:shadow-blue-500/30",
    chipColor: "bg-blue-400/30",
    textAccent: "text-blue-200",
  },
  current: {
    icon: Building2,
    label: "Current",
    gradient: "from-slate-600 via-slate-700 to-slate-800",
    hoverGlow: "hover:shadow-slate-500/30",
    chipColor: "bg-slate-400/30",
    textAccent: "text-slate-300",
  },
  wallet: {
    icon: Smartphone,
    label: "Wallet",
    gradient: "from-violet-600 via-purple-700 to-violet-800",
    hoverGlow: "hover:shadow-violet-500/30",
    chipColor: "bg-violet-400/30",
    textAccent: "text-violet-200",
  },
  fixed_deposit: {
    icon: Lock,
    label: "FD",
    gradient: "from-amber-600 via-amber-700 to-orange-800",
    hoverGlow: "hover:shadow-amber-500/30",
    chipColor: "bg-amber-400/30",
    textAccent: "text-amber-200",
  },
  credit_card: {
    icon: CreditCard,
    label: "Credit Card",
    gradient: "from-gray-800 via-gray-900 to-black",
    hoverGlow: "hover:shadow-gray-600/40",
    chipColor: "bg-gray-500/30",
    textAccent: "text-gray-300",
  },
};

const FALLBACK_CONFIG = CARD_CONFIG.cash;

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

  // Separate assets vs liabilities (credit cards)
  const assets = accounts.filter((a) => a.account_type !== "credit_card");
  const creditCards = accounts.filter((a) => a.account_type === "credit_card");

  const totalAssets = assets.reduce((s, a) => s + Number(a.current_balance || 0), 0);
  // Credit card balance is typically negative (debit = spending), so current_balance shows how much is owed
  const totalCCDebt = creditCards.reduce((s, a) => s + Math.abs(Math.min(0, Number(a.current_balance || 0))), 0);
  const netWorth = totalAssets - totalCCDebt;

  const liquidity = accounts
    .filter((a) => a.account_type === "cash" || a.account_type === "savings" || a.account_type === "wallet")
    .reduce((s, a) => s + Number(a.current_balance || 0), 0);

  const totalCreditLimit = creditCards.reduce((s, a) => s + Number(a.credit_limit || 0), 0);
  const availableCredit = totalCreditLimit - totalCCDebt;
  const debtRatio = totalCreditLimit > 0 ? (totalCCDebt / totalCreditLimit) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Accounts"
        subtitle="Manage your financial accounts"
        backTo="/dashboard"
        actions={
          <>
            {accounts.length >= 2 && (
              <Button
                variant="white"
                size="lg"
                onClick={() => setShowTransfer(true)}
              >
                <ArrowLeftRight className="w-4 h-4 mr-1.5 inline" />
                Transfer
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="white"
                size="lg"
                onClick={() => navigate("/accounts/new")}
              >
                <Plus className="w-4 h-4 mr-1.5 inline" />
                New Account
              </Button>
            )}
          </>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-300" />
              <span className="text-xs font-medium text-white/70">Net Worth</span>
            </div>
            <div className={`text-xl font-bold ${netWorth >= 0 ? "text-white" : "text-rose-300"}`}>
              {formatCurrency(netWorth)}
            </div>
            <div className="text-xs text-white/50 mt-0.5">Assets − Liabilities</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-blue-300" />
              <span className="text-xs font-medium text-white/70">Liquidity</span>
            </div>
            <div className="text-xl font-bold text-white">{formatCurrency(liquidity)}</div>
            <div className="text-xs text-white/50 mt-0.5">Cash + Savings + Wallets</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-teal-300" />
              <span className="text-xs font-medium text-white/70">Available Credit</span>
            </div>
            <div className="text-xl font-bold text-white">
              {creditCards.length > 0 ? formatCurrency(availableCredit) : "—"}
            </div>
            <div className="text-xs text-white/50 mt-0.5">
              {creditCards.length > 0 ? `of ${formatCurrency(totalCreditLimit)} limit` : "No credit cards"}
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="w-4 h-4 text-amber-300" />
              <span className="text-xs font-medium text-white/70">Debt Ratio</span>
            </div>
            <div className={`text-xl font-bold ${debtRatio > 70 ? "text-rose-300" : debtRatio > 40 ? "text-amber-300" : "text-emerald-300"}`}>
              {creditCards.length > 0 ? `${debtRatio.toFixed(1)}%` : "—"}
            </div>
            <div className="text-xs text-white/50 mt-0.5">
              {creditCards.length > 0 ? "credit utilization" : "No credit cards"}
            </div>
          </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {accounts.map((a) => {
              const cfg = CARD_CONFIG[a.account_type] || FALLBACK_CONFIG;
              const Icon = cfg.icon;
              const bal = Number(a.current_balance || 0);
              const isCreditCard = a.account_type === "credit_card";
              const maskedNum = a.account_number
                ? `•••• ${a.account_number.slice(-4)}`
                : null;

              return (
                <div
                  key={a.id}
                  onClick={() => navigate(`/accounts/${a.id}`)}
                  className={`
                    relative overflow-hidden rounded-2xl p-5 cursor-pointer
                    bg-gradient-to-br ${cfg.gradient}
                    shadow-lg ${cfg.hoverGlow} hover:shadow-xl
                    hover:scale-[1.02] hover:backdrop-blur-md
                    transition-all duration-300 ease-out group
                    border border-white/10
                    min-h-[170px] flex flex-col justify-between
                  `}
                >
                  {/* Glassmorphism overlay on hover */}
                  <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 backdrop-blur-0 group-hover:backdrop-blur-[2px] transition-all duration-300 rounded-2xl pointer-events-none" />

                  {/* Decorative circles */}
                  <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full pointer-events-none" />
                  <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-white/5 rounded-full pointer-events-none" />

                  {/* Top: Type + Chip */}
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-2 rounded-lg ${cfg.chipColor}`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white/90">{a.name}</div>
                        <div className={`text-[11px] ${cfg.textAccent}`}>
                          {cfg.label}
                          {a.bank_name ? ` · ${a.bank_name}` : ""}
                        </div>
                      </div>
                    </div>
                    {/* Card chip graphic for bank/credit cards */}
                    {a.account_type !== "cash" && (
                      <div className="w-10 h-7 rounded-md bg-gradient-to-br from-yellow-300/60 to-yellow-500/40 border border-yellow-400/30 flex items-center justify-center">
                        <div className="w-4 h-4 border border-yellow-400/50 rounded-sm" />
                      </div>
                    )}
                  </div>

                  {/* Balance */}
                  <div className="relative mt-auto pt-3">
                    {maskedNum && (
                      <div className="text-xs text-white/40 font-mono tracking-widest mb-1">
                        {maskedNum}
                      </div>
                    )}
                    <div className={`text-2xl font-bold tracking-tight ${bal < 0 ? "text-rose-300" : "text-white"}`}>
                      {formatCurrency(bal)}
                    </div>
                    {isCreditCard && a.credit_limit && (
                      <div className="mt-1.5">
                        <div className="flex justify-between text-[10px] text-white/50 mb-0.5">
                          <span>Used</span>
                          <span>{formatCurrency(Number(a.credit_limit))} limit</span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              Math.abs(bal) / Number(a.credit_limit) > 0.7
                                ? "bg-rose-400"
                                : "bg-teal-400"
                            }`}
                            style={{ width: `${Math.min(100, (Math.abs(bal) / Number(a.credit_limit)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
