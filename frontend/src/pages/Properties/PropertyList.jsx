import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

function PropertyList() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    property_type: "",
  });

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ["properties", filters],
    queryFn: async () => {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.property_type) params.property_type = filters.property_type;
      const response = await api.get("/api/properties", { params });
      return response.data;
    },
  });

  const handleFilterChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setFilters({ search: "", status: "", property_type: "" });
  };

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
            <h1 className="text-3xl font-bold text-gray-900">Property Deals</h1>
            <p className="text-gray-600 mt-1">
              Track middleman deals, hold properties, and cashflow.
            </p>
          </div>
          <button
            onClick={() => navigate("/properties/new")}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            + New Property Deal
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange("search", e.target.value)}
              placeholder="Search title or location..."
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange("status", e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Status</option>
              <option value="negotiating">Negotiating</option>
              <option value="advance_given">Advance Given</option>
              <option value="buyer_found">Buyer Found</option>
              <option value="registry_done">Registry Done</option>
              <option value="settled">Settled</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={filters.property_type}
              onChange={(e) =>
                handleFilterChange("property_type", e.target.value)
              }
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Types</option>
              <option value="plot">Plot</option>
              <option value="site">Site</option>
              <option value="flat">Flat</option>
              <option value="commercial">Commercial</option>
              <option value="agricultural">Agricultural</option>
            </select>
            <button
              onClick={clearFilters}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : properties.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-600">
            No property deals found.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {properties.map((property) => (
              <div
                key={property.id}
                onClick={() => navigate(`/properties/${property.id}`)}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      {property.title}
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      {property.location || "No location provided"}
                    </p>
                  </div>
                  <span className="px-3 py-1 text-xs rounded-full bg-blue-50 text-blue-700 capitalize">
                    {property.status.replaceAll("_", " ")}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-6 text-sm">
                  <div>
                    <div className="text-gray-500">Deal Type</div>
                    <div className="font-medium text-gray-900 capitalize">
                      {property.deal_type.replaceAll("_", " ")}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Property Type</div>
                    <div className="font-medium text-gray-900 capitalize">
                      {property.property_type || "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Area</div>
                    <div className="font-medium text-gray-900">
                      {property.total_area_sqft || "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Expected Registry</div>
                    <div className="font-medium text-gray-900">
                      {formatDate(property.expected_registry_date)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Advance Paid</div>
                    <div className="font-medium text-gray-900">
                      {formatCurrency(property.advance_paid)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Net Profit</div>
                    <div className="font-medium text-gray-900">
                      {formatCurrency(property.net_profit)}
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

export default PropertyList;
