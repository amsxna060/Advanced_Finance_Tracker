import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

function PartnershipList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", status: "" });

  const { data: partnerships = [], isLoading } = useQuery({
    queryKey: ["partnerships", filters],
    queryFn: async () => {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      const response = await api.get("/api/partnerships", { params });
      return response.data;
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate("/dashboard")}
              className="text-gray-600 hover:text-gray-900 mb-3"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Partnerships</h1>
            <p className="text-gray-600 mt-1">
              Track joint investments and settlements.
            </p>
          </div>
          <button
            onClick={() => navigate("/partnerships/new")}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + New Partnership
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            value={filters.search}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, search: e.target.value }))
            }
            placeholder="Search title or notes..."
            className="px-4 py-2 border border-gray-300 rounded-lg"
          />
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, status: e.target.value }))
            }
            className="px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            onClick={() => setFilters({ search: "", status: "" })}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Clear Filters
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : partnerships.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-600">
            No partnerships found.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {partnerships.map((partnership) => (
              <div
                key={partnership.id}
                onClick={() => navigate(`/partnerships/${partnership.id}`)}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      {partnership.title}
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Start: {formatDate(partnership.start_date)}
                    </p>
                  </div>
                  <span className="px-3 py-1 text-xs rounded-full bg-orange-50 text-orange-700 capitalize">
                    {partnership.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-6 text-sm">
                  <div>
                    <div className="text-gray-500">Our Investment</div>
                    <div className="font-medium text-gray-900">
                      {formatCurrency(partnership.our_investment)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Total Received</div>
                    <div className="font-medium text-gray-900">
                      {formatCurrency(partnership.total_received)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Share %</div>
                    <div className="font-medium text-gray-900">
                      {partnership.our_share_percentage || "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Expected End</div>
                    <div className="font-medium text-gray-900">
                      {formatDate(partnership.expected_end_date)}
                    </div>
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

export default PartnershipList;
