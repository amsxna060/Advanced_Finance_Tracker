import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { PageHero, PageBody, Card } from "../../components/ui";

const normalizeLoanForForm = (loan) => ({
  contact_id: String(loan.contact_id || ""),
  direction: loan.loan_direction || loan.direction || "given",
  type: loan.loan_type || loan.type || "interest_only",
  principal_amount: loan.principal_amount ? String(loan.principal_amount) : "",
  interest_rate: loan.interest_rate ? String(loan.interest_rate) : "",
  start_date: loan.disbursed_date || loan.start_date || "",
  interest_start_date: loan.interest_start_date || "",
  capitalization_after_months: loan.capitalization_after_months
    ? String(loan.capitalization_after_months)
    : "12",
  emi_amount: loan.emi_amount ? String(loan.emi_amount) : "",
  tenure_months: loan.tenure_months ? String(loan.tenure_months) : "",
  emi_day: loan.emi_day_of_month ? String(loan.emi_day_of_month) : "1",
  maturity_date: loan.expected_end_date || loan.maturity_date || "",
  interest_free_till: loan.interest_free_till || "",
  post_due_interest_rate: loan.post_due_interest_rate
    ? String(loan.post_due_interest_rate)
    : "",
  notes: loan.notes || "",
  account_id: loan.account_id ? String(loan.account_id) : "",
});

const buildLoanPayload = (formData) => {
  const payload = {
    contact_id: parseInt(formData.contact_id, 10),
    loan_direction: formData.direction,
    loan_type: formData.type,
    principal_amount: parseFloat(formData.principal_amount),
    disbursed_date: formData.start_date,
    notes: formData.notes?.trim() || null,
    account_id: formData.account_id ? parseInt(formData.account_id, 10) : null,
  };

  // interest_rate is optional for EMI and short_term
  if (formData.interest_rate && parseFloat(formData.interest_rate) > 0) {
    payload.interest_rate = parseFloat(formData.interest_rate);
  }

  if (formData.type === "interest_only") {
    const capitalizationMonths = formData.capitalization_after_months
      ? parseInt(formData.capitalization_after_months, 10)
      : null;

    payload.interest_start_date = formData.interest_start_date;
    payload.capitalization_enabled = Boolean(
      capitalizationMonths && capitalizationMonths > 0,
    );
    payload.capitalization_after_months = capitalizationMonths;
  }

  if (formData.type === "emi") {
    payload.emi_amount = parseFloat(formData.emi_amount);
    payload.tenure_months = parseInt(formData.tenure_months, 10);
    payload.emi_day_of_month = parseInt(formData.emi_day, 10);
  }

  if (formData.type === "short_term") {
    payload.expected_end_date = formData.maturity_date || null;
    payload.interest_free_till = formData.interest_free_till;
    if (formData.post_due_interest_rate) {
      payload.post_due_interest_rate = parseFloat(
        formData.post_due_interest_rate,
      );
    }
  }

  return payload;
};

function LoanForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [step, setStep] = useState(1);

  // Pre-fill contact from navigation state (e.g. clicking "Create Loan" from contact page)
  const prefilledContactId = location.state?.contactId
    ? String(location.state.contactId)
    : new URLSearchParams(location.search).get("contact_id") || "";

  const [formData, setFormData] = useState({
    contact_id: prefilledContactId,
    direction: "given",
    type: "interest_only",
    principal_amount: "",
    interest_rate: "",
    start_date: new Date().toISOString().split("T")[0],

    // Interest Only fields
    interest_start_date: "",
    capitalization_after_months: 12,

    // EMI fields
    emi_amount: "",
    tenure_months: "",
    emi_day: 1,

    // Short Term fields
    maturity_date: "",
    interest_free_till: "",
    post_due_interest_rate: "",

    notes: "",
    account_id: "",
  });

  const [errors, setErrors] = useState({});

  // Fetch contacts for dropdown
  const { data: contacts } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const response = await api.get("/api/contacts", {
        params: { limit: 500 },
      });
      return response.data;
    },
  });

  // Fetch accounts for dropdown
  const { data: accountsList } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const response = await api.get("/api/accounts");
      return response.data;
    },
  });

  // Fetch loan data if editing
  const { isLoading } = useQuery({
    queryKey: ["loan", id],
    queryFn: async () => {
      const response = await api.get(`/api/loans/${id}`);
      const loan = response.data.loan || response.data;
      setFormData(normalizeLoanForForm(loan));
      setStep(3);
      return loan;
    },
    enabled: isEditMode,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.post("/api/loans", data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      if (data && data.id) {
        navigate(`/loans/${data.id}`);
      } else {
        navigate("/loans");
      }
    },
    onError: (error) => {
      console.error("Loan creation error:", error);
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        setErrors({
          submit: typeof detail === "string" ? detail : JSON.stringify(detail),
        });
      } else {
        setErrors({
          submit: "Failed to create loan. Please check all fields.",
        });
      }
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const response = await api.put(`/api/loans/${id}`, data);
      return response.data;
    },
    onSuccess: (data) => {
      // Remove stale cache so detail page does a clean fetch
      queryClient.removeQueries({ queryKey: ["loan", String(id)] });
      queryClient.removeQueries({ queryKey: ["loan", id] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      navigate(`/loans/${data.id || id}`);
    },
    onError: (error) => {
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        setErrors({
          submit: typeof detail === "string" ? detail : JSON.stringify(detail),
        });
      }
    },
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validateStep = (currentStep) => {
    const newErrors = {};

    if (currentStep === 1) {
      if (!formData.contact_id) newErrors.contact_id = "Contact is required";
      if (!formData.direction) newErrors.direction = "Direction is required";
    }

    if (currentStep === 2) {
      if (!formData.type) newErrors.type = "Loan type is required";
    }

    if (currentStep === 3) {
      if (
        !formData.principal_amount ||
        parseFloat(formData.principal_amount) <= 0
      ) {
        newErrors.principal_amount = "Valid principal amount is required";
      }
      // interest_rate only required for interest_only loans
      if (formData.type === "interest_only") {
        if (!formData.interest_rate || parseFloat(formData.interest_rate) < 0) {
          newErrors.interest_rate =
            "Interest rate is required for interest-only loans";
        }
      }
      if (!formData.start_date) newErrors.start_date = "Start date is required";

      // Type-specific validation
      if (formData.type === "interest_only") {
        if (!formData.interest_start_date) {
          newErrors.interest_start_date = "Interest start date is required";
        }
      }

      if (formData.type === "emi") {
        if (!formData.emi_amount || parseFloat(formData.emi_amount) <= 0) {
          newErrors.emi_amount = "Valid EMI amount is required";
        }
        if (!formData.tenure_months || parseInt(formData.tenure_months) <= 0) {
          newErrors.tenure_months = "Valid tenure is required";
        }
        if (
          !formData.emi_day ||
          formData.emi_day < 1 ||
          formData.emi_day > 31
        ) {
          newErrors.emi_day = "EMI day must be between 1 and 31";
        }
      }

      if (formData.type === "short_term") {
        if (!formData.maturity_date) {
          newErrors.maturity_date = "Expected end date is required";
        }
        if (!formData.interest_free_till) {
          newErrors.interest_free_till = "Interest-free till date is required";
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(step)) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateStep(3)) {
      return;
    }

    const submitData = buildLoanPayload(formData);

    if (isEditMode) {
      updateMutation.mutate(submitData);
    } else {
      createMutation.mutate(submitData);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={isEditMode ? "Edit Loan" : "New Loan"}
        subtitle={
          isEditMode ? "Update loan details" : "Create a new lending record"
        }
        backTo="/loans"
        compact
      />

      <PageBody>
        {/* Progress Steps */}
        {!isEditMode && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center flex-1">
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold transition-all ${step >= s ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20" : "bg-slate-200 text-slate-500"}`}
                  >
                    {s}
                  </div>
                  <div
                    className={`flex-1 h-1 mx-2 rounded-full ${step > s ? "bg-indigo-600" : "bg-slate-200"} ${s === 3 ? "hidden" : ""}`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs">
              <span
                className={
                  step >= 1 ? "text-indigo-600 font-medium" : "text-slate-400"
                }
              >
                Direction
              </span>
              <span
                className={
                  step >= 2 ? "text-indigo-600 font-medium" : "text-slate-400"
                }
              >
                Loan Type
              </span>
              <span
                className={
                  step >= 3 ? "text-indigo-600 font-medium" : "text-slate-400"
                }
              >
                Details
              </span>
            </div>
          </div>
        )}

        {/* Form */}
        <Card className="p-6 sm:p-8">
          <form onSubmit={handleSubmit}>
            {errors.submit && (
              <div className="mb-6 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-sm">
                {errors.submit}
              </div>
            )}

            {/* Step 1 */}
            {step === 1 && (
              <div className="space-y-6">
                <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  STEP 1: CHOOSE DIRECTION
                </h2>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Contact *
                  </label>
                  <select
                    name="contact_id"
                    value={formData.contact_id}
                    onChange={handleChange}
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.contact_id ? "border-rose-300" : "border-slate-200"}`}
                  >
                    <option value="">Select a contact</option>
                    {contacts?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} - {c.phone}
                      </option>
                    ))}
                  </select>
                  {errors.contact_id && (
                    <p className="mt-1 text-xs text-rose-500">
                      {errors.contact_id}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-3">
                    Direction *
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, direction: "given" }))
                      }
                      className={`p-5 border-2 rounded-2xl transition-all ${formData.direction === "given" ? "border-emerald-500 bg-emerald-50/50 shadow-sm" : "border-slate-200 hover:border-emerald-300"}`}
                    >
                      <div className="text-center">
                        <div className="text-2xl mb-1.5">↑</div>
                        <div className="font-semibold text-slate-800">
                          Given (Lent Out)
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Money you lent to someone
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, direction: "taken" }))
                      }
                      className={`p-5 border-2 rounded-2xl transition-all ${formData.direction === "taken" ? "border-rose-500 bg-rose-50/50 shadow-sm" : "border-slate-200 hover:border-rose-300"}`}
                    >
                      <div className="text-center">
                        <div className="text-2xl mb-1.5">↓</div>
                        <div className="font-semibold text-slate-800">
                          Taken (Borrowed)
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Money you borrowed from someone
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={handleNext}
                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-medium shadow-sm shadow-indigo-500/20 active:scale-[0.98]"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 */}
            {step === 2 && (
              <div className="space-y-6">
                <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  STEP 2: CHOOSE LOAN TYPE
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    {
                      key: "interest_only",
                      title: "Interest Only",
                      desc: "Large loan with monthly interest payments. Principal due at end.",
                      hint: "Business loans, large amounts",
                    },
                    {
                      key: "emi",
                      title: "EMI",
                      desc: "Fixed monthly installment covering principal and interest.",
                      hint: "Structured repayment",
                    },
                    {
                      key: "short_term",
                      title: "Short Term",
                      desc: "Quick loan with flexible interest-free period.",
                      hint: "Emergency loans, friends",
                    },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, type: t.key }))
                      }
                      className={`p-5 border-2 rounded-2xl text-left transition-all ${formData.type === t.key ? "border-indigo-500 bg-indigo-50/50 shadow-sm" : "border-slate-200 hover:border-indigo-300"}`}
                    >
                      <div className="font-semibold text-slate-800 mb-1.5">
                        {t.title}
                      </div>
                      <div className="text-sm text-slate-500">{t.desc}</div>
                      <div className="mt-2 text-xs text-slate-400">
                        Best for: {t.hint}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-between pt-4">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="px-6 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-medium shadow-sm shadow-indigo-500/20 active:scale-[0.98]"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {/* Step 3 */}
            {step === 3 && (
              <div className="space-y-6">
                <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  {isEditMode ? "EDIT LOAN DETAILS" : "STEP 3: LOAN DETAILS"}
                </h2>

                {isEditMode && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-5 border-b border-slate-100">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-slate-700">
                        Contact *
                      </label>
                      <select
                        name="contact_id"
                        value={formData.contact_id}
                        onChange={handleChange}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      >
                        <option value="">Select a contact</option>
                        {contacts?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} - {c.phone}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-slate-700">
                        Direction *
                      </label>
                      <select
                        name="direction"
                        value={formData.direction}
                        onChange={handleChange}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      >
                        <option value="given">Given (Lent Out)</option>
                        <option value="taken">Taken (Borrowed)</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-slate-700">
                        Loan Type *
                      </label>
                      <select
                        name="type"
                        value={formData.type}
                        onChange={handleChange}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                      >
                        <option value="interest_only">Interest Only</option>
                        <option value="emi">EMI</option>
                        <option value="short_term">Short Term</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Common Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      name: "principal_amount",
                      label: "Principal Amount (₹) *",
                      type: "number",
                      step: "0.01",
                      placeholder: "500000",
                    },
                    {
                      name: "interest_rate",
                      label: "Interest Rate (% p.a.) *",
                      type: "number",
                      step: "0.01",
                      placeholder: "12.00",
                    },
                    {
                      name: "start_date",
                      label: "Disbursed Date *",
                      type: "date",
                    },
                  ].map((f) => (
                    <div key={f.name} className="space-y-1.5">
                      <label className="block text-sm font-medium text-slate-700">
                        {f.label}
                      </label>
                      <input
                        type={f.type}
                        name={f.name}
                        value={formData[f.name]}
                        onChange={handleChange}
                        step={f.step}
                        placeholder={f.placeholder}
                        className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors[f.name] ? "border-rose-300" : "border-slate-200"}`}
                      />
                      {errors[f.name] && (
                        <p className="text-xs text-rose-500">
                          {errors[f.name]}
                        </p>
                      )}
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700">
                      Account (for money flow)
                    </label>
                    <select
                      name="account_id"
                      value={formData.account_id}
                      onChange={handleChange}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                    >
                      <option value="">-- No account --</option>
                      {(accountsList || []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.account_type})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-400">
                      Link to track debit/credit in your ledger
                    </p>
                  </div>
                </div>

                {/* Interest Only */}
                {formData.type === "interest_only" && (
                  <div className="border-t border-slate-100 pt-5 mt-5">
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      INTEREST ONLY SETTINGS
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-700">
                          Interest Start Date *
                        </label>
                        <input
                          type="date"
                          name="interest_start_date"
                          value={formData.interest_start_date}
                          onChange={handleChange}
                          className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.interest_start_date ? "border-rose-300" : "border-slate-200"}`}
                        />
                        {errors.interest_start_date && (
                          <p className="text-xs text-rose-500">
                            {errors.interest_start_date}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-700">
                          Capitalization After (months)
                        </label>
                        <input
                          type="number"
                          name="capitalization_after_months"
                          value={formData.capitalization_after_months}
                          onChange={handleChange}
                          placeholder="12"
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                        />
                        <p className="text-xs text-slate-400">
                          Interest added to principal after this period
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* EMI */}
                {formData.type === "emi" && (
                  <div className="border-t border-slate-100 pt-5 mt-5">
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      EMI SETTINGS
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        {
                          name: "emi_amount",
                          label: "EMI Amount (₹) *",
                          step: "0.01",
                          placeholder: "45000",
                        },
                        {
                          name: "tenure_months",
                          label: "Tenure (months) *",
                          placeholder: "24",
                        },
                        {
                          name: "emi_day",
                          label: "EMI Day of Month *",
                          min: "1",
                          max: "31",
                          placeholder: "5",
                        },
                      ].map((f) => (
                        <div key={f.name} className="space-y-1.5">
                          <label className="block text-sm font-medium text-slate-700">
                            {f.label}
                          </label>
                          <input
                            type="number"
                            name={f.name}
                            value={formData[f.name]}
                            onChange={handleChange}
                            step={f.step}
                            min={f.min}
                            max={f.max}
                            placeholder={f.placeholder}
                            className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors[f.name] ? "border-rose-300" : "border-slate-200"}`}
                          />
                          {errors[f.name] && (
                            <p className="text-xs text-rose-500">
                              {errors[f.name]}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Short Term */}
                {formData.type === "short_term" && (
                  <div className="border-t border-slate-100 pt-5 mt-5">
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      SHORT TERM SETTINGS
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-700">
                          Expected End Date *
                        </label>
                        <input
                          type="date"
                          name="maturity_date"
                          value={formData.maturity_date}
                          onChange={handleChange}
                          className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.maturity_date ? "border-rose-300" : "border-slate-200"}`}
                        />
                        {errors.maturity_date && (
                          <p className="text-xs text-rose-500">
                            {errors.maturity_date}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-700">
                          Interest Free Till
                        </label>
                        <input
                          type="date"
                          name="interest_free_till"
                          value={formData.interest_free_till}
                          onChange={handleChange}
                          className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${errors.interest_free_till ? "border-rose-300" : "border-slate-200"}`}
                        />
                        {errors.interest_free_till && (
                          <p className="text-xs text-rose-500">
                            {errors.interest_free_till}
                          </p>
                        )}
                        <p className="text-xs text-slate-400">
                          No interest charged till this date
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-slate-700">
                          Post-Due Interest Rate (%)
                        </label>
                        <input
                          type="number"
                          name="post_due_interest_rate"
                          value={formData.post_due_interest_rate}
                          onChange={handleChange}
                          step="0.01"
                          placeholder="18.00"
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                        />
                        <p className="text-xs text-slate-400">
                          Rate after maturity date
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div className="border-t border-slate-100 pt-5 mt-5">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Notes
                  </label>
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    rows="3"
                    placeholder="Add any additional notes"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all resize-none"
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-between pt-4">
                  {!isEditMode && (
                    <button
                      type="button"
                      onClick={handleBack}
                      className="px-5 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-medium"
                    >
                      Back
                    </button>
                  )}
                  <div className={`flex gap-3 ${isEditMode ? "w-full" : ""}`}>
                    <button
                      type="button"
                      onClick={() => navigate("/loans")}
                      className="flex-1 px-5 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={
                        createMutation.isPending || updateMutation.isPending
                      }
                      className="flex-1 px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-medium disabled:opacity-50 shadow-sm shadow-indigo-500/20 active:scale-[0.98]"
                    >
                      {createMutation.isPending || updateMutation.isPending
                        ? "Saving..."
                        : isEditMode
                          ? "Update Loan"
                          : "Create Loan"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </Card>
      </PageBody>
    </div>
  );
}

export default LoanForm;
