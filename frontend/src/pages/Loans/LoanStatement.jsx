import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";

function LoanStatement() {
  const { id } = useParams();
  const navigate = useNavigate();

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["loan-statement", id, fromMonth, toMonth],
    queryFn: async () => {
      const params = {};
      if (fromMonth) params.from_month = fromMonth;
      if (toMonth) params.to_month = toMonth;
      const response = await api.get(`/api/loans/${id}/statement`, { params });
      return response.data;
    },
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600">Failed to load statement.</p>
      </div>
    );
  }

  const loanTypeLabel = {
    interest_only: "Interest Only",
    short_term: "Short Term",
    emi: "EMI",
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Screen-only controls */}
      <div className="print:hidden max-w-4xl mx-auto px-6 pt-6 flex items-center gap-4">
        <button
          onClick={() => navigate(`/loans/${id}`)}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
        >
          ← Back to Loan
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm text-gray-600">From:</label>
          <input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
          <label className="text-sm text-gray-600">To:</label>
          <input
            type="month"
            value={toMonth}
            max={currentMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          />
          <button
            onClick={() => { setFromMonth(""); setToMonth(""); }}
            className="px-3 py-1.5 text-sm text-blue-600 hover:underline"
          >
            Clear
          </button>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          🖨️ Print
        </button>
      </div>

      {/* Statement content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Loan Statement</h1>
          <p className="text-gray-500 mt-1">
            Generated on {formatDate(new Date().toISOString().split("T")[0])}
          </p>
        </div>

        {/* Loan Summary */}
        <div className="border border-gray-200 rounded-lg p-5 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Borrower</div>
              <div className="font-semibold text-gray-900">
                {data.contact_name}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Loan Amount</div>
              <div className="font-semibold text-gray-900">
                {formatCurrency(data.principal_amount)}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Interest Rate</div>
              <div className="font-semibold text-gray-900">
                {data.interest_rate}% p.a.
              </div>
            </div>
            <div>
              <div className="text-gray-500">Type</div>
              <div className="font-semibold text-gray-900">
                {loanTypeLabel[data.loan_type] || data.loan_type}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Disbursed On</div>
              <div className="font-semibold text-gray-900">
                {formatDate(data.disbursed_date)}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Status</div>
              <div className="font-semibold text-gray-900 capitalize">
                {data.status}
              </div>
            </div>
          </div>
        </div>

        {/* Current Outstanding */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <div className="text-sm text-red-600">Principal Outstanding</div>
            <div className="text-lg font-bold text-red-700">
              {formatCurrency(data.outstanding.principal)}
            </div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
            <div className="text-sm text-yellow-700">Interest Outstanding</div>
            <div className="text-lg font-bold text-yellow-800">
              {formatCurrency(data.outstanding.interest)}
            </div>
          </div>
          <div className="bg-gray-50 border border-gray-300 rounded-lg p-4 text-center">
            <div className="text-sm text-gray-600">Total Outstanding</div>
            <div className="text-lg font-bold text-gray-900">
              {formatCurrency(data.outstanding.total)}
            </div>
          </div>
        </div>

        {/* Statement Table */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              <th className="text-left px-3 py-2 font-semibold text-gray-700">
                Date
              </th>
              <th className="text-left px-3 py-2 font-semibold text-gray-700">
                Description
              </th>
              <th className="text-right px-3 py-2 font-semibold text-gray-700">
                Amount
              </th>
              <th className="text-right px-3 py-2 font-semibold text-gray-700">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, idx) => (
              <tr
                key={idx}
                className={`border-b border-gray-100 ${
                  entry.type === "payment"
                    ? "bg-green-50"
                    : entry.capitalized
                      ? "bg-orange-50"
                      : ""
                }`}
              >
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                  {entry.type === "interest"
                    ? ""
                    : formatDate(entry.date)}
                </td>
                <td className="px-3 py-2 text-gray-900">
                  {entry.description}
                  {entry.type === "payment" && (
                    <span className="text-xs text-gray-500 ml-2">
                      (Interest: {formatCurrency(entry.interest_portion)},
                      Principal: {formatCurrency(entry.principal_portion)})
                    </span>
                  )}
                  {entry.capitalized && (
                    <span className="text-xs text-orange-600 ml-2 font-medium">
                      ⚡ Capitalized {formatCurrency(entry.capitalized_amount)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {entry.type === "disbursement" && (
                    <span className="text-gray-900">
                      {formatCurrency(entry.amount)}
                    </span>
                  )}
                  {entry.type === "interest" && (
                    <span className="text-yellow-700">
                      {formatCurrency(entry.amount)}
                    </span>
                  )}
                  {entry.type === "payment" && (
                    <span className="text-green-700">
                      -{formatCurrency(entry.amount)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {entry.type === "interest" && (
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        entry.status === "paid"
                          ? "bg-green-100 text-green-700"
                          : entry.status === "partial"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {entry.status === "paid"
                        ? "Paid"
                        : entry.status === "partial"
                          ? `Partial (${formatCurrency(entry.outstanding)} due)`
                          : `Unpaid (${formatCurrency(entry.outstanding)})`}
                    </span>
                  )}
                  {entry.type === "payment" && (
                    <span className="text-xs text-gray-500 capitalize">
                      {entry.payment_mode || ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                  No entries for the selected period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="mt-8 pt-4 border-t border-gray-200 text-center text-xs text-gray-400 print:mt-12">
          This is a computer-generated statement. For any queries, please
          contact us.
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          @page { margin: 1cm; }
        }
      `}</style>
    </div>
  );
}

export default LoanStatement;
