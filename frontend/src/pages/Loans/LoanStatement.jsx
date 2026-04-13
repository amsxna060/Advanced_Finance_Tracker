import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";

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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-rose-600 font-medium">Failed to load statement.</p>
      </div>
    );
  }

  const loanTypeLabel = {
    interest_only: "Interest Only",
    short_term: "Short Term",
    emi: "EMI",
  };

  const loan = data;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Loan Statement"
        subtitle={`${loan.contact_name || "Unknown"} · #${id}`}
        backTo={`/loans/${id}`}
        actions={
          <Button variant="white" onClick={() => window.print()}>
            🖨️ Print
          </Button>
        }
        compact
      />
      <PageBody>
        {/* Screen-only date filter controls */}
        <div className="print:hidden flex items-center gap-2 mb-6 flex-wrap">
          <label className="text-xs text-slate-500 font-medium">From:</label>
          <input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
          />
          <label className="text-xs text-slate-500 font-medium">To:</label>
          <input
            type="month"
            value={toMonth}
            max={currentMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
          />
          <button
            onClick={() => {
              setFromMonth("");
              setToMonth("");
            }}
            className="px-3 py-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            Clear
          </button>
        </div>

        {/* Statement content */}
        <div className="max-w-4xl mx-auto">
          {/* Generated date */}
          <p className="text-center text-slate-400 text-sm mb-6">
            Generated on {formatDate(new Date().toISOString().split("T")[0])}
          </p>

          {/* Loan Summary */}
          <div className="border border-slate-200/60 rounded-2xl p-5 mb-6 bg-slate-50/50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Borrower
                </div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {data.contact_name}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Loan Amount
                </div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {formatCurrency(data.principal_amount)}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Interest Rate
                </div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {data.interest_rate}% p.a.
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">Type</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {loanTypeLabel[data.loan_type] || data.loan_type}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Disbursed On
                </div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {formatDate(data.disbursed_date)}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">Status</div>
                <div className="font-semibold text-slate-900 capitalize mt-0.5">
                  {data.status}
                </div>
              </div>
            </div>
          </div>

          {/* Current Outstanding */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-rose-50 border border-rose-200/60 rounded-2xl p-4 text-center">
              <div className="text-xs font-medium text-rose-600">
                Principal Outstanding
              </div>
              <div className="text-lg font-bold text-rose-700 mt-1">
                {formatCurrency(data.outstanding.principal)}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 text-center">
              <div className="text-xs font-medium text-amber-700">
                Interest Outstanding
              </div>
              <div className="text-lg font-bold text-amber-800 mt-1">
                {formatCurrency(data.outstanding.interest)}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-300/60 rounded-2xl p-4 text-center">
              <div className="text-xs font-medium text-slate-600">
                Total Outstanding
              </div>
              <div className="text-lg font-bold text-slate-900 mt-1">
                {formatCurrency(data.outstanding.total)}
              </div>
            </div>
          </div>

          {/* Statement Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200/60">
            <table className="w-full text-sm border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">
                    Description
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">
                    Amount
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-slate-100 ${entry.type === "payment" ? "bg-emerald-50/40" : entry.capitalized ? "bg-amber-50/40" : ""}`}
                  >
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                      {entry.type === "interest" ? "" : formatDate(entry.date)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-900">
                      {entry.description}
                      {entry.type === "payment" && (
                        <span className="text-xs text-slate-400 ml-2">
                          (Interest: {formatCurrency(entry.interest_portion)},
                          Principal: {formatCurrency(entry.principal_portion)})
                        </span>
                      )}
                      {entry.capitalized && (
                        <span className="text-xs text-amber-600 ml-2 font-medium">
                          ⚡ Capitalized{" "}
                          {formatCurrency(entry.capitalized_amount)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                      {entry.type === "disbursement" && (
                        <span className="text-slate-900">
                          {formatCurrency(entry.amount)}
                        </span>
                      )}
                      {entry.type === "interest" && (
                        <span className="text-amber-700">
                          {formatCurrency(entry.amount)}
                        </span>
                      )}
                      {entry.type === "payment" && (
                        <span className="text-emerald-700">
                          -{formatCurrency(entry.amount)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {entry.type === "interest" && (
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            entry.status === "paid"
                              ? "bg-emerald-100 text-emerald-700"
                              : entry.status === "partial"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-rose-100 text-rose-700"
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
                        <span className="text-xs text-slate-400 capitalize">
                          {entry.payment_mode || ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.entries.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-10 text-center text-slate-400"
                    >
                      No entries for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-8 pt-4 border-t border-slate-200/60 text-center text-xs text-slate-400 print:mt-12">
            This is a computer-generated statement. For any queries, please
            contact us.
          </div>
        </div>

        {/* Print styles */}
        <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\:hidden { display: none !important; }
          @page { margin: 1cm; }
        }
      `}</style>
      </PageBody>
    </div>
  );
}

export default LoanStatement;
