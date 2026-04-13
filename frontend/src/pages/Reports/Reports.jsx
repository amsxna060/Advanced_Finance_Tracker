import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import api from "../../lib/api";
import { GreyedOut } from "../../components/ui";

export default function Reports() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);

  // Report form states
  const [loanId, setLoanId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [format, setFormat] = useState("pdf");

  const reportTypes = [
    {
      id: "loan-statement",
      title: "Loan Statement",
      description:
        "Comprehensive statement for a specific loan with payment history",
      icon: "📄",
      requiresLoanId: true,
    },
    {
      id: "portfolio-summary",
      title: "Portfolio Summary",
      description:
        "Complete overview of all investments, loans, properties, and partnerships",
      icon: "📊",
      requiresLoanId: false,
    },
    {
      id: "profit-loss",
      title: "Profit & Loss Statement",
      description: "Income vs expenses report for a specific period",
      icon: "💰",
      requiresDateRange: true,
    },
  ];

  const handleDownloadReport = async (reportType) => {
    if (reportType === "loan-statement" && !loanId) {
      alert("Please enter a Loan ID");
      return;
    }

    if (reportType === "profit-loss" && (!startDate || !endDate)) {
      alert("Please select date range");
      return;
    }

    setLoading(true);
    try {
      let url = "";
      let params = { format };

      switch (reportType) {
        case "loan-statement":
          url = `/api/reports/loan-statement/${loanId}`;
          break;
        case "portfolio-summary":
          url = "/api/reports/portfolio-summary";
          break;
        case "profit-loss":
          url = "/api/reports/profit-loss";
          params = { ...params, start_date: startDate, end_date: endDate };
          break;
        default:
          return;
      }

      const response = await api.get(url, {
        params,
        responseType: "blob",
      });

      // Create download link
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;

      const extension = format === "pdf" ? "pdf" : "xlsx";
      link.download = `${reportType}_${new Date().toISOString().split("T")[0]}.${extension}`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      // Reset form
      setSelectedReport(null);
      setLoanId("");
      setStartDate("");
      setEndDate("");
    } catch (error) {
      console.error("Error downloading report:", error);
      alert("Failed to download report. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <GreyedOut label="Under Review">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-2">
            Generate and download comprehensive financial reports in PDF or
            Excel format
          </p>
        </div>

        {/* Report Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {reportTypes.map((report) => (
            <button
              key={report.id}
              onClick={() => setSelectedReport(report.id)}
              className={`p-6 border-2 rounded-lg text-left transition-all hover:shadow-lg ${
                selectedReport === report.id
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200 hover:border-blue-400"
              }`}
            >
              <div className="text-4xl mb-3">{report.icon}</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {report.title}
              </h3>
              <p className="text-sm text-gray-600">{report.description}</p>
            </button>
          ))}
        </div>

        {/* Report Generation Form */}
        {selectedReport && (
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold mb-6">
              Generate {reportTypes.find((r) => r.id === selectedReport)?.title}
            </h2>

            <div className="space-y-4">
              {/* Loan ID Input */}
              {selectedReport === "loan-statement" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Loan ID *
                  </label>
                  <input
                    type="number"
                    value={loanId}
                    onChange={(e) => setLoanId(e.target.value)}
                    placeholder="Enter loan ID"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    You can find loan IDs on the Loans page
                  </p>
                </div>
              )}

              {/* Date Range Inputs */}
              {selectedReport === "profit-loss" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date *
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date *
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </>
              )}

              {/* Format Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Format *
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="pdf"
                      checked={format === "pdf"}
                      onChange={(e) => setFormat(e.target.value)}
                      className="mr-2"
                    />
                    <span className="text-sm">PDF (Recommended)</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="excel"
                      checked={format === "excel"}
                      onChange={(e) => setFormat(e.target.value)}
                      className="mr-2"
                    />
                    <span className="text-sm">Excel (.xlsx)</span>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => handleDownloadReport(selectedReport)}
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <svg
                        className="animate-spin h-5 w-5 mr-3"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Generating...
                    </span>
                  ) : (
                    `Download ${format.toUpperCase()}`
                  )}
                </button>
                <button
                  onClick={() => {
                    setSelectedReport(null);
                    setLoanId("");
                    setStartDate("");
                    setEndDate("");
                  }}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick Export Section */}
        <div className="mt-12 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Quick Data Exports</h3>
          <p className="text-sm text-gray-600 mb-4">
            Export raw data from the Dashboard page using the export buttons.
            Available datasets:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4 border">
              <div className="font-medium mb-1">Dashboard Summary</div>
              <div className="text-xs text-gray-500">Portfolio metrics CSV</div>
            </div>
            <div className="bg-white rounded-lg p-4 border">
              <div className="font-medium mb-1">Cashflow Data</div>
              <div className="text-xs text-gray-500">6-month cashflow CSV</div>
            </div>
            <div className="bg-white rounded-lg p-4 border">
              <div className="font-medium mb-1">Expense Records</div>
              <div className="text-xs text-gray-500">All expenses CSV</div>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-blue-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                Report Generation Tips
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    PDF format is recommended for professional presentations
                  </li>
                  <li>
                    Excel format allows further data manipulation and analysis
                  </li>
                  <li>
                    Portfolio summary includes all active investments and loans
                  </li>
                  <li>
                    P&L reports help track monthly/quarterly profitability
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </GreyedOut>
  );
}
