import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { formatDate } from "../../lib/utils";
import { PageHero, PageBody } from "../../components/ui";

const INITIAL = {
  title: "",
  description: "",
  pot_size: "",
  member_count: "",
  tenure_months: "",
  base_installment: "",
  start_date: "",
  status: "active",
  notes: "",
  contact_id: "",
  account_id: "",
};

export default function BeesiForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const qc = useQueryClient();
  const [form, setForm] = useState(INITIAL);
  const [error, setError] = useState("");

  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => (await api.get("/api/contacts", { params: { limit: 500 } })).data,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await api.get("/api/accounts")).data,
  });

  useQuery({
    queryKey: ["beesi", id],
    enabled: isEdit,
    staleTime: 0,
    queryFn: async () => {
      const res = await api.get(`/api/beesi/${id}`);
      const d = res.data;
      setForm({
        title: d.title || "",
        description: d.description || "",
        pot_size: d.pot_size || "",
        member_count: d.member_count || "",
        tenure_months: d.tenure_months || "",
        base_installment: d.base_installment || "",
        start_date: d.start_date || "",
        status: d.status || "active",
        notes: d.notes || "",
        contact_id: d.contact_id ?? "",
        account_id: d.account_id ?? "",
      });
      return d;
    },
  });

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (isEdit) {
        return api.put(`/api/beesi/${id}`, data);
      }
      return api.post("/api/beesi", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["beesis"] });
      navigate("/beesi");
    },
    onError: (err) => {
      setError(err.response?.data?.detail || "Failed to save Beesi");
    },
  });

  const handleChange = (e) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    mutation.mutate({
      ...form,
      pot_size: Number(form.pot_size),
      member_count: Number(form.member_count),
      tenure_months: Number(form.tenure_months),
      base_installment: Number(form.base_installment),
      contact_id: form.contact_id ? Number(form.contact_id) : null,
      account_id: form.account_id ? Number(form.account_id) : null,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero title={isEdit ? "Edit Beesi" : "New Beesi"} backTo="/beesi" compact />
      <PageBody>
        <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5 sm:p-6">

          {error && (
            <div className="mb-4 p-3 border-rose-200 bg-rose-50 text-rose-700 rounded-xl text-sm border">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Committee Organiser
                </label>
                <select
                  name="contact_id"
                  value={form.contact_id}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">— none —</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Linked Account
                </label>
                <select
                  name="account_id"
                  value={form.account_id}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">— none —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Title <span className="text-rose-500">*</span>
              </label>
              <input
                name="title"
                value={form.title}
                onChange={handleChange}
                required
                placeholder="e.g. Ramesh BC 2024"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Pot Size (₹) <span className="text-rose-500">*</span>
                </label>
                <input
                  name="pot_size"
                  type="number"
                  value={form.pot_size}
                  onChange={handleChange}
                  required
                  min="1"
                  placeholder="200000"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Base Installment (₹/month) <span className="text-rose-500">*</span>
                </label>
                <input
                  name="base_installment"
                  type="number"
                  value={form.base_installment}
                  onChange={handleChange}
                  required
                  min="1"
                  placeholder="10000"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Total Members <span className="text-rose-500">*</span>
                </label>
                <input
                  name="member_count"
                  type="number"
                  value={form.member_count}
                  onChange={handleChange}
                  required
                  min="2"
                  placeholder="20"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Tenure (months) <span className="text-rose-500">*</span>
                </label>
                <input
                  name="tenure_months"
                  type="number"
                  value={form.tenure_months}
                  onChange={handleChange}
                  required
                  min="1"
                  placeholder="20"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Start Date <span className="text-rose-500">*</span>
                </label>
                <input
                  name="start_date"
                  type="date"
                  value={form.start_date}
                  onChange={handleChange}
                  required
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Status
                </label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Description
              </label>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={2}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
              />
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
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex-1 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl hover:from-indigo-600 hover:to-indigo-700 shadow-sm shadow-indigo-500/20 active:scale-[0.98] font-medium disabled:opacity-50 transition-all"
              >
                {mutation.isPending
                  ? "Saving…"
                  : isEdit
                    ? "Save Changes"
                    : "Create Beesi"}
              </button>
              <button
                type="button"
                onClick={() => navigate("/beesi")}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
        </div>
      </PageBody>
    </div>
  );
}
