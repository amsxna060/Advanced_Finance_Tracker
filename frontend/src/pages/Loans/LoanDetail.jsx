import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import {
  formatCurrency,
  formatDate,
  getLoanStatusColor,
} from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";

function LoanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentPreview, setPaymentPreview] = useState(null);

  const [showCollateralModal, setShowCollateralModal] = useState(false);
  const [collateralForm, setCollateralForm] = useState({
    collateral_type: "property",
    description: "",
    estimated_value: "",
    gold_carat: "",
    gold_weight_grams: "",
    gold_manual_rate: "",
    notes: "",
  });

  // Fetch loan details
  const {
    data: loanData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["loan", id],
    queryFn: async () => {
      const response = await api.get(`/api/loans/${id}`);
      return response.data;
    },
    staleTime: 0,
    gcTime: 0,
    retry: 2,
  });

  const loan = loanData?.loan;
  const contact = loanData?.contact;
  const outstanding = loanData?.outstanding;
  const payments = loanData?.payments || [];
  const collaterals = loanData?.collaterals || [];
  const emiSchedule = loanData?.emi_schedule || [];
  const emiInterestSummary = loanData?.emi_interest_summary || null;

  // Monthly interest schedule (lazy-loaded)
  const [showMonthlySchedule, setShowMonthlySchedule] = useState(false);
  const { data: monthlyScheduleData, isLoading: monthlyScheduleLoading } = useQuery({
    queryKey: ["loan-monthly-schedule", id],
    queryFn: async () => {
      const response = await api.get(`/api/loans/${id}/monthly-interest-schedule`);
      return response.data;
    },
    enabled: showMonthlySchedule,
    staleTime: 0,
  });

  // Fetch payment preview
  const fetchPreview = async (amount) => {
    if (!amount || parseFloat(amount) <= 0) {
      setPaymentPreview(null);
      return;
    }
    try {
      const response = await api.get(`/api/loans/${id}/payment-preview`, {
        params: { amount: parseFloat(amount), payment_date: paymentDate },
      });
      setPaymentPreview(response.data);
    } catch (error) {
      console.error("Failed to fetch preview:", error);
      setPaymentPreview(null);
    }
  };

  // Record payment
  const recordPaymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      const response = await api.post(`/api/loans/${id}/payments`, paymentData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      setShowPaymentModal(false);
      setPaymentAmount("");
      setPaymentNotes("");
      setPaymentPreview(null);
    },
  });

  // Delete payment
  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId) => {
      await api.delete(`/api/loans/${id}/payments/${paymentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
  });

  // Delete loan
  const deleteLoanMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/loans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      navigate("/loans");
    },
  });

  // Add collateral
  const addCollateralMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await api.post(`/api/loans/${id}/collaterals`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
      setShowCollateralModal(false);
      setCollateralForm({
        collateral_type: "property",
        description: "",
        estimated_value: "",
        gold_carat: "",
        gold_weight_grams: "",
        gold_manual_rate: "",
        notes: "",
      });
    },
  });

  // Delete collateral
  const deleteCollateralMutation = useMutation({
    mutationFn: async (collateralId) => {
      await api.delete(`/api/collaterals/${collateralId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
    },
  });

  // Capitalize interest
  const capitalizeMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/api/loans/${id}/capitalize`, {
        event_date: new Date().toISOString().split("T")[0],
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
    },
  });

  // Mark as Closed
  const markClosedMutation = useMutation({
    mutationFn: async () => {
      const response = await api.put(`/api/loans/${id}`, {
        status: "closed",
        actual_end_date: new Date().toISOString().split("T")[0],
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
  });

  const handlePaymentAmountChange = (value) => {
    setPaymentAmount(value);
    fetchPreview(value);
  };

  const handleRecordPayment = () => {
    recordPaymentMutation.mutate({
      amount_paid: parseFloat(paymentAmount),
      payment_date: paymentDate,
      payment_mode: paymentMode,
      notes: paymentNotes,
    });
  };

  const handleDeletePayment = (paymentId) => {
    if (window.confirm("Delete this payment record? This cannot be undone.")) {
      deletePaymentMutation.mutate(paymentId);
    }
  };

  const handleDeleteLoan = () => {
    if (window.confirm("Are you sure you want to delete this loan? This action cannot be undone.")) {
      deleteLoanMutation.mutate();
    }
  };

  const handleMarkClosed = () => {
    if (window.confirm("Are you sure you want to mark this loan as closed?")) {
      markClosedMutation.mutate();
    }
  };

  const handleAddCollateral = () => {
    const payload = {
      loan_id: parseInt(id),
      collateral_type: collateralForm.collateral_type,
      description: collateralForm.description || null,
      notes: collateralForm.notes || null,
    };
    if (collateralForm.collateral_type === "gold") {
      payload.gold_carat = parseInt(collateralForm.gold_carat);
      payload.gold_weight_grams = parseFloat(collateralForm.gold_weight_grams);
      payload.gold_use_manual_rate = true;
      payload.gold_manual_rate = parseFloat(collateralForm.gold_manual_rate);
    } else {
      payload.estimated_value = parseFloat(collateralForm.estimated_value);
    }
    addCollateralMutation.mutate(payload);
  };

  const handleDeleteCollateral = (collateralId) => {
    if (window.confirm("Remove this collateral?")) {
      deleteCollateralMutation.mutate(collateralId);
    }
  };

  const handleCapitalize = () => {
    if (
      window.confirm(
        "Capitalize outstanding interest? This adds it to the principal.",
      )
    ) {
      capitalizeMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!loan || isError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            {isError ? "Failed to load loan" : "Loan Not Found"}
          </h2>
          <button
            onClick={() => navigate("/loans")}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Loans
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate("/loans")}
            className="text-gray-600 hover:text-gray-900 mb-4 flex items-center"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Loans
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Loan Details</h1>
              <p className="text-gray-600 mt-1">
                {contact?.name} •{" "}
                {loan.loan_direction === "given" ? "Lent Out" : "Borrowed"}
              </p>
            </div>
            <span
              className={`px-4 py-2 text-sm font-semibold rounded-full ${getLoanStatusColor(loan.status)}`}
            >
              {loan.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Outstanding Balance */}
            {outstanding && (
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
                <h2 className="text-lg font-semibold mb-4">
                  Outstanding Balance
                </h2>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm opacity-90">Principal</div>
                    <div className="text-2xl font-bold">
                      {formatCurrency(outstanding.principal_outstanding)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm opacity-90">
                      {loan.loan_type === "emi" ? "Total Interest" : "Interest"}
                    </div>
                    <div className="text-2xl font-bold">
                      {formatCurrency(
                        loan.loan_type === "emi" && emiInterestSummary
                          ? emiInterestSummary.total_interest_embedded
                          : outstanding.interest_outstanding
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm opacity-90">Total Due</div>
                    <div className="text-3xl font-bold">
                      {formatCurrency(outstanding.total_outstanding)}
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-sm opacity-90">
                  As of {formatDate(outstanding.as_of_date)}
                </div>
              </div>
            )}

            {/* Loan Information */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Loan Information
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Principal Amount</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {formatCurrency(loan.principal_amount)}
                  </div>
                </div>
                {loan.loan_type !== "short_term" && loan.interest_rate && (
                  <div>
                    <div className="text-sm text-gray-600">Interest Rate</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {loan.interest_rate}% p.a.
                    </div>
                  </div>
                )}
                {loan.loan_type === "short_term" && (
                  <div>
                    <div className="text-sm text-gray-600">Post-Due Rate</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {loan.post_due_interest_rate
                        ? `${loan.post_due_interest_rate}% p.a.`
                        : "—"}
                    </div>
                    {loan.interest_free_till && (() => {
                      const today = new Date();
                      const freeTill = new Date(loan.interest_free_till);
                      const isActive = today > freeTill;
                      const daysLeft = Math.ceil((freeTill - today) / (1000 * 60 * 60 * 24));
                      if (isActive) {
                        return (
                          <span className="inline-block mt-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                            ⚠️ Interest Active
                          </span>
                        );
                      }
                      return (
                        <span className="inline-block mt-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                          ✅ Interest-Free Period ({daysLeft} days left)
                        </span>
                      );
                    })()}
                  </div>
                )}
                <div>
                  <div className="text-sm text-gray-600">Loan Type</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {loan.loan_type === "interest_only"
                      ? "Interest Only"
                      : loan.loan_type === "emi"
                        ? "EMI"
                        : "Short Term"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Direction</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {loan.loan_direction === "given"
                      ? "↑ Given (Lent Out)"
                      : "↓ Taken (Borrowed)"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Start Date</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {formatDate(loan.disbursed_date)}
                  </div>
                </div>
                {loan.expected_end_date && (
                  <div>
                    <div className="text-sm text-gray-600">Maturity Date</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {formatDate(loan.expected_end_date)}
                    </div>
                  </div>
                )}
                {loan.emi_amount && (
                  <div>
                    <div className="text-sm text-gray-600">EMI Amount</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {formatCurrency(loan.emi_amount)}
                    </div>
                  </div>
                )}
                {loan.tenure_months && (
                  <div>
                    <div className="text-sm text-gray-600">Tenure</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {loan.tenure_months} months
                    </div>
                  </div>
                )}
                {loan.interest_free_till && (
                  <div>
                    <div className="text-sm text-gray-600">Interest Free Till</div>
                    <div className="text-lg font-semibold text-gray-900">
                      {formatDate(loan.interest_free_till)}
                    </div>
                  </div>
                )}
              </div>
              {/* EMI Interest Summary */}
              {loan.loan_type === "emi" && emiInterestSummary && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-sm font-medium text-gray-700 mb-2">EMI Interest Summary</div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-blue-50 rounded-lg p-3">
                      <div className="text-gray-500">Total Repayment</div>
                      <div className="font-semibold text-gray-900">{formatCurrency(emiInterestSummary.total_repayment)}</div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3">
                      <div className="text-gray-500">Total Interest</div>
                      <div className="font-semibold text-gray-900">{formatCurrency(emiInterestSummary.total_interest_embedded)}</div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3">
                      <div className="text-gray-500">Effective Rate</div>
                      <div className="font-semibold text-gray-900">~{emiInterestSummary.effective_annual_rate_pct}% p.a.</div>
                    </div>
                  </div>
                </div>
              )}
              {loan.notes && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-sm text-gray-600">Notes</div>
                  <div className="text-gray-900 mt-1">{loan.notes}</div>
                </div>
              )}
            </div>

            {/* EMI Schedule */}
            {loan.loan_type === "emi" && emiSchedule.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  EMI Schedule
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    {emiSchedule.filter((e) => e.status === "paid").length}/
                    {emiSchedule.length} paid
                  </span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Due Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          EMI Due
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Outstanding
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {emiSchedule.map((entry) => (
                        <tr
                          key={entry.emi_number}
                          className={
                            entry.status === "paid"
                              ? "bg-green-50"
                              : entry.is_current_month
                                ? "bg-yellow-50"
                                : ""
                          }
                        >

                          <td className={`px-4 py-3 text-sm ${entry.status === "paid" ? "line-through text-gray-400" : "text-gray-900"}`}>
                            {entry.emi_number}
                          </td>
                          <td className={`px-4 py-3 text-sm ${entry.status === "paid" ? "line-through text-gray-400" : "text-gray-900"}`}>
                            {formatDate(entry.due_date)}
                          </td>
                          <td className={`px-4 py-3 text-sm font-semibold ${entry.status === "paid" ? "line-through text-gray-400" : "text-gray-900"}`}>
                            {formatCurrency(entry.due_amount)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {entry.outstanding > 0 ? formatCurrency(entry.outstanding) : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {entry.status === "paid" ? (
                              <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                ✓ Paid
                              </span>
                            ) : entry.status === "partial" ? (
                              <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                                ⚡ Partial
                              </span>
                            ) : entry.status === "future" ? (
                              <span className="px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                                Future
                              </span>
                            ) : (
                              <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                                ✗ Unpaid
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Payment History */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Payment History
              </h2>
              {payments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Principal
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Interest
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Mode
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Notes
                        </th>
                        {user?.role === "admin" && (
                          <th className="px-4 py-3"></th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {formatDate(payment.payment_date)}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                            {formatCurrency(payment.amount_paid)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {formatCurrency(payment.allocated_to_principal)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {formatCurrency(
                              parseFloat(
                                payment.allocated_to_current_interest || 0,
                              ) +
                                parseFloat(
                                  payment.allocated_to_overdue_interest || 0,
                                ),
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 capitalize">
                            {payment.payment_mode || "-"}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {payment.notes || "-"}
                          </td>
                          {user?.role === "admin" && (
                            <td className="px-4 py-3 text-sm">
                              <button
                                onClick={() => handleDeletePayment(payment.id)}
                                className="text-red-500 hover:text-red-700"
                                title="Delete payment"
                              >
                                🗑️
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  No payments recorded yet
                </p>
              )}
            </div>

            {/* Collaterals */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Collaterals
                </h2>
                {user?.role === "admin" && (
                  <button
                    onClick={() => setShowCollateralModal(true)}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    + Add Collateral
                  </button>
                )}
              </div>
              {collaterals.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  No collaterals recorded
                </p>
              ) : (
                <div className="space-y-3">
                  {collaterals.map((collateral) => (
                    <div
                      key={collateral.id}
                      className="border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-gray-900 capitalize">
                            {collateral.collateral_type}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {collateral.description}
                          </div>
                          {collateral.collateral_type === "gold" && (
                            <div className="text-sm text-gray-600 mt-2">
                              {collateral.gold_weight_grams}g •{" "}
                              {collateral.gold_carat}K
                            </div>
                          )}
                          {collateral.notes && (
                            <div className="text-sm text-gray-500 mt-1">
                              {collateral.notes}
                            </div>
                          )}
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="text-right">
                            <div className="text-sm text-gray-600">
                              Estimated Value
                            </div>
                            <div className="text-lg font-semibold text-gray-900">
                              {formatCurrency(collateral.estimated_value)}
                            </div>
                          </div>
                          {user?.role === "admin" && (
                            <button
                              onClick={() =>
                                handleDeleteCollateral(collateral.id)
                              }
                              className="text-red-400 hover:text-red-600 mt-1"
                              title="Remove collateral"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Monthly Interest / EMI Schedule */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  {loan.loan_type === "emi" ? "Monthly EMI Tracking" : "Monthly Interest Schedule"}
                </h2>
                <button
                  onClick={() => setShowMonthlySchedule((prev) => !prev)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {showMonthlySchedule ? "Hide" : "Show"}
                </button>
              </div>
              {showMonthlySchedule && (
                monthlyScheduleLoading ? (
                  <div className="text-gray-500 text-center py-4">Loading schedule...</div>
                ) : monthlyScheduleData?.schedule?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            {loan.loan_type === "emi" ? "EMI Due" : "Interest Due"}
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Paid</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Outstanding</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {monthlyScheduleData.schedule.map((entry, idx) => (
                          <tr
                            key={idx}
                            className={
                              entry.status === "paid"
                                ? "bg-green-50"
                                : entry.is_current_month
                                  ? "bg-yellow-50"
                                  : ""
                            }
                          >
                            <td className={`px-4 py-2 font-medium ${entry.status === "paid" ? "line-through text-gray-400" : "text-gray-900"}`}>{entry.month_label}</td>
                            <td className={`px-4 py-2 text-right ${entry.status === "paid" ? "line-through text-gray-400" : "text-gray-700"}`}>
                              {entry.interest_due > 0 ? formatCurrency(entry.interest_due) : "—"}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-700">
                              {entry.interest_paid > 0 ? formatCurrency(entry.interest_paid) : "—"}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-700">
                              {entry.interest_outstanding > 0 ? formatCurrency(entry.interest_outstanding) : "—"}
                            </td>
                            <td className="px-4 py-2">
                              {entry.status === "paid" ? (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">🟢 Paid</span>
                              ) : entry.status === "partial" ? (
                                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs">🟡 Partial</span>
                              ) : entry.status === "future" ? (
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs">⚪ Future</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">🔴 Unpaid</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No schedule available yet</p>
                )
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Quick Actions
              </h2>
              <div className="space-y-3">
                {loan.status === "active" && (
                  <button
                    onClick={() => setShowPaymentModal(true)}
                    className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                  >
                    💵 Record Payment
                  </button>
                )}
                <button
                  onClick={() => navigate(`/loans/${id}/edit`)}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  ✏️ Edit Loan
                </button>
                {user?.role === "admin" &&
                  loan.status === "active" &&
                  outstanding?.interest_outstanding > 0 && (
                    <button
                      onClick={handleCapitalize}
                      disabled={capitalizeMutation.isPending}
                      className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium disabled:opacity-50"
                    >
                      {capitalizeMutation.isPending
                        ? "Processing..."
                        : "🔄 Capitalize Interest"}
                    </button>
                  )}
                <button
                  onClick={() => navigate(`/contacts/${loan.contact_id}`)}
                  className="w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
                >
                  👤 View Contact
                </button>
                {user?.role === "admin" && loan.status === "active" && (
                  <button
                    onClick={handleMarkClosed}
                    disabled={markClosedMutation.isPending}
                    className="w-full px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium disabled:opacity-50"
                  >
                    {markClosedMutation.isPending ? "Closing..." : "✅ Mark as Closed"}
                  </button>
                )}
                {user?.role === "admin" && (
                  <button
                    onClick={handleDeleteLoan}
                    disabled={deleteLoanMutation.isPending}
                    className="w-full px-4 py-3 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium disabled:opacity-50"
                  >
                    🗑️ Delete Loan
                  </button>
                )}
              </div>
            </div>

            {/* Contact Info */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Contact Details
              </h2>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Name</div>
                  <div className="font-medium text-gray-900">
                    {contact?.name || loan.contact?.name}
                  </div>
                </div>
                {(contact?.phone || loan.contact?.phone) && (
                  <div>
                    <div className="text-sm text-gray-600">Phone</div>
                    <div className="font-medium text-gray-900">
                      {contact?.phone || loan.contact?.phone}
                    </div>
                  </div>
                )}
                {(contact?.city || loan.contact?.city) && (
                  <div>
                    <div className="text-sm text-gray-600">City</div>
                    <div className="font-medium text-gray-900">
                      {contact?.city || loan.contact?.city}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Record Payment
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Amount *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => handlePaymentAmountChange(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Date *
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => {
                    setPaymentDate(e.target.value);
                    if (paymentAmount) fetchPreview(paymentAmount);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Mode
                </label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  rows="2"
                  placeholder="Notes..."
                />
              </div>
              {paymentPreview && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-2">
                    Payment Allocation Preview
                  </h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Overdue Interest:</span>
                      <span className="font-medium">
                        {formatCurrency(
                          paymentPreview.allocated_to_overdue_interest,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Current Interest:</span>
                      <span className="font-medium">
                        {formatCurrency(
                          paymentPreview.allocated_to_current_interest,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Principal:</span>
                      <span className="font-medium">
                        {formatCurrency(paymentPreview.allocated_to_principal)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-blue-300">
                      <span className="font-semibold">Total:</span>
                      <span className="font-semibold">
                        {formatCurrency(paymentPreview.amount)}
                      </span>
                    </div>
                    {paymentPreview.unallocated > 0 && (
                      <div className="flex justify-between text-orange-600">
                        <span>Excess Amount:</span>
                        <span className="font-medium">
                          {formatCurrency(paymentPreview.unallocated)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowPaymentModal(false);
                  setPaymentAmount("");
                  setPaymentNotes("");
                  setPaymentPreview(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordPayment}
                disabled={
                  !paymentAmount ||
                  parseFloat(paymentAmount) <= 0 ||
                  recordPaymentMutation.isPending
                }
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {recordPaymentMutation.isPending
                  ? "Recording..."
                  : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Collateral Modal */}
      {showCollateralModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Add Collateral
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={collateralForm.collateral_type}
                  onChange={(e) =>
                    setCollateralForm((p) => ({
                      ...p,
                      collateral_type: e.target.value,
                    }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="property">Property</option>
                  <option value="gold">Gold</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="fd">Fixed Deposit</option>
                  <option value="shares">Shares</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Plot at MG Road, Gold necklace"
                  value={collateralForm.description}
                  onChange={(e) =>
                    setCollateralForm((p) => ({
                      ...p,
                      description: e.target.value,
                    }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              {collateralForm.collateral_type === "gold" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Carat (K)
                      </label>
                      <select
                        value={collateralForm.gold_carat}
                        onChange={(e) =>
                          setCollateralForm((p) => ({
                            ...p,
                            gold_carat: e.target.value,
                          }))
                        }
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="">Select</option>
                        <option value="24">24K</option>
                        <option value="22">22K</option>
                        <option value="18">18K</option>
                        <option value="14">14K</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Weight (grams)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={collateralForm.gold_weight_grams}
                        onChange={(e) =>
                          setCollateralForm((p) => ({
                            ...p,
                            gold_weight_grams: e.target.value,
                          }))
                        }
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Value (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Estimated value"
                      value={collateralForm.gold_manual_rate}
                      onChange={(e) =>
                        setCollateralForm((p) => ({
                          ...p,
                          gold_manual_rate: e.target.value,
                        }))
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Estimated Value (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={collateralForm.estimated_value}
                    onChange={(e) =>
                      setCollateralForm((p) => ({
                        ...p,
                        estimated_value: e.target.value,
                      }))
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="Notes..."
                  value={collateralForm.notes}
                  onChange={(e) =>
                    setCollateralForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCollateralModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCollateral}
                disabled={addCollateralMutation.isPending}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {addCollateralMutation.isPending
                  ? "Saving..."
                  : "Add Collateral"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoanDetail;
