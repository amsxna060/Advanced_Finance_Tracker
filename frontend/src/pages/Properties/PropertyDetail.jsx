import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const response = await api.get(`/api/properties/${id}`);
      return response.data;
    },
    retry: 2,
  });

  const deletePropertyMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/properties/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      navigate("/properties");
    },
    onError: (err) => {
      alert(err?.response?.data?.detail || "Failed to delete property deal");
    },
  });

  const handleDelete = () => {
    if (window.confirm("Delete this property deal? This cannot be undone.")) {
      deletePropertyMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const property = data?.property;
  if (isError || !property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isError
              ? "Failed to load property deal"
              : "Property deal not found"}
          </h2>
          <button
            onClick={() => navigate("/properties")}
            className="text-blue-600 hover:text-blue-800"
          >
            Back to Property Deals
          </button>
        </div>
      </div>
    );
  }

  const summary = data.summary || {};
  const partnerships = data.partnerships || [];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <button
              onClick={() => navigate("/properties")}
              className="text-gray-600 hover:text-gray-900 mb-3"
            >
              ← Back to Property Deals
            </button>
            <h1 className="text-3xl font-bold text-gray-900">
              {property.title}
            </h1>
            <p className="text-gray-600 mt-1">
              {property.location || "No location provided"}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/properties/${id}/edit`)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Edit Deal
            </button>
            <button
              onClick={handleDelete}
              disabled={deletePropertyMutation.isPending}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
            >
              🗑️ Delete
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Gross Profit</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(summary.gross_profit)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Net Profit</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(summary.net_profit)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Advance Paid</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(property.advance_paid)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Status</div>
            <div className="text-2xl font-bold text-gray-900 mt-1 capitalize">
              {property.status.replaceAll("_", " ")}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Deal Details */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Deal Details
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">Deal Type</div>
                  <div className="font-medium capitalize">
                    {property.deal_type.replaceAll("_", " ")}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Property Type</div>
                  <div className="font-medium capitalize">
                    {property.property_type || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Area (sqft)</div>
                  <div className="font-medium">
                    {property.total_area_sqft || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Advance Paid</div>
                  <div className="font-medium">
                    {formatCurrency(property.advance_paid)}
                  </div>
                </div>
                {property.deal_type === "middleman" && (
                  <>
                    <div>
                      <div className="text-gray-500">Seller Rate/sqft</div>
                      <div className="font-medium">
                        {property.seller_rate_per_sqft
                          ? formatCurrency(property.seller_rate_per_sqft)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Total Seller Value</div>
                      <div className="font-medium">
                        {property.total_seller_value
                          ? formatCurrency(property.total_seller_value)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Buyer Rate/sqft</div>
                      <div className="font-medium">
                        {property.buyer_rate_per_sqft
                          ? formatCurrency(property.buyer_rate_per_sqft)
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Total Buyer Value</div>
                      <div className="font-medium">
                        {property.total_buyer_value
                          ? formatCurrency(property.total_buyer_value)
                          : "-"}
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <div className="text-gray-500">Broker Commission</div>
                  <div className="font-medium">
                    {formatCurrency(property.broker_commission)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Expected Registry</div>
                  <div className="font-medium">
                    {formatDate(property.expected_registry_date)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Actual Registry</div>
                  <div className="font-medium">
                    {formatDate(property.actual_registry_date)}
                  </div>
                </div>
              </div>
              {property.notes && (
                <p className="text-sm text-gray-700 mt-4 pt-4 border-t border-gray-200">
                  {property.notes}
                </p>
              )}
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* People */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                People
              </h2>
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-gray-500">Seller</div>
                  <div className="font-medium">{data.seller?.name || "-"}</div>
                </div>
                <div>
                  <div className="text-gray-500">Buyer</div>
                  <div className="font-medium">{data.buyer?.name || "-"}</div>
                </div>
              </div>
            </div>

            {/* Linked Partnerships */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Linked Partnerships
                </h2>
                <button
                  onClick={() => navigate("/partnerships/new")}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Add
                </button>
              </div>
              {partnerships.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No linked partnerships yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {partnerships.map((partnership) => (
                    <button
                      key={partnership.id}
                      onClick={() =>
                        navigate(`/partnerships/${partnership.id}`)
                      }
                      className="w-full text-left border border-gray-200 rounded-lg p-3 hover:bg-gray-50"
                    >
                      <div className="font-medium text-gray-900">
                        {partnership.title}
                      </div>
                      <div className="text-sm text-gray-500 capitalize">
                        {partnership.status}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PropertyDetail;
