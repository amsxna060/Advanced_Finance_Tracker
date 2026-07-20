import React from "react";
import { Link } from "react-router-dom";

/* FB-6.2 — public landing page at "/" for logged-out visitors. */

const FEATURES = [
  { icon: "💸", title: "Expenses & Accounts", text: "Log daily spending, auto-categorised, across all your bank and cash accounts — with limits and analytics." },
  { icon: "🤝", title: "Loans & Lending", text: "Money you lend or borrow: interest schedules, EMIs, collateral, statements — the whole lifecycle." },
  { icon: "🏘️", title: "Property & Partnerships", text: "Plot deals, buyers, site plans, and profit-splitting with partners — tracked to the rupee." },
  { icon: "🪙", title: "Assets & Net Worth", text: "Gold (live rates), vehicles, FDs & RDs with maturity projections, stocks — one balance sheet." },
  { icon: "🔁", title: "Beesi / Committees", text: "Rotating committee savings with installments and withdrawals, reconciled automatically." },
  { icon: "📊", title: "Forecast & Reports", text: "Cash-flow forecasting, recurring transactions, and PDF/Excel exports when you need them." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 text-white relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-20 w-[400px] h-[400px] rounded-full bg-violet-600/10 blur-3xl" />

      <div className="relative z-10 max-w-5xl mx-auto px-6">
        {/* Nav */}
        <header className="flex items-center justify-between py-6">
          <span className="text-lg font-extrabold tracking-tight">FinancerBuddy</span>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/login" className="text-indigo-200/70 hover:text-white font-medium transition-colors">
              Sign in
            </Link>
            <Link
              to="/signup"
              className="px-4 py-2 rounded-xl font-semibold bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-500/25 transition-all"
            >
              Get started — free
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <section className="text-center pt-16 pb-20">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Your money, organised.
          </h1>
          <p className="mt-5 text-lg text-indigo-200/70 max-w-2xl mx-auto">
            Expenses, accounts, loans, property deals, gold, committees and net
            worth — one workspace that shows <em>only</em> the features you need.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              to="/signup"
              className="px-8 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-500/25 active:scale-[0.98] transition-all"
            >
              Create your free account
            </Link>
          </div>
          <p className="mt-4 text-xs text-indigo-300/40">
            Answer 5 quick questions at signup — we hide everything you don't use.
          </p>
        </section>

        {/* Features */}
        <section className="grid md:grid-cols-3 gap-4 pb-20">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white/[0.06] backdrop-blur rounded-2xl p-6 border border-white/[0.08]">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-white">{f.title}</h3>
              <p className="text-sm text-indigo-200/60 mt-1.5 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </section>

        {/* Privacy strip */}
        <section className="bg-white/[0.05] border border-white/[0.08] rounded-2xl p-6 mb-20 text-center">
          <h2 className="font-semibold">Private by design</h2>
          <p className="text-sm text-indigo-200/60 mt-2 max-w-2xl mx-auto">
            Your data is isolated to your account, encrypted in transit and at
            rest, and never shared with third parties. Platform-admin access for
            support is read-only and logged in your own activity trail — you can
            always see when it happened.
          </p>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/[0.08] py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-indigo-300/40">
          <span>© {new Date().getFullYear()} FinancerBuddy</span>
          <nav className="flex gap-5">
            <Link to="/privacy" className="hover:text-indigo-200 transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-indigo-200 transition-colors">Terms</Link>
            <Link to="/login" className="hover:text-indigo-200 transition-colors">Sign in</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
