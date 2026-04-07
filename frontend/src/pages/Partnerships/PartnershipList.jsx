import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

const STATUS_COLORS = {
  active: "bg-blue-100 text-blue-800",
  settled: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export default function PartnershipList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", status: "" });

  const { data: partnerships = [], isLoading } = useQuery({
    queryKey: ["partnerships", filters],
    queryFn: async () => {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      params.limit = 100;
      const res = await api.get("/api/partnerships", { params });
      return res.data;
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <button onClick={() => navigate("/dashboard")} className="text-gray-500 hover:text-gray-700 text-sm mb-2">
              ← Dashboard
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Partnerships</h1>
            <p className="text-gray-500 text-sm mt-1">Track joint investments and deal partnerships.</p>
          </div>
          <button
            onClick={() => navigate("/partnerships/new")}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
          >
            + New Partnership
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-5 flex flex-wrap gap-3">
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            placeholder="Search partnerships..."
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {(filters.search || filters.status) && (
            <button
              onClick={() => setFilters({ search: "", status: "" })}
              className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200"
            >
              Clear
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : partnerships.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-400 mb-3">No partnerships found.</p>
            <button
              onClick={() => navigate("/partnerships/new")}
              className="text-blue-600 hover:underline text-sm"
            >
              Create your first partnership →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {partnerships.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(`/partnerships/${p.id}`)}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-blue-300 cursor-pointer transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">{p.title}</h2>
                    {p.linked_property_deal_id && (
                      <p className="text-xs text-blue-600 mt-0.5">🏘 Linked to property deal</p>
                    )}
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_COLORS[p.status] || "bg-gray-100 text-gray-700"}`}>
                    {p.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <div className="text-xs text-gray-400">Total Advance</div>
                    <div className="font-medium text-gray-900">{formatCurrency(p.our_investment || 0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Total Received</div>
                    <div className={`font-medium ${parseFloat(p.total_received) > 0 ? "text-green-700" : "text-gray-400"}`}>
                      {formatCurrency(p.total_received || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Partners</div>
                    <div className="font-medium text-gray-900">—</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Created</div>
                    <div className="font-medium text-gray-500 text-xs">{formatDate(p.created_at)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
