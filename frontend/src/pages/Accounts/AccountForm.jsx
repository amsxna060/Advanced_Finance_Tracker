import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { PageHero, PageBody, Card } from "../../components/ui";

const INITIAL = {
  name: "",
  account_type: "cash",
  bank_name: "",
  account_number: "",
  opening_balance: "0",
  notes: "",
};

export default function AccountForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const qc = useQueryClient();
  const [form, setForm] = useState(INITIAL);
  const [error, setError] = useState("");

  useQuery({
    queryKey: ["account", id],
    enabled: isEdit,
    staleTime: 0,
    queryFn: async () => {
      const res = await api.get(`/api/accounts/${id}`);
      const d = res.data;
      setForm({
        name: d.name || "",
        account_type: d.account_type || "cash",
        bank_name: d.bank_name || "",
        account_number: d.account_number || "",
        opening_balance: d.opening_balance || "0",
        notes: d.notes || "",
      });
      return d;
    },
  });

  const mutation = useMutation({
    mutationFn: (data) =>
      isEdit
        ? api.put(`/api/accounts/${id}`, data)
        : api.post("/api/accounts", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      navigate("/accounts");
    },
    onError: (e) => setError(e.response?.data?.detail || "Failed to save"),
  });

  const handleChange = (e) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    mutation.mutate({ ...form, opening_balance: Number(form.opening_balance) });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        title={isEdit ? "Edit Account" : "New Account"}
        backTo="/accounts"
        compact
      />

      <PageBody className="max-w-xl">
        <Card className="p-6">

          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Account Name *
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="e.g. Cash in Hand, HDFC Savings"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Account Type *
              </label>
              <select
                name="account_type"
                value={form.account_type}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
              >
                <option value="cash">Cash</option>
                <option value="savings">Savings Bank</option>
                <option value="current">Current Account</option>
                <option value="wallet">Digital Wallet (UPI/Paytm etc.)</option>
                <option value="fixed_deposit">Fixed Deposit</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Bank Name
                </label>
                <input
                  name="bank_name"
                  value={form.bank_name}
                  onChange={handleChange}
                  placeholder="HDFC, SBI, ICICI…"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Account Number
                </label>
                <input
                  name="account_number"
                  value={form.account_number}
                  onChange={handleChange}
                  placeholder="Last 4 digits or full"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Opening Balance (₹)
              </label>
              <input
                name="opening_balance"
                type="number"
                value={form.opening_balance}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
              />
              <p className="text-xs text-slate-400 mt-1">
                Balance at the time of adding this account
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Notes
              </label>
              <textarea
                name="notes"
                value={form.notes}
                onChange={handleChange}
                rows={2}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium disabled:opacity-50 shadow-sm active:scale-[0.98]"
              >
                {mutation.isPending
                  ? "Saving…"
                  : isEdit
                    ? "Save Changes"
                    : "Create Account"}
              </button>
              <button
                type="button"
                onClick={() => navigate("/accounts")}
                className="px-3.5 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      </PageBody>
    </div>
  );
}
