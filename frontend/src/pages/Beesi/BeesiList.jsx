import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

export default function BeesiList() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("");

  const { data: beesis = [], isLoading } = useQuery({
    queryKey: ["beesis", statusFilter],
    queryFn: async () => {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.get("/api/beesi", { params });
      return res.data;
    },
  });

  function scoreBadge(b) {
    const summary = b.summary || {};
    const pl = Number(summary.profit_loss || 0);
    if (!summary.has_withdrawn) return null;
    return pl >= 0
      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">+{formatCurrency(pl)} profit</span>
      : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">{formatCurrency(pl)} loss</span>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button onClick={() => navigate("/dashboard")} className="text-gray-500 hover:text-gray-900 text-sm mb-2">← Dashboard</button>
            <h1 className="text-3xl font-bold text-gray-900">Beesi / BC Funds</h1>
            <p className="text-gray-500 mt-1">Track chit funds, rotating savings pools, and monthly installments</p>
          </div>
          <button
            onClick={() => navigate("/beesi/new")}
            className="px-5 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium"
          >+ New Beesi</button>
        </div>

        {/* Filter */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-5 flex gap-3 items-center">
          <label className="text-sm font-medium text-gray-700">Status:</label>
          {["", "active", "completed", "cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                statusFilter === s
                  ? "bg-purple-600 text-white border-purple-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-purple-400"
              }`}
            >
              {s === "" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-gray-500">Loading…</div>
        ) : beesis.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <div className="text-4xl mb-3">💰</div>
            <p className="text-gray-500">No Beesi funds found. Add your first one!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {beesis.map((b) => {
              const summary = b.summary || {};
              const paidPct = b.tenure_months > 0 ? Math.round((summary.months_paid / b.tenure_months) * 100) : 0;
              return (
                <div
                  key={b.id}
                  onClick={() => navigate(`/beesi/${b.id}`)}
                  className="bg-white rounded-lg shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow border border-transparent hover:border-purple-200"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{b.title}</h2>
                      <p className="text-sm text-gray-500">Started {formatDate(b.start_date)}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      b.status === "active" ? "bg-green-100 text-green-700"
                        : b.status === "completed" ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>{b.status}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                    <div>
                      <div className="text-gray-500">Pot Size</div>
                      <div className="font-semibold">{formatCurrency(b.pot_size)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Base EMI</div>
                      <div className="font-semibold">{formatCurrency(b.base_installment)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Members</div>
                      <div className="font-semibold">{b.member_count}</div>
                    </div>
                  </div>

                  <div className="text-sm text-gray-600 mb-2">
                    Month {summary.months_paid || 0} of {b.tenure_months} paid
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                      <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${paidPct}%` }}></div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Invested: <span className="font-medium text-gray-800">{formatCurrency(summary.total_invested)}</span></span>
                    {scoreBadge(b)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
