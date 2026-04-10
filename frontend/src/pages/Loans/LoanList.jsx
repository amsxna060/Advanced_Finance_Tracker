import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import {
  formatCurrency,
  formatDate,
  getLoanStatusColor,
} from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";

function LoanList() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [tab, setTab] = useState("active"); // "active" | "archived"
  const [filters, setFilters] = useState({
    direction: "",
    type: "",
    contact_id: "",
    search: "",
  });

  // Fetch contacts for filter dropdown
  const { data: contactsData } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const response = await api.get("/api/contacts", {
        params: { limit: 500 },
      });
      return response.data;
    },
  });

  // Fetch ALL loans (active + archived) so tab switch is instant
  const { data: loansData, isLoading } = useQuery({
    queryKey: ["loans", filters],
    queryFn: async () => {
      const params = { limit: 500 };
      if (filters.direction) params.direction = filters.direction;
      if (filters.type) params.loan_type = filters.type;
      if (filters.contact_id) params.contact_id = filters.contact_id;
      const response = await api.get("/api/loans", { params });
      return response.data;
    },
  });

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearFilters = () => {
    setFilters({ direction: "", type: "", contact_id: "", search: "" });
  };

  const ACTIVE_STATUSES = ["active", "on_hold", "defaulted"];

  const filteredLoans =
    (loansData || []).filter((loan) => {
      // Tab filter
      const isArchived = !ACTIVE_STATUSES.includes(loan.status);
      if (tab === "active" && isArchived) return false;
      if (tab === "archived" && !isArchived) return false;

      // Search filter
      if (filters.search) {
        const s = filters.search.toLowerCase();
        const matches =
          (loan.contact?.name || "").toLowerCase().includes(s) ||
          (loan.notes || "").toLowerCase().includes(s) ||
          (loan.institution_name || "").toLowerCase().includes(s) ||
          (loan.loan_type || "").toLowerCase().includes(s) ||
          String(loan.id).includes(s) ||
          String(loan.principal_amount || "").includes(s);
        if (!matches) return false;
      }
      return true;
    });

  const activeCount = (loansData || []).filter((l) =>
    ACTIVE_STATUSES.includes(l.status)
  ).length;
  const archivedCount = (loansData || []).filter(
    (l) => !ACTIVE_STATUSES.includes(l.status)
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate("/dashboard")}
              className="text-gray-600 hover:text-gray-900 mb-3"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Loans</h1>
            <p className="text-gray-600 mt-1">Manage all lending activities</p>
          </div>
          <button
            onClick={() => navigate("/loans/new")}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            + New Loan
          </button>
        </div>

        {/* Active / Archived tabs */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setTab("active")}
            className={`px-5 py-2 rounded-t-lg text-sm font-semibold border-b-2 transition-colors ${
              tab === "active"
                ? "border-blue-600 text-blue-600 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-700 bg-gray-100"
            }`}
          >
            Active
            {activeCount > 0 && (
              <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                {activeCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("archived")}
            className={`px-5 py-2 rounded-t-lg text-sm font-semibold border-b-2 transition-colors ${
              tab === "archived"
                ? "border-gray-600 text-gray-700 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-700 bg-gray-100"
            }`}
          >
            Archived (Closed)
            {archivedCount > 0 && (
              <span className="ml-2 bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                {archivedCount}
              </span>
            )}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search
              </label>
              <input
                type="text"
                placeholder="Contact or notes..."
                value={filters.search}
                onChange={(e) => handleFilterChange("search", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>

            {/* Direction Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Direction
              </label>
              <select
                value={filters.direction}
                onChange={(e) => handleFilterChange("direction", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="">All Directions</option>
                <option value="given">Given (Lent Out)</option>
                <option value="taken">Taken (Borrowed)</option>
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={filters.type}
                onChange={(e) => handleFilterChange("type", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="">All Types</option>
                <option value="interest_only">Interest Only</option>
                <option value="emi">EMI</option>
                <option value="short_term">Short Term</option>
              </select>
            </div>

            {/* Contact Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contact
              </label>
              <select
                value={filters.contact_id}
                onChange={(e) => handleFilterChange("contact_id", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="">All Contacts</option>
                {contactsData?.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex justify-between items-center">
            <button
              onClick={handleClearFilters}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear Filters
            </button>
            <div className="text-sm text-gray-500">
              {filteredLoans.length} loan(s)
            </div>
          </div>
        </div>

        {/* Loans Table */}
        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredLoans.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="text-gray-400 mb-4">
              <svg
                className="mx-auto h-12 w-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {tab === "archived" ? "No archived loans" : "No active loans found"}
            </h3>
            {tab === "active" && (
              <button
                onClick={() => navigate("/loans/new")}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Loan
              </button>
            )}
          </div>
        ) : (
          <div className={`bg-white rounded-lg shadow-sm overflow-hidden ${tab === "archived" ? "opacity-90" : ""}`}>
            {tab === "archived" && (
              <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-500 flex items-center gap-2">
                <span>🗄️</span>
                <span>Showing closed / settled loans</span>
              </div>
            )}
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Direction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Principal
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Interest Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Start Date
                  </th>
                  {tab === "archived" && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Closed Date
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLoans.map((loan) => (
                  <tr
                    key={loan.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/loans/${loan.id}`)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {loan.contact?.name || "Unknown"}
                      </div>
                      <div className="text-sm text-gray-500">
                        {loan.contact?.phone || ""}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          loan.loan_direction === "given"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {loan.loan_direction === "given" ? "↑ Given" : "↓ Taken"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {loan.loan_type === "interest_only"
                        ? "Interest Only"
                        : loan.loan_type === "emi"
                          ? "EMI"
                          : "Short Term"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatCurrency(loan.principal_amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {loan.loan_type === "short_term"
                        ? loan.post_due_interest_rate
                          ? `${parseFloat(loan.post_due_interest_rate).toFixed(2)}% p.a.`
                          : "—"
                        : loan.interest_rate
                          ? `${parseFloat(loan.interest_rate).toFixed(2)}% p.a.`
                          : "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(loan.disbursed_date)}
                    </td>
                    {tab === "archived" && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {loan.actual_end_date ? formatDate(loan.actual_end_date) : "—"}
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getLoanStatusColor(loan.status)}`}
                      >
                        {loan.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/loans/${loan.id}`);
                        }}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default LoanList;
