import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";

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
    mutationFn: (data) => isEdit ? api.put(`/api/accounts/${id}`, data) : api.post("/api/accounts", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      navigate("/accounts");
    },
    onError: (e) => setError(e.response?.data?.detail || "Failed to save"),
  });

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    mutation.mutate({ ...form, opening_balance: Number(form.opening_balance) });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-xl mx-auto">
        <button onClick={() => navigate("/accounts")} className="text-gray-500 hover:text-gray-900 text-sm mb-4">← Back to Accounts</button>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">{isEdit ? "Edit Account" : "New Account"}</h1>

          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account Name *</label>
              <input name="name" value={form.name} onChange={handleChange} required
                placeholder="e.g. Cash in Hand, HDFC Savings"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account Type *</label>
              <select name="account_type" value={form.account_type} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                <input name="bank_name" value={form.bank_name} onChange={handleChange}
                  placeholder="HDFC, SBI, ICICI…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                <input name="account_number" value={form.account_number} onChange={handleChange}
                  placeholder="Last 4 digits or full"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Opening Balance (₹)</label>
              <input name="opening_balance" type="number" value={form.opening_balance} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">Balance at the time of adding this account</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea name="notes" value={form.notes} onChange={handleChange} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={mutation.isPending}
                className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium disabled:opacity-50">
                {mutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Account"}
              </button>
              <button type="button" onClick={() => navigate("/accounts")}
                className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
