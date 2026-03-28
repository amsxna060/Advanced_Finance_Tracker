import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";

const defaultForm = {
  category: "",
  amount: "",
  expense_date: new Date().toISOString().split("T")[0],
  linked_type: "general",
  linked_id: "",
  description: "",
  payment_mode: "cash",
  receipt_url: "",
  account_id: "",
};

function ExpenseList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filters, setFilters] = useState({
    category: "",
    linked_type: "",
    from_date: "",
    to_date: "",
  });
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [errorMessage, setErrorMessage] = useState("");

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses", filters],
    queryFn: async () => {
      const params = {};
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params[key] = value;
      });
      const response = await api.get("/api/expenses", { params });
      return response.data;
    },
  });

  const { data: accountsList } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const response = await api.get("/api/accounts");
      return response.data;
    },
  });

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

  const submitExpense = (event) => {
    event.preventDefault();
    expenseMutation.mutate({
      category: form.category || null,
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
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  category: event.target.value,
                }))
              }
              placeholder="Filter by category..."
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={filters.linked_type}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  linked_type: event.target.value,
                }))
              }
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
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  from_date: event.target.value,
                }))
              }
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="date"
              value={filters.to_date}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, to_date: event.target.value }))
              }
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={() =>
                setFilters({
                  category: "",
                  linked_type: "",
                  from_date: "",
                  to_date: "",
                })
              }
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Clear Filters
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
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingExpense ? "Edit Expense" : "Add Expense"}
            </h2>
            <form onSubmit={submitExpense} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Category"
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      category: event.target.value,
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                />
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
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="general">General</option>
                  <option value="loan">Loan</option>
                  <option value="property">Property</option>
                  <option value="partnership">Partnership</option>
                </select>
                <input
                  type="number"
                  min="0"
                  placeholder="Linked record ID (optional)"
                  value={form.linked_id}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      linked_id: event.target.value,
                    }))
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                />
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
                placeholder="Description"
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
