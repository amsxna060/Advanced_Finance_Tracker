import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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

export default function AccountList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const res = await api.get("/api/accounts");
      return res.data;
    },
  });

  const totalBalance = accounts.reduce((s, a) => s + Number(a.current_balance || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button onClick={() => navigate("/dashboard")} className="text-gray-500 hover:text-gray-900 text-sm mb-2">← Dashboard</button>
            <h1 className="text-3xl font-bold text-gray-900">Cash & Accounts</h1>
            <p className="text-gray-500 mt-1">Track balances across all cash, bank, and wallet accounts</p>
          </div>
          {isAdmin && (
            <button onClick={() => navigate("/accounts/new")} className="px-5 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium">
              + New Account
            </button>
          )}
        </div>

        {/* Total balance banner */}
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-lg p-5 mb-6 text-white">
          <div className="text-sm opacity-80">Total Balance Across All Accounts</div>
          <div className="text-3xl font-bold mt-1">{formatCurrency(totalBalance)}</div>
          <div className="text-sm opacity-70 mt-1">{accounts.length} account{accounts.length !== 1 ? "s" : ""}</div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-500">Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <div className="text-4xl mb-3">🏦</div>
            <p className="text-gray-500">No accounts added yet. Add your first account!</p>
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
                  <div className="text-2xl">{TYPE_ICONS[a.account_type] || "💰"}</div>
                  <div>
                    <div className="font-semibold text-gray-900">{a.name}</div>
                    <div className="text-xs text-gray-500">{TYPE_LABELS[a.account_type] || a.account_type}{a.bank_name ? ` · ${a.bank_name}` : ""}</div>
                  </div>
                </div>
                <div className={`text-2xl font-bold ${Number(a.current_balance) >= 0 ? "text-teal-700" : "text-red-600"}`}>
                  {formatCurrency(a.current_balance)}
                </div>
                {a.account_number && <div className="text-xs text-gray-400 mt-1">••••{a.account_number.slice(-4)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
