import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";

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
});

const buildLoanPayload = (formData) => {
  const payload = {
    contact_id: parseInt(formData.contact_id, 10),
    loan_direction: formData.direction,
    loan_type: formData.type,
    principal_amount: parseFloat(formData.principal_amount),
    disbursed_date: formData.start_date,
    notes: formData.notes?.trim() || null,
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
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    contact_id: "",
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
  });

  const [errors, setErrors] = useState({});

  // Fetch contacts for dropdown
  const { data: contacts } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const response = await api.get("/api/contacts");
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
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["loan", id] });
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
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

          <h1 className="text-3xl font-bold text-gray-900">
            {isEditMode ? "Edit Loan" : "New Loan"}
          </h1>
          <p className="text-gray-600 mt-1">
            {isEditMode ? "Update loan information" : "Create a new loan"}
          </p>
        </div>

        {/* Progress Steps */}
        {!isEditMode && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center flex-1">
                  <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full ${
                      step >= s
                        ? "bg-blue-600 text-white"
                        : "bg-gray-300 text-gray-600"
                    }`}
                  >
                    {s}
                  </div>
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      step > s ? "bg-blue-600" : "bg-gray-300"
                    } ${s === 3 ? "hidden" : ""}`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-sm">
              <span
                className={
                  step >= 1 ? "text-blue-600 font-medium" : "text-gray-500"
                }
              >
                Direction
              </span>
              <span
                className={
                  step >= 2 ? "text-blue-600 font-medium" : "text-gray-500"
                }
              >
                Loan Type
              </span>
              <span
                className={
                  step >= 3 ? "text-blue-600 font-medium" : "text-gray-500"
                }
              >
                Details
              </span>
            </div>
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm p-6"
        >
          {/* Error Message */}
          {errors.submit && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              {errors.submit}
            </div>
          )}

          {/* Step 1: Direction & Contact */}
          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Step 1: Choose Direction
              </h2>

              {/* Contact Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contact *
                </label>
                <select
                  name="contact_id"
                  value={formData.contact_id}
                  onChange={handleChange}
                  className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    errors.contact_id ? "border-red-500" : "border-gray-300"
                  }`}
                >
                  <option value="">Select a contact</option>
                  {contacts?.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name} - {contact.phone}
                    </option>
                  ))}
                </select>
                {errors.contact_id && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.contact_id}
                  </p>
                )}
              </div>

              {/* Direction Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Direction *
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, direction: "given" }))
                    }
                    className={`p-6 border-2 rounded-lg transition-all ${
                      formData.direction === "given"
                        ? "border-green-500 bg-green-50"
                        : "border-gray-300 hover:border-green-300"
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-3xl mb-2">↑</div>
                      <div className="font-semibold text-gray-900">
                        Given (Lent Out)
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        Money you lent to someone
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, direction: "taken" }))
                    }
                    className={`p-6 border-2 rounded-lg transition-all ${
                      formData.direction === "taken"
                        ? "border-red-500 bg-red-50"
                        : "border-gray-300 hover:border-red-300"
                    }`}
                  >
                    <div className="text-center">
                      <div className="text-3xl mb-2">↓</div>
                      <div className="font-semibold text-gray-900">
                        Taken (Borrowed)
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
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
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Next Step
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Loan Type */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Step 2: Choose Loan Type
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Interest Only */}
                <button
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, type: "interest_only" }))
                  }
                  className={`p-6 border-2 rounded-lg text-left transition-all ${
                    formData.type === "interest_only"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-300 hover:border-blue-300"
                  }`}
                >
                  <div className="font-semibold text-lg text-gray-900 mb-2">
                    Interest Only
                  </div>
                  <div className="text-sm text-gray-600">
                    Large loan with monthly interest payments. Principal due at
                    end.
                  </div>
                  <div className="mt-3 text-xs text-gray-500">
                    Best for: Business loans, large amounts
                  </div>
                </button>

                {/* EMI */}
                <button
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, type: "emi" }))
                  }
                  className={`p-6 border-2 rounded-lg text-left transition-all ${
                    formData.type === "emi"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-300 hover:border-blue-300"
                  }`}
                >
                  <div className="font-semibold text-lg text-gray-900 mb-2">
                    EMI
                  </div>
                  <div className="text-sm text-gray-600">
                    Fixed monthly installment covering principal and interest.
                  </div>
                  <div className="mt-3 text-xs text-gray-500">
                    Best for: Structured repayment
                  </div>
                </button>

                {/* Short Term */}
                <button
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, type: "short_term" }))
                  }
                  className={`p-6 border-2 rounded-lg text-left transition-all ${
                    formData.type === "short_term"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-300 hover:border-blue-300"
                  }`}
                >
                  <div className="font-semibold text-lg text-gray-900 mb-2">
                    Short Term
                  </div>
                  <div className="text-sm text-gray-600">
                    Quick loan with flexible interest-free period.
                  </div>
                  <div className="mt-3 text-xs text-gray-500">
                    Best for: Emergency loans, friends
                  </div>
                </button>
              </div>

              <div className="flex justify-between pt-4">
                <button
                  type="button"
                  onClick={handleBack}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Next Step
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Loan Details */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {isEditMode ? "Edit Loan" : "Step 3: Loan Details"}
              </h2>

              {/* Edit mode: show contact, direction, type at top */}
              {isEditMode && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-gray-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contact *
                    </label>
                    <select
                      name="contact_id"
                      value={formData.contact_id}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select a contact</option>
                      {contacts?.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name} - {contact.phone}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Direction *
                    </label>
                    <select
                      name="direction"
                      value={formData.direction}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="given">Given (Lent Out)</option>
                      <option value="taken">Taken (Borrowed)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Loan Type *
                    </label>
                    <select
                      name="type"
                      value={formData.type}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="interest_only">Interest Only</option>
                      <option value="emi">EMI</option>
                      <option value="short_term">Short Term</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Common Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Principal Amount (₹) *
                  </label>
                  <input
                    type="number"
                    name="principal_amount"
                    value={formData.principal_amount}
                    onChange={handleChange}
                    step="0.01"
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      errors.principal_amount
                        ? "border-red-500"
                        : "border-gray-300"
                    }`}
                    placeholder="500000"
                  />
                  {errors.principal_amount && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.principal_amount}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Interest Rate (% per annum) *
                  </label>
                  <input
                    type="number"
                    name="interest_rate"
                    value={formData.interest_rate}
                    onChange={handleChange}
                    step="0.01"
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      errors.interest_rate
                        ? "border-red-500"
                        : "border-gray-300"
                    }`}
                    placeholder="12.00"
                  />
                  {errors.interest_rate && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.interest_rate}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Disbursed Date *
                  </label>
                  <input
                    type="date"
                    name="start_date"
                    value={formData.start_date}
                    onChange={handleChange}
                    className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      errors.start_date ? "border-red-500" : "border-gray-300"
                    }`}
                  />
                  {errors.start_date && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.start_date}
                    </p>
                  )}
                </div>
              </div>

              {/* Interest Only Specific Fields */}
              {formData.type === "interest_only" && (
                <div className="border-t border-gray-200 pt-6 mt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Interest Only Settings
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Interest Start Date *
                      </label>
                      <input
                        type="date"
                        name="interest_start_date"
                        value={formData.interest_start_date}
                        onChange={handleChange}
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          errors.interest_start_date
                            ? "border-red-500"
                            : "border-gray-300"
                        }`}
                      />
                      {errors.interest_start_date && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors.interest_start_date}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Capitalization After (months)
                      </label>
                      <input
                        type="number"
                        name="capitalization_after_months"
                        value={formData.capitalization_after_months}
                        onChange={handleChange}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="12"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Interest will be added to principal after this many
                        months
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* EMI Specific Fields */}
              {formData.type === "emi" && (
                <div className="border-t border-gray-200 pt-6 mt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    EMI Settings
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        EMI Amount (₹) *
                      </label>
                      <input
                        type="number"
                        name="emi_amount"
                        value={formData.emi_amount}
                        onChange={handleChange}
                        step="0.01"
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          errors.emi_amount
                            ? "border-red-500"
                            : "border-gray-300"
                        }`}
                        placeholder="45000"
                      />
                      {errors.emi_amount && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors.emi_amount}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tenure (months) *
                      </label>
                      <input
                        type="number"
                        name="tenure_months"
                        value={formData.tenure_months}
                        onChange={handleChange}
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          errors.tenure_months
                            ? "border-red-500"
                            : "border-gray-300"
                        }`}
                        placeholder="24"
                      />
                      {errors.tenure_months && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors.tenure_months}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        EMI Day of Month *
                      </label>
                      <input
                        type="number"
                        name="emi_day"
                        value={formData.emi_day}
                        onChange={handleChange}
                        min="1"
                        max="31"
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          errors.emi_day ? "border-red-500" : "border-gray-300"
                        }`}
                        placeholder="5"
                      />
                      {errors.emi_day && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors.emi_day}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Short Term Specific Fields */}
              {formData.type === "short_term" && (
                <div className="border-t border-gray-200 pt-6 mt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Short Term Settings
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Expected End Date *
                      </label>
                      <input
                        type="date"
                        name="maturity_date"
                        value={formData.maturity_date}
                        onChange={handleChange}
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          errors.maturity_date
                            ? "border-red-500"
                            : "border-gray-300"
                        }`}
                      />
                      {errors.maturity_date && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors.maturity_date}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Interest Free Till
                      </label>
                      <input
                        type="date"
                        name="interest_free_till"
                        value={formData.interest_free_till}
                        onChange={handleChange}
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          errors.interest_free_till
                            ? "border-red-500"
                            : "border-gray-300"
                        }`}
                      />
                      {errors.interest_free_till && (
                        <p className="mt-1 text-sm text-red-600">
                          {errors.interest_free_till}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        No interest charged till this date
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Post-Due Interest Rate (%)
                      </label>
                      <input
                        type="number"
                        name="post_due_interest_rate"
                        value={formData.post_due_interest_rate}
                        onChange={handleChange}
                        step="0.01"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="18.00"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Rate after maturity date
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="border-t border-gray-200 pt-6 mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows="4"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add any additional notes about this loan"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-between pt-4">
                {!isEditMode && (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    Back
                  </button>
                )}
                <div className={`flex space-x-4 ${isEditMode ? "w-full" : ""}`}>
                  <button
                    type="button"
                    onClick={() => navigate("/loans")}
                    className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      createMutation.isPending || updateMutation.isPending
                    }
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
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
      </div>
    </div>
  );
}

export default LoanForm;
