import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import LinkedRecordSelect from "../../components/LinkedRecordSelect";

const EXPENSE_CATEGORIES = [
  "Home",
  "Market",
  "Grocery",
  "Medical",
  "Personal",
  "Business",
  "Travel",
  "Education",
  "Rent",
  "Utilities",
  "Insurance",
  "Legal",
  "Registration",
  "Fuel",
  "Maintenance",
  "Food & Dining",
  "Shopping",
  "Entertainment",
  "Commission",
  "Miscellaneous",
];

const SUBCATEGORIES = {
  "Grocery":       ["Vegetables & Fruits", "Dairy & Eggs", "Grains & Staples", "Grocery Apps"],
  "Food & Dining": ["Restaurant", "Food Delivery", "Snacks & Coffee", "Fast Food", "Mess / Tiffin"],
  "Travel":        ["Cab & Taxi", "Air Travel", "Rail Travel", "Local Transport", "Toll & Parking"],
  "Medical":       ["Hospital", "Medicine / Pharmacy", "Diagnostic", "Dental"],
  "Education":     ["School / College Fees", "Books & Stationery", "Online Courses", "Coaching"],
  "Utilities":     ["Electricity", "Internet & Phone", "Gas", "Water", "DTH / Cable"],
  "Shopping":      ["Online Shopping", "Clothing & Fashion", "Electronics", "Jewellery"],
  "Entertainment": ["Movies", "Streaming", "Gaming", "Events"],
  "Maintenance":   ["Vehicle Service", "Home Repair", "Appliance", "Painting / Renovation"],
  "Personal":      ["Salon & Grooming", "Fitness", "Clothing"],
  "Fuel":          ["Petrol", "Diesel", "CNG", "EV Charging"],
  "Home":          ["Furniture", "Appliances", "Household Help", "Cleaning"],
};

const defaultForm = {
  category: "",
  sub_category: "",
  amount: "",
  expense_date: new Date().toISOString().split("T")[0],
  linked_type: "general",
  linked_id: "",
  description: "",
  payment_mode: "cash",
  receipt_url: "",
  account_id: "",
};

const PAGE_SIZE = 50;

function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function ExpenseList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filters, setFilters] = useState({
    category: "",
    linked_type: "",
    from_date: getMonthStart(),
    to_date: getToday(),
  });
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [errorMessage, setErrorMessage] = useState("");

  const { data: expenseData, isLoading } = useQuery({
    queryKey: ["expenses", filters, page],
    queryFn: async () => {
      const params = { paginated: true, limit: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE };
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params[key] = value;
      });
      const response = await api.get("/api/expenses", { params });
      return response.data;
    },
  });

  const expenses = Array.isArray(expenseData) ? expenseData : (expenseData?.items || []);
  const totalCount = expenseData?.total || expenses.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const { data: accountsList } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const response = await api.get("/api/accounts");
      return response.data;
    },
  });

  const submitExpense = async (event) => {
    event.preventDefault();

    let category = form.category;
    let sub_category = form.sub_category;

    // Auto-categorize on save if description present and category not manually chosen
    if (!category && form.description && form.description.trim().length >= 3) {
      try {
        const res = await api.post("/api/expenses/suggest-category", {
          description: form.description,
        });
        if (res.data?.suggested_category) {
          category = res.data.suggested_category;
        }
        if (res.data?.suggested_subcategory && !sub_category) {
          sub_category = res.data.suggested_subcategory;
        }
      } catch {
        // silently ignore suggestion errors
      }
    }

    expenseMutation.mutate({
      category: category || null,
      sub_category: sub_category || null,
      amount: Number(form.amount),
      expense_date: form.expense_date,
      linked_type: form.linked_type || null,
      linked_id: form.linked_id ? Number(form.linked_id) : null,
      description: form.description || null,
      payment_mode: form.payment_mode || null,
      receipt_url: form.receipt_url || null,
      account_id: form.account_id ? Number(form.account_id) : null,
    });
  };

  const expenseMutation = useMutation({
    mutationFn: async (payload) => {
      if (editingExpense) {
        const response = await api.put(
          `/api/expenses/${editingExpense.id}`,
          payload,
        );
        return response.data;
      }
      const response = await api.post("/api/expenses", payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-activity"] });
      setShowModal(false);
      setEditingExpense(null);
      setForm(defaultForm);
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(
        error.response?.data?.detail || "Failed to save expense.",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (expenseId) => {
      await api.delete(`/api/expenses/${expenseId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-activity"] });
    },
  });

  const totals = useMemo(() => {
    return expenses.reduce(
      (acc, expense) => {
        const amount = Number(expense.amount || 0);
        acc.total += amount;
        acc.count += 1;
        if (expense.linked_type === "general" || !expense.linked_type) {
          acc.general += amount;
        }
        return acc;
      },
      { total: 0, general: 0, count: 0 },
    );
  }, [expenses]);

  const openCreateModal = () => {
    setEditingExpense(null);
    setForm(defaultForm);
    setErrorMessage("");
    setShowModal(true);
  };

  const openEditModal = (expense) => {
    setEditingExpense(expense);
    setForm({
      category: expense.category || "",
      sub_category: expense.sub_category || "",
      amount: expense.amount?.toString() || "",
      expense_date: expense.expense_date || defaultForm.expense_date,
      linked_type: expense.linked_type || "general",
      linked_id: expense.linked_id?.toString() || "",
      description: expense.description || "",
      payment_mode: expense.payment_mode || "cash",
      receipt_url: expense.receipt_url || "",
      account_id: expense.account_id ? expense.account_id.toString() : "",
    });
    setErrorMessage("");
    setShowModal(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate("/dashboard")}
              className="text-gray-600 hover:text-gray-900 mb-3"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Expenses</h1>
            <p className="text-gray-600 mt-1">
              Log general and deal-linked expenses in one place.
            </p>
          </div>
          {user?.role === "admin" && (
            <button
              onClick={openCreateModal}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              + Add Expense
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Total Expenses</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(totals.total)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">General Expenses</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatCurrency(totals.general)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-sm text-gray-500">Entries</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {totals.count}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <input
              type="text"
              value={filters.category}
              onChange={(event) => {
                setPage(1);
                setFilters((prev) => ({
                  ...prev,
                  category: event.target.value,
                }));
              }}
              placeholder="Filter by category..."
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={filters.linked_type}
              onChange={(event) => {
                setPage(1);
                setFilters((prev) => ({
                  ...prev,
                  linked_type: event.target.value,
                }));
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Linked Types</option>
              <option value="general">General</option>
              <option value="loan">Loan</option>
              <option value="property">Property</option>
              <option value="partnership">Partnership</option>
            </select>
            <input
              type="date"
              value={filters.from_date}
              onChange={(event) => {
                setPage(1);
                setFilters((prev) => ({
                  ...prev,
                  from_date: event.target.value,
                }));
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="date"
              value={filters.to_date}
              onChange={(event) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, to_date: event.target.value }));
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={() => {
                setPage(1);
                setFilters({
                  category: "",
                  linked_type: "",
                  from_date: "",
                  to_date: "",
                });
              }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              All Time
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : expenses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-600">
            No expenses found.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Sub-Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Linked To
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Payment Mode
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatDate(expense.expense_date)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {expense.category || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {expense.sub_category || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 capitalize">
                      {expense.linked_type || "general"}
                      {expense.linked_id ? ` #${expense.linked_id}` : ""}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {formatCurrency(expense.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 capitalize">
                      {expense.payment_mode || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-sm">
                      {expense.description || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="flex gap-3">
                        {user?.role === "admin" && (
                          <>
                            <button
                              onClick={() => openEditModal(expense)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm("Delete this expense?")) {
                                  deleteMutation.mutate(expense.id);
                                }
                              }}
                              className="text-red-600 hover:text-red-900"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between bg-white rounded-lg shadow-sm px-4 py-3">
            <div className="text-sm text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} expenses
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                First
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                ‹ Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let start = Math.max(1, Math.min(page - 2, totalPages - 4));
                const p = start + i;
                if (p > totalPages) return null;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-3 py-1 text-sm rounded border ${
                      p === page
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                Next ›
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1 text-sm rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingExpense ? "Edit Expense" : "Add Expense"}
            </h2>
            <form onSubmit={submitExpense} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      category: event.target.value,
                      sub_category: "",
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select Category</option>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <select
                  value={form.sub_category}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      sub_category: event.target.value,
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                  disabled={!form.category || !SUBCATEGORIES[form.category]}
                >
                  <option value="">Sub-Category (auto / manual)</option>
                  {(SUBCATEGORIES[form.category] || []).map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="Amount"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, amount: event.target.value }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="date"
                  required
                  value={form.expense_date}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      expense_date: event.target.value,
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                />
                <select
                  value={form.payment_mode}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      payment_mode: event.target.value,
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
                <select
                  value={form.linked_type}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      linked_type: event.target.value,
                      linked_id: "",
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="general">General</option>
                  <option value="loan">Loan</option>
                  <option value="property">Property</option>
                  <option value="partnership">Partnership</option>
                </select>
                {form.linked_type && form.linked_type !== "general" ? (
                  <LinkedRecordSelect
                    linkedType={form.linked_type}
                    value={form.linked_id}
                    onChange={(val) =>
                      setForm((prev) => ({ ...prev, linked_id: val }))
                    }
                    className=""
                  />
                ) : (
                  <div />
                )}
              </div>
              <input
                type="url"
                placeholder="Receipt URL (optional)"
                value={form.receipt_url}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    receipt_url: event.target.value,
                  }))
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
              <select
                value={form.account_id}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    account_id: event.target.value,
                  }))
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">-- No account (cash flow) --</option>
                {(accountsList || []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.account_type})
                  </option>
                ))}
              </select>
              <textarea
                rows="4"
                placeholder="Description (AI will suggest category on save)"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
              {errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {errorMessage}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingExpense(null);
                    setForm(defaultForm);
                    setErrorMessage("");
                  }}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={expenseMutation.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {expenseMutation.isPending
                    ? "Saving..."
                    : editingExpense
                      ? "Update Expense"
                      : "Save Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExpenseList;
