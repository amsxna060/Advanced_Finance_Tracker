import React from "react";
import { Link } from "react-router-dom";

/* FB-6.2 — Privacy policy & Terms. Deliberately honest about admin access
   (ADR-3): we say support access exists, is read-only, and is logged —
   we never claim end-to-end encryption we don't have. */

function LegalShell({ title, updated, children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link to="/" className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">
          ← FinancerBuddy
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">{title}</h1>
        <p className="text-xs text-slate-400 mt-1">Last updated: {updated}</p>
        <div className="prose prose-sm prose-slate mt-8 space-y-6 text-slate-700 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
}

const H = ({ children }) => <h2 className="text-base font-semibold text-slate-900 mt-8">{children}</h2>;

export function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="19 July 2026">
      <p>
        FinancerBuddy ("we") provides a personal finance workspace at
        financerbuddy.com. This policy explains what we collect and how we
        handle it, in plain language.
      </p>
      <H>What we collect</H>
      <p>
        Your account details (username, email, name) and the financial records
        you choose to enter — expenses, accounts, contacts, loans, assets and
        similar. We do not connect to your bank; everything in FinancerBuddy is
        data you typed in.
      </p>
      <H>How your data is protected</H>
      <p>
        Every account's data is isolated to that account: other users can never
        see it, and this isolation is enforced in software and covered by
        automated tests on every release. Data is encrypted in transit (HTTPS)
        and at rest by our database provider. Passwords are stored as strong
        one-way hashes (bcrypt).
      </p>
      <H>Support access — the honest part</H>
      <p>
        Platform administrators can view an account's data for support and
        debugging. That access is <strong>read-only</strong> and every such
        view is written into your own activity log — you can always see when
        support looked at your account and why that beats vague promises.
      </p>
      <H>What we never do</H>
      <p>
        We do not sell, rent, or share your data with third parties. We do not
        use it for advertising. We send email only to verify your address and
        for messages you'd expect (e.g. password reset).
      </p>
      <H>Your controls</H>
      <p>
        You can export your records (Reports), disable features you don't use
        (Settings — disabling hides, never deletes), and request account
        deletion by writing to support@financerbuddy.com.
      </p>
      <H>Contact</H>
      <p>Questions: support@financerbuddy.com.</p>
    </LegalShell>
  );
}

export function Terms() {
  return (
    <LegalShell title="Terms of Service" updated="19 July 2026">
      <p>By creating a FinancerBuddy account you agree to these terms.</p>
      <H>The service</H>
      <p>
        FinancerBuddy is a record-keeping tool for personal finances. It is not
        a bank, broker, lender, or financial adviser, and nothing in the app is
        financial advice. Calculations (interest, forecasts, maturity
        projections) are estimates based on the data you enter.
      </p>
      <H>Your account</H>
      <p>
        Keep your credentials safe; you are responsible for activity under your
        account. You must be 18+ and provide a working email address. One
        person may not operate accounts for the purpose of abusing the service.
      </p>
      <H>Acceptable use</H>
      <p>
        Don't attempt to access other users' data, probe or overload the
        service, or use it for unlawful activity. We may suspend accounts that
        do.
      </p>
      <H>Availability & liability</H>
      <p>
        The service is provided "as is", free of charge, without warranties.
        Take your own backups of critical records (Reports → export). To the
        maximum extent permitted by law, our liability is limited to the amount
        you paid us (currently: nothing).
      </p>
      <H>Changes</H>
      <p>
        We may update these terms; material changes will be announced in-app.
        Continued use after a change means acceptance.
      </p>
      <H>Contact</H>
      <p>support@financerbuddy.com</p>
    </LegalShell>
  );
}
