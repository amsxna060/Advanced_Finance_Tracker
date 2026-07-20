import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { setTenantContext, getTenantContext } from "../../lib/api";

/* E5 — Platform admin console: user management, platform stats, and the
   "view as user" support flow (read-only tenant context). */

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN") : "—");

function StatCard({ label, value, hint }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function AdminConsole() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const activeContext = getTenantContext();

  const { data: users = [] } = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () => api.get("/api/admin/users", { params: { search } }).then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get("/api/admin/stats").then((r) => r.data),
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, is_active }) =>
      api.put(`/api/admin/users/${id}/active`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const [activityFor, setActivityFor] = useState(null);

  function viewAs(user) {
    setTenantContext(user, false); // always start read-only; toggle edit in-app
    qc.clear(); // drop every cached query — they belong to the previous tenant
    navigate("/dashboard");
  }

  const adoption = stats
    ? Object.entries(stats.module_adoption).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Admin Console</h1>
        <p className="text-xs text-slate-400 mt-0.5">Platform overview · users · support</p>
      </div>

      {activeContext && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          Currently viewing <b>{activeContext.username}</b> (read-only).{" "}
          <button
            onClick={() => { setTenantContext(null); qc.clear(); }}
            className="font-semibold underline hover:text-amber-900"
          >
            Exit support view
          </button>
        </div>
      )}

      {/* ── Stats ── */}
      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Users" value={stats.total_users}
                      hint={`${stats.tenant_owners} owners · ${stats.household_guests} guests`} />
            <StatCard label="Active" value={stats.active_users} />
            <StatCard label="Verified" value={stats.verified_users} />
            <StatCard label="Full-feature accounts" value={stats.accounts_with_all_modules}
                      hint="legacy / all modules" />
          </div>
          {adoption.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
                Module adoption (explicit selections)
              </p>
              <div className="flex flex-wrap gap-2">
                {adoption.map(([k, n]) => (
                  <span key={k} className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium">
                    {k} · {n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Users ── */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">Users</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username or email…"
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-64"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="px-5 py-2.5">User</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Modules</th>
                <th className="px-3 py-2.5">Rows</th>
                <th className="px-3 py-2.5">Joined</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((u) => (
                <tr key={u.id} className={!u.is_active ? "opacity-50" : ""}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{u.username}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                      u.role === "admin" ? "bg-violet-50 text-violet-700"
                        : u.role === "readonly" ? "bg-slate-100 text-slate-500"
                        : "bg-emerald-50 text-emerald-700"}`}>
                      {u.role}
                    </span>
                    {u.tenant_owner_id && (
                      <span className="ml-1 text-[10px] text-slate-400">guest of #{u.tenant_owner_id}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {u.enabled_modules ? `${u.enabled_modules.length} selected` : "all (legacy)"}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {stats?.rows_per_tenant?.[u.id] ?? stats?.rows_per_tenant?.[String(u.id)] ?? 0}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(u.created_at)}</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-medium ${u.is_active ? "text-emerald-600" : "text-rose-600"}`}>
                      {u.is_active ? "active" : "deactivated"}
                    </span>
                    {!u.email_verified && (
                      <span className="ml-1 text-[10px] text-amber-500">unverified</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setActivityFor(u)}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                    >
                      Activity
                    </button>
                    {!u.tenant_owner_id && u.role !== "admin" && (
                      <button
                        onClick={() => viewAs(u)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition"
                      >
                        View as
                      </button>
                    )}
                    {u.role !== "admin" && (
                      <button
                        onClick={() => activeMutation.mutate({ id: u.id, is_active: !u.is_active })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                          u.is_active
                            ? "text-rose-600 hover:bg-rose-50"
                            : "text-emerald-600 hover:bg-emerald-50"}`}
                      >
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {activityFor && (
        <ActivityDrawer user={activityFor} onClose={() => setActivityFor(null)} />
      )}
    </div>
  );
}

const ACTION_STYLE = {
  create: "bg-emerald-50 text-emerald-700",
  update: "bg-amber-50 text-amber-700",
  delete: "bg-rose-50 text-rose-700",
  void: "bg-rose-50 text-rose-700",
  alert: "bg-orange-50 text-orange-700",
  admin_view: "bg-violet-50 text-violet-700",
  login: "bg-slate-100 text-slate-500",
  logout: "bg-slate-100 text-slate-500",
};

function ActivityDrawer({ user, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-activity", user.id],
    queryFn: () => api.get(`/api/admin/users/${user.id}/activity`).then((r) => r.data),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Activity — {user.username}</h3>
            <p className="text-xs text-slate-400">Newest first · who did what, when</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition">✕</button>
        </div>

        {isLoading && <div className="p-8 text-center text-sm text-slate-400">Loading…</div>}

        {data && data.entries.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">No activity yet.</div>
        )}

        <ul className="divide-y divide-slate-50">
          {data?.entries.map((e) => (
            <li key={e.id} className="px-5 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${ACTION_STYLE[e.action] || "bg-slate-100 text-slate-500"}`}>
                  {e.action}
                </span>
                <span className="text-[11px] text-slate-400">{e.module}</span>
                {e.by_admin && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">
                    by admin
                  </span>
                )}
                <span className="ml-auto text-[11px] text-slate-400">
                  {e.when ? new Date(e.when).toLocaleString("en-IN") : ""}
                </span>
              </div>
              <p className="text-sm text-slate-700 mt-1">{e.what}</p>
              {e.changes && Object.keys(e.changes).length > 0 && (
                <div className="mt-1.5 text-xs text-slate-500 space-y-0.5">
                  {Object.entries(e.changes).slice(0, 6).map(([field, ch]) => (
                    <div key={field}>
                      <span className="font-medium">{field}:</span>{" "}
                      <span className="text-rose-500 line-through">{String(ch?.old ?? "—")}</span>{" → "}
                      <span className="text-emerald-600">{String(ch?.new ?? "—")}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-300 mt-1">
                {e.who}{e.request ? ` · ${e.request}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
