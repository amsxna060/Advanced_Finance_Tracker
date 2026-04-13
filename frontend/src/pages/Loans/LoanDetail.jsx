import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import {
  formatCurrency,
  formatDate,
} from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";
import { Edit } from "lucide-react";

function LoanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  // For EMI: single total amount field
  // For interest_only / short_term: auto-split (single field) or manual (two fields)
  const [paymentAmount, setPaymentAmount] = useState(""); // EMI total or auto-split total
  const [interestPaymentAmount, setInterestPaymentAmount] = useState(""); // non-EMI manual interest portion
  const [principalRepaymentAmount, setPrincipalRepaymentAmount] = useState(""); // non-EMI manual principal portion
  const [autoSplit, setAutoSplit] = useState(true); // auto-split: interest first, rest to principal
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentPreview, setPaymentPreview] = useState(null);
  const [paymentAccountId, setPaymentAccountId] = useState("");

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
  const { data: monthlyScheduleData, isLoading: monthlyScheduleLoading } =
    useQuery({
      queryKey: ["loan-monthly-schedule", id],
      queryFn: async () => {
        const response = await api.get(
          `/api/loans/${id}/monthly-interest-schedule`,
        );
        return response.data;
      },
      enabled: showMonthlySchedule,
      staleTime: 0,
    });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", "for-form"],
    queryFn: async () => {
      const res = await api.get("/api/accounts");
      return res.data;
    },
  });

  // Fetch payment preview
  const fetchPreview = async (totalAmt, prAmt, isAutoSplit = false) => {
    const total = parseFloat(totalAmt);
    if (!totalAmt || isNaN(total) || total <= 0) {
      setPaymentPreview(null);
      return;
    }
    try {
      const params = { amount: total, payment_date: paymentDate };
      const pr = parseFloat(prAmt);
      if (!isNaN(pr) && pr > 0) params.principal_repayment = pr;
      if (isAutoSplit) params.auto_split = true;
      const response = await api.get(`/api/loans/${id}/payment-preview`, {
        params,
      });
      setPaymentPreview(response.data);
    } catch (error) {
      console.error("Failed to fetch preview:", error);
      setPaymentPreview(null);
    }
  };

  // Compute total for non-EMI from the two sub-fields
  const nonEmiTotal = () => {
    const i = parseFloat(interestPaymentAmount) || 0;
    const p = parseFloat(principalRepaymentAmount) || 0;
    return i + p > 0 ? (i + p).toFixed(2) : "";
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
      queryClient.invalidateQueries({
        queryKey: ["loan-monthly-schedule", id],
      });
      resetPaymentModal();
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
      queryClient.invalidateQueries({
        queryKey: ["loan-monthly-schedule", id],
      });
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

  // Mark as Closed — calls force-close to fix any wrong allocations before closing
  const markClosedMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/api/loans/${id}/force-close`, {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
  });

  const handlePaymentAmountChange = (value) => {
    setPaymentAmount(value);
    fetchPreview(value, null, autoSplit);
  };

  const handleRecordPayment = () => {
    const isEmi = loan?.loan_type === "emi";
    const useAutoSplit = !isEmi && autoSplit;
    const total =
      isEmi || useAutoSplit
        ? parseFloat(paymentAmount)
        : parseFloat(nonEmiTotal());
    if (!total || total <= 0) return;
    const payload = {
      amount_paid: total,
      payment_date: paymentDate,
      payment_mode: paymentMode,
      notes: paymentNotes,
      account_id: paymentAccountId ? parseInt(paymentAccountId) : null,
      auto_split: useAutoSplit,
    };
    if (!isEmi && !useAutoSplit && parseFloat(principalRepaymentAmount) > 0) {
      payload.principal_repayment = parseFloat(principalRepaymentAmount);
    }
    recordPaymentMutation.mutate(payload);
  };

  const resetPaymentModal = () => {
    setShowPaymentModal(false);
    setPaymentAmount("");
    setInterestPaymentAmount("");
    setPrincipalRepaymentAmount("");
    setPaymentNotes("");
    setPaymentPreview(null);
    setPaymentAccountId("");
    setAutoSplit(true);
  };

  const handleDeletePayment = (paymentId) => {
    if (window.confirm("Delete this payment record? This cannot be undone.")) {
      deletePaymentMutation.mutate(paymentId);
    }
  };

  const handleDeleteLoan = () => {
    if (
      window.confirm(
        "Are you sure you want to delete this loan? This action cannot be undone.",
      )
    ) {
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!loan || isError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            {isError ? "Failed to load loan" : "Loan Not Found"}
          </h2>
          <button
            onClick={() => navigate("/loans")}
            className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-medium shadow-sm shadow-indigo-500/20"
          >
            Back to Loans
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero 
        title={loan.contact?.name || "Loan Details"}
        subtitle={`${loan.loan_direction === "given" ? "Lent" : "Borrowed"} · ${loan.loan_type?.replace("_", " ")} · #${loan.id}`}
        backTo="/loans"
        actions={
          <>
            {user?.role === "admin" && loan.status === "active" && (
              <Button variant="white" icon={Edit} onClick={() => navigate(`/loans/${id}/edit`)}>Edit</Button>
            )}
            <Button variant="white" size="sm" onClick={() => navigate(`/loans/${id}/statement`)}>
              Statement
            </Button>
          </>
        }
      >
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroStat label="Principal" value={formatCurrency(loan.principal_amount)} accent="indigo" />
          <HeroStat label="Outstanding" value={formatCurrency(loan.outstanding_amount)} accent={loan.outstanding_amount > 0 ? "rose" : "emerald"} />
          <HeroStat label="Interest Earned" value={formatCurrency(loan.total_interest_earned || 0)} accent="teal" />
          <HeroStat label="Total Collected" value={formatCurrency(loan.total_collected || 0)} accent="emerald" />
        </div>
      </PageHero>
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Loan Information */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
              <h2 className="text-base font-bold text-slate-800 mb-4">
                Loan Information
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-slate-500">Principal Amount</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {formatCurrency(loan.principal_amount)}
                  </div>
                </div>
                {loan.loan_type !== "short_term" && loan.interest_rate && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">Interest Rate</div>
                    <div className="text-lg font-semibold text-slate-900">
                      {loan.interest_rate}% p.a.
                    </div>
                  </div>
                )}
                {loan.loan_type === "short_term" && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">Post-Due Rate</div>
                    <div className="text-lg font-semibold text-slate-900">
                      {loan.post_due_interest_rate
                        ? `${loan.post_due_interest_rate}% p.a.`
                        : "—"}
                    </div>
                    {loan.interest_free_till &&
                      (() => {
                        const today = new Date();
                        const freeTill = new Date(loan.interest_free_till);
                        const isActive = today > freeTill;
                        const daysLeft = Math.ceil(
                          (freeTill - today) / (1000 * 60 * 60 * 24),
                        );
                        if (isActive) {
                          return (
                            <span className="inline-block mt-1 px-2 py-1 bg-rose-100 text-rose-700 text-xs font-medium rounded-full">
                              ⚠️ Interest Active
                            </span>
                          );
                        }
                        return (
                          <span className="inline-block mt-1 px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                            ✅ Interest-Free Period ({daysLeft} days left)
                          </span>
                        );
                      })()}
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-slate-500">Loan Type</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {loan.loan_type === "interest_only"
                      ? "Interest Only"
                      : loan.loan_type === "emi"
                        ? "EMI"
                        : "Short Term"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500">Direction</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {loan.loan_direction === "given"
                      ? "↑ Given (Lent Out)"
                      : "↓ Taken (Borrowed)"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500">Start Date</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {formatDate(loan.disbursed_date)}
                  </div>
                </div>
                {loan.expected_end_date && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">Maturity Date</div>
                    <div className="text-lg font-semibold text-slate-900">
                      {formatDate(loan.expected_end_date)}
                    </div>
                  </div>
                )}
                {loan.emi_amount && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">EMI Amount</div>
                    <div className="text-lg font-semibold text-slate-900">
                      {formatCurrency(loan.emi_amount)}
                    </div>
                  </div>
                )}
                {loan.tenure_months && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">Tenure</div>
                    <div className="text-lg font-semibold text-slate-900">
                      {loan.tenure_months} months
                    </div>
                  </div>
                )}
                {loan.interest_free_till && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">Interest Free Till</div>
                    <div className="text-lg font-semibold text-slate-900">
                      {formatDate(loan.interest_free_till)}
                    </div>
                  </div>
                )}
              </div>
              {/* EMI Interest Summary */}
              {loan.loan_type === "emi" && emiInterestSummary && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="text-sm font-medium text-slate-700 mb-2">
                    EMI Interest Summary
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-indigo-50 rounded-xl p-3">
                      <div className="text-slate-500">Total Repayment</div>
                      <div className="font-semibold text-slate-900">
                        {formatCurrency(emiInterestSummary.total_repayment)}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-3">
                      <div className="text-slate-500">Total Interest</div>
                      <div className="font-semibold text-slate-900">
                        {formatCurrency(emiInterestSummary.total_interest_embedded)}
                      </div>
                    </div>
                    <div className="bg-violet-50 rounded-xl p-3">
                      <div className="text-slate-500">Effective Rate</div>
                      <div className="font-semibold text-slate-900">
                        ~{emiInterestSummary.effective_annual_rate_pct}% p.a.
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {loan.notes && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="text-xs font-medium text-slate-500">Notes</div>
                  <div className="text-slate-900 mt-1">{loan.notes}</div>
                </div>
              )}
            </div>

            {/* EMI Schedule */}
            {loan.loan_type === "emi" && emiSchedule.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
                <h2 className="text-base font-bold text-slate-800 mb-4">
                  EMI Schedule
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    {emiSchedule.filter((e) => e.status === "paid").length}/
                    {emiSchedule.length} paid
                  </span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">#</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Due Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">EMI Due</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Outstanding</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {emiSchedule.map((entry) => (
                        <tr key={entry.emi_number} className={entry.status === "paid" ? "bg-emerald-50/50" : entry.is_current_month ? "bg-amber-50/50" : ""}>
                          <td className={`px-4 py-3 text-sm ${entry.status === "paid" ? "line-through text-slate-400" : "text-slate-900"}`}>{entry.emi_number}</td>
                          <td className={`px-4 py-3 text-sm ${entry.status === "paid" ? "line-through text-slate-400" : "text-slate-900"}`}>{formatDate(entry.due_date)}</td>
                          <td className={`px-4 py-3 text-sm font-semibold ${entry.status === "paid" ? "line-through text-slate-400" : "text-slate-900"}`}>{formatCurrency(entry.due_amount)}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{entry.outstanding > 0 ? formatCurrency(entry.outstanding) : "—"}</td>
                          <td className="px-4 py-3 text-sm">
                            {entry.status === "paid" ? (
                              <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                                ✓ Paid
                              </span>
                            ) : entry.status === "partial" ? (
                              <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                                ⚡ Partial
                              </span>
                            ) : entry.status === "future" ? (
                              <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-full text-xs font-medium">
                                Future
                              </span>
                            ) : (
                              <span className="px-2 py-1 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">
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
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
              <h2 className="text-base font-bold text-slate-800 mb-4">
                Payment History
              </h2>
              {payments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Principal
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Interest
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Mode
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          Notes
                        </th>
                        {user?.role === "admin" && (
                          <th className="px-4 py-3"></th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-900">
                            {formatDate(payment.payment_date)}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                            {formatCurrency(payment.amount_paid)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {formatCurrency(payment.allocated_to_principal)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {formatCurrency(
                              parseFloat(
                                payment.allocated_to_current_interest || 0,
                              ) +
                                parseFloat(
                                  payment.allocated_to_overdue_interest || 0,
                                ),
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500 capitalize">
                            {payment.payment_mode || "-"}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500">
                            {payment.notes || "-"}
                          </td>
                          {user?.role === "admin" && (
                            <td className="px-4 py-3 text-sm">
                              <button
                                onClick={() => handleDeletePayment(payment.id)}
                                className="text-rose-400 hover:text-rose-600 transition-colors"
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
                <div className="text-center py-10">
                  <div className="text-3xl mb-2">💸</div>
                  <p className="text-slate-400 text-sm">No payments recorded yet</p>
                </div>
              )}
            </div>

            {/* Collaterals */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">
                  Collaterals
                </h2>
                {user?.role === "admin" && (
                  <button
                    onClick={() => setShowCollateralModal(true)}
                    className="px-3.5 py-1.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-medium shadow-sm shadow-indigo-500/20 active:scale-[0.97]"
                  >
                    + Add
                  </button>
                )}
              </div>
              {collaterals.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-3xl mb-2">🔒</div>
                  <p className="text-slate-400 text-sm">No collaterals recorded</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {collaterals.map((collateral) => (
                    <div
                      key={collateral.id}
                      className="border border-slate-200/60 rounded-xl p-4 hover:border-slate-300 transition-colors bg-slate-50/30"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-slate-800 capitalize flex items-center gap-2">
                            <span className="text-lg">{collateral.collateral_type === "gold" ? "🥇" : collateral.collateral_type === "property" ? "🏠" : collateral.collateral_type === "vehicle" ? "🚗" : "📄"}</span>
                            {collateral.collateral_type}
                          </div>
                          <div className="text-sm text-slate-500 mt-1">
                            {collateral.description}
                          </div>
                          {collateral.collateral_type === "gold" && (
                            <div className="text-sm text-slate-500 mt-1.5">
                              {collateral.gold_weight_grams}g • {collateral.gold_carat}K
                            </div>
                          )}
                          {collateral.notes && (
                            <div className="text-xs text-slate-400 mt-1">{collateral.notes}</div>
                          )}
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="text-right">
                            <div className="text-xs text-slate-500">Value</div>
                            <div className="text-lg font-bold text-slate-900">
                              {formatCurrency(collateral.estimated_value)}
                            </div>
                          </div>
                          {user?.role === "admin" && (
                            <button
                              onClick={() => handleDeleteCollateral(collateral.id)}
                              className="text-rose-400 hover:text-rose-600 mt-1 transition-colors"
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
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">
                  {loan.loan_type === "emi"
                    ? "Monthly EMI Tracking"
                    : "Monthly Interest Schedule"}
                </h2>
                <button
                  onClick={() => setShowMonthlySchedule((prev) => !prev)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                >
                  {showMonthlySchedule ? "Hide" : "Show"}
                </button>
              </div>
              {showMonthlySchedule &&
                (monthlyScheduleLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                  </div>
                ) : monthlyScheduleData?.schedule?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">Month</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">
                            {loan.loan_type === "emi" ? "EMI Due" : "Interest Due"}
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">Paid</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">Outstanding</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {monthlyScheduleData.schedule.map((entry, idx) => (
                          <>
                            <tr
                              key={idx}
                              className={entry.status === "paid" ? "bg-emerald-50/50" : entry.is_current_month ? "bg-amber-50/50" : ""}
                            >
                              <td className={`px-4 py-2.5 font-medium ${entry.status === "paid" ? "line-through text-slate-400" : "text-slate-900"}`}>
                                {entry.month_label}
                              </td>
                              <td className={`px-4 py-2.5 text-right ${entry.status === "paid" ? "line-through text-slate-400" : "text-slate-700"}`}>
                                {entry.interest_due > 0 ? formatCurrency(entry.interest_due) : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right text-slate-700">
                                {entry.interest_paid > 0 ? formatCurrency(entry.interest_paid) : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right text-slate-700">
                                {entry.interest_outstanding > 0 ? formatCurrency(entry.interest_outstanding) : "—"}
                              </td>
                              <td className="px-4 py-2.5">
                                {entry.status === "paid" ? (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">Paid</span>
                                ) : entry.status === "partial" ? (
                                  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">Partial</span>
                                ) : entry.status === "future" ? (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs font-medium">Future</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">Unpaid</span>
                                )}
                              </td>
                            </tr>
                            {entry.capitalized && (
                              <tr
                                key={`cap-${idx}`}
                                className="bg-violet-50 border-t-2 border-violet-300"
                              >
                                <td colSpan={5} className="px-4 py-2 text-sm text-violet-700 font-medium">
                                  🔄 Interest Capitalized: {formatCurrency(entry.capitalized_amount)} added to principal → New Principal: {formatCurrency(entry.new_principal_after)}
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-slate-400 text-center py-8 text-sm">
                    No schedule available yet
                  </p>
                ))}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
              <h2 className="text-base font-bold text-slate-800 mb-4">Quick Actions</h2>
              <div className="space-y-2.5">
                {loan.status === "active" && (
                  <button
                    onClick={() => {
                      setShowPaymentModal(true);
                      if (loan.loan_type !== "emi" && loanData?.outstanding?.interest_outstanding) {
                        const intAmt = parseFloat(loanData.outstanding.interest_outstanding);
                        if (intAmt > 0) {
                          setInterestPaymentAmount(intAmt.toFixed(2));
                          fetchPreview(intAmt.toFixed(2), null);
                        }
                      }
                    }}
                    className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 font-medium shadow-sm shadow-emerald-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <span>💵</span> Record Payment
                  </button>
                )}
                <button
                  onClick={() => navigate(`/loans/${id}/edit`)}
                  className="w-full px-4 py-3 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl hover:from-indigo-600 hover:to-indigo-700 font-medium shadow-sm shadow-indigo-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span>✏️</span> Edit Loan
                </button>
                <button
                  onClick={() => navigate(`/loans/${id}/statement`)}
                  className="w-full px-4 py-3 bg-gradient-to-r from-violet-500 to-violet-600 text-white rounded-xl hover:from-violet-600 hover:to-violet-700 font-medium shadow-sm shadow-violet-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span>📄</span> Client Statement
                </button>
                <button
                  onClick={() => navigate(`/contacts/${loan.contact_id}`)}
                  className="w-full px-4 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 font-medium transition-all flex items-center justify-center gap-2"
                >
                  <span>👤</span> View Contact
                </button>
                {user?.role === "admin" && loan.status === "active" && (
                  <button
                    onClick={handleMarkClosed}
                    disabled={markClosedMutation.isPending}
                    className="w-full px-4 py-3 bg-slate-600 text-white rounded-xl hover:bg-slate-700 font-medium disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  >
                    {markClosedMutation.isPending ? "Closing..." : <><span>✅</span> Mark as Closed</>}
                  </button>
                )}
                {user?.role === "admin" && (
                  <button
                    onClick={handleDeleteLoan}
                    disabled={deleteLoanMutation.isPending}
                    className="w-full px-4 py-2.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl hover:bg-rose-100 font-medium disabled:opacity-50 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <span>🗑️</span> Delete Loan
                  </button>
                )}
              </div>
            </div>

            {/* Contact Info */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
              <h2 className="text-base font-bold text-slate-800 mb-4">Contact Details</h2>
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-medium text-slate-500">Name</div>
                  <div className="font-semibold text-slate-900">
                    {contact?.name || loan.contact?.name}
                  </div>
                </div>
                {(contact?.phone || loan.contact?.phone) && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">Phone</div>
                    <div className="font-semibold text-slate-900">
                      {contact?.phone || loan.contact?.phone}
                    </div>
                  </div>
                )}
                {(contact?.city || loan.contact?.city) && (
                  <div>
                    <div className="text-xs font-medium text-slate-500">City</div>
                    <div className="font-semibold text-slate-900">
                      {contact?.city || loan.contact?.city}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </PageBody>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full animate-slideUp border border-slate-200/60">
            <h2 className="text-xl font-bold text-slate-900 mb-5">
              Record Payment
            </h2>
            <div className="space-y-4">
              {loan.loan_type === "emi" ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Payment Amount *</label>
                  <input type="number" step="0.01" value={paymentAmount}
                    onChange={(e) => handlePaymentAmountChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    placeholder="0.00" />
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={autoSplit}
                      onChange={(e) => { setAutoSplit(e.target.checked); setPaymentAmount(""); setInterestPaymentAmount(""); setPrincipalRepaymentAmount(""); setPaymentPreview(null); }}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500" />
                    <span className="text-sm font-medium text-slate-700">Auto-split (interest first, rest to principal)</span>
                  </label>
                  {autoSplit ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Payment Amount *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <input type="number" step="0.01" min="0" value={paymentAmount}
                          onChange={(e) => handlePaymentAmountChange(e.target.value)}
                          className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                          placeholder="0.00" />
                      </div>
                      {loanData?.outstanding?.interest_outstanding > 0 && (
                        <p className="text-xs text-slate-400 mt-1">
                          Outstanding interest: {formatCurrency(loanData.outstanding.interest_outstanding)} · Will be paid first
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Interest Payment</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                          <input type="number" step="0.01" min="0" value={interestPaymentAmount}
                            onChange={(e) => {
                              setInterestPaymentAmount(e.target.value);
                              const total = (parseFloat(e.target.value) || 0) + (parseFloat(principalRepaymentAmount) || 0);
                              if (total > 0) fetchPreview(total.toFixed(2), parseFloat(principalRepaymentAmount) || null);
                              else setPaymentPreview(null);
                            }}
                            className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                            placeholder="0.00" />
                        </div>
                        {loanData?.outstanding?.interest_outstanding > 0 && (
                          <p className="text-xs text-slate-400 mt-1">Outstanding: {formatCurrency(loanData.outstanding.interest_outstanding)}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Principal Repayment <span className="text-slate-400 font-normal">(optional)</span>
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                          <input type="number" step="0.01" min="0" value={principalRepaymentAmount}
                            onChange={(e) => {
                              setPrincipalRepaymentAmount(e.target.value);
                              const total = (parseFloat(interestPaymentAmount) || 0) + (parseFloat(e.target.value) || 0);
                              if (total > 0) fetchPreview(total.toFixed(2), parseFloat(e.target.value) || null);
                              else setPaymentPreview(null);
                            }}
                            className="w-full pl-7 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 transition-all"
                            placeholder="0.00" />
                        </div>
                        <p className="text-xs text-slate-400 mt-1">Interest will stop accruing on returned amount from this date.</p>
                      </div>
                      {(parseFloat(interestPaymentAmount) || 0) + (parseFloat(principalRepaymentAmount) || 0) > 0 && (
                        <div className="flex items-center justify-between bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2.5">
                          <span className="text-sm font-semibold text-slate-700">Total Payment</span>
                          <span className="text-base font-bold text-slate-900">
                            {formatCurrency((parseFloat(interestPaymentAmount) || 0) + (parseFloat(principalRepaymentAmount) || 0))}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Payment Date *</label>
                <input type="date" value={paymentDate}
                  onChange={(e) => {
                    setPaymentDate(e.target.value);
                    if (loan.loan_type === "emi") { if (paymentAmount) fetchPreview(paymentAmount, null); }
                    else if (autoSplit) { if (paymentAmount) fetchPreview(paymentAmount, null, true); }
                    else {
                      const total = (parseFloat(interestPaymentAmount) || 0) + (parseFloat(principalRepaymentAmount) || 0);
                      if (total > 0) fetchPreview(total.toFixed(2), parseFloat(principalRepaymentAmount) || null);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Payment Mode</label>
                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all">
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes (Optional)</label>
                <textarea value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all resize-none"
                  rows="2" placeholder="Notes..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Account</label>
                <select value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all">
                  <option value="">— Select Account —</option>
                  {accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
                </select>
              </div>
              {paymentPreview && (
                <div className="bg-indigo-50 border border-indigo-200/60 rounded-xl p-4">
                  <h3 className="font-semibold text-slate-800 text-sm mb-2">Allocation Preview</h3>
                  <div className="space-y-1.5 text-sm">
                    {paymentPreview.allocated_to_overdue_interest > 0 && (
                      <div className="flex justify-between"><span className="text-slate-600">Overdue Interest:</span><span className="font-medium">{formatCurrency(paymentPreview.allocated_to_overdue_interest)}</span></div>
                    )}
                    {paymentPreview.allocated_to_current_interest > 0 && (
                      <div className="flex justify-between"><span className="text-slate-600">Current Interest:</span><span className="font-medium">{formatCurrency(paymentPreview.allocated_to_current_interest)}</span></div>
                    )}
                    {paymentPreview.allocated_to_principal > 0 && (
                      <div className="flex justify-between"><span className="text-slate-600">Principal Returned:</span><span className="font-medium text-emerald-700">{formatCurrency(paymentPreview.allocated_to_principal)}</span></div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-indigo-200">
                      <span className="font-semibold">Total:</span>
                      <span className="font-semibold">{formatCurrency(paymentPreview.amount)}</span>
                    </div>
                    {paymentPreview.unallocated > 0 && (
                      <div className="flex justify-between text-amber-600"><span>Advance Credit:</span><span className="font-medium">{formatCurrency(paymentPreview.unallocated)}</span></div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={resetPaymentModal}
                className="flex-1 px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-medium">Cancel</button>
              <button onClick={handleRecordPayment}
                disabled={(loan.loan_type === "emi" ? !paymentAmount || parseFloat(paymentAmount) <= 0 : autoSplit ? !paymentAmount || parseFloat(paymentAmount) <= 0 : (parseFloat(interestPaymentAmount) || 0) + (parseFloat(principalRepaymentAmount) || 0) <= 0) || recordPaymentMutation.isPending}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-all font-medium shadow-sm shadow-emerald-500/20 active:scale-[0.98]">
                {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Collateral Modal */}
      {showCollateralModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full animate-slideUp border border-slate-200/60">
            <h2 className="text-xl font-bold text-slate-900 mb-5">Add Collateral</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Type</label>
                <select value={collateralForm.collateral_type}
                  onChange={(e) => setCollateralForm((p) => ({ ...p, collateral_type: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all">
                  <option value="property">Property</option>
                  <option value="gold">Gold</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="fd">Fixed Deposit</option>
                  <option value="shares">Shares</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <input type="text" placeholder="e.g. Plot at MG Road, Gold necklace"
                  value={collateralForm.description}
                  onChange={(e) => setCollateralForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all" />
              </div>
              {collateralForm.collateral_type === "gold" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Carat (K)</label>
                      <select value={collateralForm.gold_carat}
                        onChange={(e) => setCollateralForm((p) => ({ ...p, gold_carat: e.target.value }))}
                        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all">
                        <option value="">Select</option>
                        <option value="24">24K</option>
                        <option value="22">22K</option>
                        <option value="18">18K</option>
                        <option value="14">14K</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Weight (grams)</label>
                      <input type="number" step="0.01" placeholder="0.00"
                        value={collateralForm.gold_weight_grams}
                        onChange={(e) => setCollateralForm((p) => ({ ...p, gold_weight_grams: e.target.value }))}
                        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Value (₹)</label>
                    <input type="number" step="0.01" placeholder="Estimated value"
                      value={collateralForm.gold_manual_rate}
                      onChange={(e) => setCollateralForm((p) => ({ ...p, gold_manual_rate: e.target.value }))}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all" />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Estimated Value (₹)</label>
                  <input type="number" step="0.01" placeholder="0.00"
                    value={collateralForm.estimated_value}
                    onChange={(e) => setCollateralForm((p) => ({ ...p, estimated_value: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                <textarea rows="2" placeholder="Notes..."
                  value={collateralForm.notes}
                  onChange={(e) => setCollateralForm((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCollateralModal(false)}
                className="flex-1 px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-medium">Cancel</button>
              <button onClick={handleAddCollateral} disabled={addCollateralMutation.isPending}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all font-medium shadow-sm shadow-indigo-500/20 active:scale-[0.98]">
                {addCollateralMutation.isPending ? "Saving..." : "Add Collateral"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoanDetail;
