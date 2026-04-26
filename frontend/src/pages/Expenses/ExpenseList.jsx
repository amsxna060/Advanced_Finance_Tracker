import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/utils";
import { useAuth } from "../../hooks/useAuth";
import LinkedRecordSelect from "../../components/LinkedRecordSelect";
import { PageHero, HeroStat, PageBody, Button } from "../../components/ui";
import {
  Flame,
  TrendingDown,
  Crown,
  Target,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

const FALLBACK_CATEGORIES = [
  "Housing & Utilities",
  "Groceries & Daily Needs",
  "Food & Dining",
  "Education & Children",
  "Transport & Auto",
  "Health & Medical",
  "Spiritual & Social",
  "Personal & Lifestyle",
  "Financial & Legal",
];

const FALLBACK_SUBCATEGORIES = {
  "Housing & Utilities": [
    "Rent / EMI", "Electricity", "Water", "Gas (Piped / Cylinder)",
    "Internet & Phone", "DTH / Cable", "Society Maintenance", "Home Repair & Painting",
  ],
  "Groceries & Daily Needs": [
    "Vegetables & Fruits", "Dairy & Eggs", "Grains & Staples",
    "Spices & Condiments", "Grocery Apps (BigBasket, Blinkit)", "Household Supplies",
  ],
  "Food & Dining": [
    "Restaurant / Eating Out", "Food Delivery (Swiggy, Zomato)",
    "Snacks & Chai / Coffee", "Mess / Tiffin Service", "Sweet Shop / Mithai",
  ],
  "Education & Children": [
    "School / College Fees", "Books & Stationery", "Coaching / Tuition",
    "Online Courses", "Kids Activities / Sports",
  ],
  "Transport & Auto": [
    "Petrol / Diesel / CNG", "Auto / Rickshaw", "Cab (Ola, Uber)",
    "Vehicle Service / Repair", "Toll & Parking", "Vehicle Insurance / Tax",
  ],
  "Health & Medical": [
    "Doctor / Hospital", "Medicine / Pharmacy", "Diagnostic / Lab Tests",
    "Health Insurance Premium", "Dental / Eye Care",
  ],
  "Spiritual & Social": [
    "Temple / Pooja / Daan", "Festivals & Celebrations",
    "Gifts & Shagun", "Wedding / Function", "Charity / Donation",
  ],
  "Personal & Lifestyle": [
    "Clothing & Fashion", "Salon & Grooming", "Online Shopping",
    "Entertainment & Movies", "Gym / Fitness", "Mobile Recharge / Apps",
  ],
  "Financial & Legal": [
    "Insurance Premium (LIC etc)", "Income Tax / TDS", "Legal / Stamp Duty",
    "Bank Charges / Penalties", "Commission / Brokerage",
  ],
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
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [geminiSuggest, setGeminiSuggest] = useState(null); // {category, sub_category} when Gemini suggests a new category
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ category: "", monthly_limit: "", rollover_enabled: false });
  const [budgetError, setBudgetError] = useState("");

  const { data: expenseData, isLoading } = useQuery({
    queryKey: ["expenses", filters, page],
    queryFn: async () => {
      const params = {
        paginated: true,
        limit: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      };
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params[key] = value;
      });
      const response = await api.get("/api/expenses", { params });
      return response.data;
    },
  });

  // Separate analytics query — covers ALL expenses in the period (not just current page)
  const { data: periodStats } = useQuery({
    queryKey: ["expense-period-stats", filters],
    queryFn: async () => {
      const params = {};
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;
      if (filters.category) params.category = filters.category;
      if (filters.linked_type) params.linked_type = filters.linked_type;
      return (await api.get("/api/expenses/analytics/summary", { params })).data;
    },
    staleTime: 60 * 1000,
  });

  const expenses = Array.isArray(expenseData)
    ? expenseData
    : expenseData?.items || [];
  const totalCount = expenseData?.total || expenses.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const { data: accountsList } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const response = await api.get("/api/accounts");
      return response.data;
    },
  });

  // Fetch categories from API (tree structure)
  const { data: apiCategoryTree = [] } = useQuery({
    queryKey: ["categories-tree"],
    queryFn: async () => (await api.get("/api/categories", { params: { tree: true } })).data,
  });

  // Derive category lists from API data, with fallback to hardcoded
  const EXPENSE_CATEGORIES = useMemo(() => {
    if (apiCategoryTree.length > 0) return apiCategoryTree.map((c) => c.name);
    return FALLBACK_CATEGORIES;
  }, [apiCategoryTree]);

  const SUBCATEGORIES = useMemo(() => {
    if (apiCategoryTree.length > 0) {
      const map = {};
      apiCategoryTree.forEach((parent) => {
        if (parent.children?.length > 0) {
          map[parent.name] = parent.children.map((ch) => ch.name);
        }
      });
      return map;
    }
    return FALLBACK_SUBCATEGORIES;
  }, [apiCategoryTree]);

  // Fetch budget vs actual for current month (for budget standing stat)
  const { data: budgetData } = useQuery({
    queryKey: ["budget-vs-actual"],
    queryFn: async () => {
      const res = await api.get("/api/category-limits/budget-vs-actual");
      return res.data;
    },
  });

  // Fetch existing category limits for budget modal
  const { data: categoryLimits = [] } = useQuery({
    queryKey: ["category-limits"],
    queryFn: async () => (await api.get("/api/category-limits")).data,
  });

  const budgetMutation = useMutation({
    mutationFn: async (payload) =>
      (await api.post("/api/category-limits", payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-limits"] });
      queryClient.invalidateQueries({ queryKey: ["budget-vs-actual"] });
      setBudgetForm({ category: "", monthly_limit: "", rollover_enabled: false });
      setBudgetError("");
    },
    onError: (e) =>
      setBudgetError(e.response?.data?.detail || "Failed to save budget"),
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: async (category) =>
      (await api.delete(`/api/category-limits/${encodeURIComponent(category)}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-limits"] });
      queryClient.invalidateQueries({ queryKey: ["budget-vs-actual"] });
    },
  });

  // Fetch analytics for previous period comparison
  const { data: prevPeriodData } = useQuery({
    queryKey: ["expenses-prev-period", filters.from_date, filters.to_date],
    enabled: Boolean(filters.from_date && filters.to_date),
    queryFn: async () => {
      if (!filters.from_date || !filters.to_date) return null;
      const from = new Date(filters.from_date);
      const to = new Date(filters.to_date);
      const daysInRange = Math.max(1, Math.ceil((to - from) / 86400000) + 1);
      const prevTo = new Date(from);
      prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo);
      prevFrom.setDate(prevFrom.getDate() - daysInRange + 1);
      const params = {
        paginated: true,
        limit: 1,
        skip: 0,
        from_date: prevFrom.toISOString().split("T")[0],
        to_date: prevTo.toISOString().split("T")[0],
      };
      const res = await api.get("/api/expenses/analytics/summary", {
        params: { from_date: params.from_date, to_date: params.to_date },
      });
      return { total: Number(res.data?.grand_total || 0) };
    },
  });

  const saveNewCategoryMutation = useMutation({
    mutationFn: async ({ category, sub_category }) => {
      const parentRes = await api.post("/api/categories", { name: category });
      const parentId = parentRes.data?.id;
      if (sub_category && parentId) {
        await api.post("/api/categories", { name: sub_category, parent_id: parentId });
      }
      return parentRes.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["categories-tree"]);
      setGeminiSuggest(null);
    },
  });

  const handleSuggest = async () => {
    if (!form.description || form.description.trim().length < 3) return;
    setIsSuggesting(true);
    setGeminiSuggest(null);
    try {
      const res = await api.post("/api/expenses/suggest-category", {
        description: form.description,
      });
      const cat = res.data?.suggested_category;
      const sub = res.data?.suggested_subcategory;
      if (cat) {
        setForm((prev) => ({
          ...prev,
          category: cat,
          sub_category: sub || "",
        }));
        const source = res.data?.source || "ai";
        setAutoFilled(source);
        // If Gemini suggested a category not in our DB list, offer to save it
        if (source === "gemini" && !EXPENSE_CATEGORIES.includes(cat)) {
          setGeminiSuggest({ category: cat, sub_category: sub || "" });
        }
      } else {
        setAutoFilled("none");
      }
    } catch {
      setAutoFilled("none");
    } finally {
      setIsSuggesting(false);
    }
  };

  const submitExpense = async (event) => {
    event.preventDefault();

    if (!form.account_id) {
      setErrorMessage("Please select an account — this is required for money flow tracking.");
      return;
    }

    let category = form.category;
    let sub_category = form.sub_category;

    // Auto-categorize on save if category or sub_category not set
    if (
      form.description &&
      form.description.trim().length >= 3 &&
      (!category || !sub_category)
    ) {
      try {
        const res = await api.post("/api/expenses/suggest-category", {
          description: form.description,
        });
        if (!category && res.data?.suggested_category) {
          category = res.data.suggested_category;
        }
        if (!sub_category && res.data?.suggested_subcategory) {
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

  // Derived hero stats — use periodStats (full period) for accuracy, not paginated list
  const daysInRange = useMemo(() => {
    if (!filters.from_date || !filters.to_date) return 30;
    const from = new Date(filters.from_date);
    const to = new Date(filters.to_date);
    return Math.max(1, Math.ceil((to - from) / 86400000) + 1);
  }, [filters.from_date, filters.to_date]);

  const heroTotal = Number(periodStats?.grand_total || 0);
  const heroCount = periodStats?.expense_count || 0;
  const dailyBurnRate = heroTotal / daysInRange;

  const highestBurner = useMemo(() => {
    const cats = periodStats?.categories || [];
    if (cats.length === 0) return null;
    return { name: cats[0].category, amount: Number(cats[0].total) };
  }, [periodStats]);

  const budgetStanding = useMemo(() => {
    if (budgetData && budgetData.total_budget > 0) {
      return { type: "budget", pct: budgetData.pct_used || 0 };
    }
    if (prevPeriodData && prevPeriodData.total > 0) {
      const change = ((heroTotal - prevPeriodData.total) / prevPeriodData.total) * 100;
      return { type: "comparison", pct: change };
    }
    return { type: "none" };
  }, [budgetData, prevPeriodData, heroTotal]);

  const openCreateModal = () => {
    setEditingExpense(null);
    setForm(defaultForm);
    setErrorMessage("");
    setAutoFilled(false);
    setGeminiSuggest(null);
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
    setAutoFilled(false);
    setGeminiSuggest(null);
    setShowModal(true);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title="Expenses"
        subtitle="Track and manage all your expenses"
        backTo="/dashboard"
        actions={
          user?.role === "admin" && (
            <div className="flex gap-2">
              <Button variant="white" onClick={() => { setShowBudgetModal(true); setBudgetError(""); }}>
                🎯 Set Budget
              </Button>
              <Button variant="white" onClick={openCreateModal}>
                + Add Expense
              </Button>
            </div>
          )
        }
      >
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <Flame className="w-4 h-4 text-rose-300" />
              <span className="text-xs font-medium text-white/70">Total Period Expense</span>
            </div>
            <div className="text-xl font-bold text-white">{formatCurrency(heroTotal)}</div>
            <div className="text-xs text-white/50 mt-0.5">{heroCount} entries · {daysInRange} days</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-amber-300" />
              <span className="text-xs font-medium text-white/70">Daily Burn Rate</span>
            </div>
            <div className="text-xl font-bold text-white">{formatCurrency(dailyBurnRate)}</div>
            <div className="text-xs text-white/50 mt-0.5">avg per day</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <Crown className="w-4 h-4 text-violet-300" />
              <span className="text-xs font-medium text-white/70">Highest Burner</span>
            </div>
            {highestBurner ? (
              <>
                <div className="text-xl font-bold text-white">{formatCurrency(highestBurner.amount)}</div>
                <div className="text-xs text-white/50 mt-0.5">{highestBurner.name}</div>
              </>
            ) : (
              <div className="text-xl font-bold text-white/40">—</div>
            )}
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-teal-300" />
              <span className="text-xs font-medium text-white/70">
                {budgetStanding.type === "budget" ? "Budget Used" : "vs Previous Period"}
              </span>
            </div>
            {budgetStanding.type === "budget" ? (
              <>
                <div className="text-xl font-bold text-white">{budgetStanding.pct.toFixed(1)}%</div>
                <div className="text-xs text-white/50 mt-0.5">of monthly budget</div>
              </>
            ) : budgetStanding.type === "comparison" ? (
              <>
                <div className={`text-xl font-bold flex items-center gap-1 ${budgetStanding.pct > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                  {budgetStanding.pct > 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  {Math.abs(budgetStanding.pct).toFixed(1)}%
                </div>
                <div className="text-xs text-white/50 mt-0.5">{budgetStanding.pct > 0 ? "higher" : "lower"} than prev period</div>
              </>
            ) : (
              <>
                <div className="text-xl font-bold text-white/40">—</div>
                <div className="text-xs text-white/50 mt-0.5">Set budget to track</div>
              </>
            )}
          </div>
        </div>
      </PageHero>
      <PageBody>
        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
            />
            <input
              type="date"
              value={filters.to_date}
              onChange={(event) => {
                setPage(1);
                setFilters((prev) => ({
                  ...prev,
                  to_date: event.target.value,
                }));
              }}
              className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
              className="px-3.5 py-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors"
            >
              All Time
            </button>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-200 border-t-indigo-600" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-16 text-center">
            <div className="text-4xl mb-3">💸</div>
            <p className="text-slate-400 text-sm">
              No expenses found for the selected filters.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">
                      Sub-Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">
                      Linked To
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">
                      Mode
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden xl:table-cell">
                      Description
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.map((expense) => (
                    <tr
                      key={expense.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                        {formatDate(expense.expense_date)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {expense.category || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 hidden lg:table-cell">
                        {expense.sub_category || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 capitalize hidden md:table-cell">
                        {expense.linked_type || "general"}
                        {expense.linked_id ? ` #${expense.linked_id}` : ""}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-rose-600 text-right whitespace-nowrap">
                        − {formatCurrency(expense.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 capitalize hidden lg:table-cell">
                        {expense.payment_mode || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 max-w-[200px] truncate hidden xl:table-cell">
                        {expense.description || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                        {user?.role === "admin" && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditModal(expense)}
                              className="text-indigo-600 hover:text-indigo-800 font-medium text-xs transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm("Delete this expense?"))
                                  deleteMutation.mutate(expense.id);
                              }}
                              className="text-rose-500 hover:text-rose-700 font-medium text-xs transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between bg-white rounded-2xl border border-slate-200/60 shadow-sm px-4 py-3 gap-3">
            <div className="text-sm text-slate-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                First
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
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
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${p === page ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Next ›
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </PageBody>

      {/* Expense Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 max-w-2xl w-full p-6 animate-slideUp max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-5">
              {editingExpense ? "Edit Expense" : "Add Expense"}
            </h2>
            <form onSubmit={submitExpense} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      category: event.target.value,
                      sub_category: "",
                    }))
                  }
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
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
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                />
                <select
                  value={form.payment_mode}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      payment_mode: event.target.value,
                    }))
                  }
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
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
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
              />
              <div>
                <select
                  required
                  value={form.account_id}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      account_id: event.target.value,
                    }))
                  }
                  className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all ${
                    !form.account_id ? "border-amber-300 bg-amber-50/50" : "border-slate-200"
                  }`}
                >
                  <option value="">— Select Account (required) —</option>
                  {(accountsList || []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.account_type})
                    </option>
                  ))}
                </select>
                {!form.account_id && (
                  <p className="text-xs text-amber-600 mt-1 ml-1">
                    ⚠ Selecting an account ensures proper money flow tracking
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <textarea
                  rows="3"
                  placeholder="Type description, then click ✨ to auto-fill category"
                  value={form.description}
                  onChange={(event) => {
                    setAutoFilled(false);
                    setForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }));
                  }}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all resize-none"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSuggest}
                    disabled={
                      isSuggesting ||
                      !form.description ||
                      form.description.trim().length < 3
                    }
                    className="px-4 py-1.5 bg-gradient-to-r from-violet-500 to-violet-600 text-white text-sm rounded-xl hover:from-violet-600 hover:to-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-violet-500/20 active:scale-[0.98]"
                  >
                    {isSuggesting ? "Thinking…" : "✨ Auto-fill Category"}
                  </button>
                  {autoFilled && autoFilled !== "none" && (
                    <span className="text-xs font-medium flex items-center gap-1 text-violet-600">
                      ✓ Category auto-filled
                      {autoFilled === "gemini" && <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px]">Gemini</span>}
                      {autoFilled === "rules" && <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">Rules</span>}
                      {autoFilled === "learned" && <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">Learned</span>}
                      <span className="text-slate-400 font-normal">— review &amp; adjust if needed</span>
                    </span>
                  )}
                  {autoFilled === "none" && (
                    <span className="text-xs text-amber-600 font-medium">
                      ⚠ Couldn't detect category — please select manually
                    </span>
                  )}
                  {geminiSuggest && (
                    <button
                      type="button"
                      onClick={() => saveNewCategoryMutation.mutate(geminiSuggest)}
                      disabled={saveNewCategoryMutation.isPending}
                      className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-60"
                    >
                      {saveNewCategoryMutation.isPending ? "Saving…" : `➕ Save "${geminiSuggest.category}" as new category`}
                    </button>
                  )}
                </div>
              </div>
              {errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
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
                    setAutoFilled(false);
                    setGeminiSuggest(null);
                  }}
                  className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={expenseMutation.isPending}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl hover:from-indigo-600 hover:to-indigo-700 disabled:opacity-50 font-medium text-sm shadow-sm shadow-indigo-500/20 transition-all active:scale-[0.98]"
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

      {/* Budget Modal */}
      {showBudgetModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 max-w-lg w-full max-h-[90vh] overflow-y-auto animate-slideUp">
            <div className="p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-1">Set Monthly Budget</h2>
              <p className="text-sm text-slate-400 mb-5">Set spending limits per category to track your budget.</p>
              {budgetError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
                  {budgetError}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!budgetForm.category || !budgetForm.monthly_limit) return;
                  budgetMutation.mutate({
                    category: budgetForm.category,
                    monthly_limit: parseFloat(budgetForm.monthly_limit),
                    rollover_enabled: budgetForm.rollover_enabled,
                  });
                }}
                className="flex gap-2 mb-4"
              >
                <select
                  value={budgetForm.category}
                  onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
                  className="flex-1 px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                  required
                >
                  <option value="">Select Category</option>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  placeholder="Monthly limit"
                  value={budgetForm.monthly_limit}
                  onChange={(e) => setBudgetForm({ ...budgetForm, monthly_limit: e.target.value })}
                  className="w-36 px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                />
                <button
                  type="submit"
                  disabled={budgetMutation.isPending}
                  className="px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 disabled:opacity-50 transition-all active:scale-[0.98]"
                >
                  {budgetMutation.isPending ? "…" : "Save"}
                </button>
              </form>
              <label className="flex items-center gap-2 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={budgetForm.rollover_enabled}
                  onChange={(e) => setBudgetForm({ ...budgetForm, rollover_enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700">
                  🔄 Roll over unspent budget to next month
                </span>
              </label>
              {/* Existing limits */}
              {categoryLimits.length > 0 ? (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Limits</h4>
                  {categoryLimits.map((cl) => (
                    <div key={cl.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-200/60">
                      <div>
                        <span className="text-sm font-medium text-slate-700">{cl.category}</span>
                        <span className="text-sm text-slate-400 ml-2">{formatCurrency(cl.monthly_limit)}/mo</span>
                        {cl.rollover_enabled && (
                          <span className="ml-2 text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded font-medium">🔄 Rollover</span>
                        )}
                      </div>
                      <button
                        onClick={() => deleteBudgetMutation.mutate(cl.category)}
                        className="text-xs text-rose-500 hover:text-rose-700 font-medium transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">No budgets set yet. Add one above.</p>
              )}
              <div className="flex justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowBudgetModal(false)}
                  className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 text-sm font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExpenseList;
