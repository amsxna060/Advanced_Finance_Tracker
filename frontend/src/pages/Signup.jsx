import React, { useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import api from "../lib/api";
import { cn } from "../lib/utils";

const inputCls =
  "w-full px-4 py-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-white placeholder-indigo-300/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400/30 transition-all text-sm";
const labelCls =
  "block text-[11px] font-semibold text-indigo-300/80 uppercase tracking-widest mb-2";

export default function Signup() {
  const [form, setForm] = useState({
    full_name: "",
    username: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const { login, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  if (!authLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/signup", {
        username: form.username,
        email: form.email,
        password: form.password,
        full_name: form.full_name || undefined,
      });
      // Auto-login and continue to onboarding. If the deployment requires
      // email verification first, login returns 403 email_not_verified and
      // we show the "check your inbox" screen instead.
      try {
        await login(form.username, form.password);
        navigate("/onboarding");
      } catch (err) {
        if (err.response?.data?.detail === "email_not_verified") {
          setNeedsVerification(true);
        } else {
          navigate("/login");
        }
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail[0]?.msg || "Please check the form and try again.");
      } else {
        setError(detail || "Signup failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (needsVerification) {
    return (
      <Shell>
        <div className="bg-white/[0.07] backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-white/[0.12] text-center">
          <h2 className="text-lg font-bold text-white mb-2">Check your inbox</h2>
          <p className="text-indigo-300/60 text-sm">
            We sent a verification link to <span className="text-white">{form.email}</span>.
            Open it to activate your account, then sign in.
          </p>
          <Link
            to="/login"
            className="inline-block mt-6 text-sm font-semibold text-indigo-300 hover:text-white transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="bg-white/[0.07] backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-white/[0.12]">
        <h2 className="text-lg font-bold text-white mb-1">Create your account</h2>
        <p className="text-indigo-300/50 text-sm mb-6">
          Track expenses, accounts, assets and more — free.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-200 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="full_name" className={labelCls}>Full name</label>
            <input id="full_name" type="text" value={form.full_name}
                   onChange={set("full_name")} className={inputCls}
                   placeholder="Your name" />
          </div>
          <div>
            <label htmlFor="username" className={labelCls}>Username</label>
            <input id="username" type="text" value={form.username}
                   onChange={set("username")} required minLength={3}
                   className={inputCls} placeholder="Pick a username" />
          </div>
          <div>
            <label htmlFor="email" className={labelCls}>Email</label>
            <input id="email" type="email" value={form.email}
                   onChange={set("email")} required className={inputCls}
                   placeholder="you@example.com" />
          </div>
          <div>
            <label htmlFor="password" className={labelCls}>Password</label>
            <input id="password" type="password" value={form.password}
                   onChange={set("password")} required minLength={8}
                   className={inputCls}
                   placeholder="8+ characters, letters and digits" />
          </div>
          <div>
            <label htmlFor="confirm" className={labelCls}>Confirm password</label>
            <input id="confirm" type="password" value={form.confirm}
                   onChange={set("confirm")} required className={inputCls}
                   placeholder="Repeat your password" />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "w-full py-3 px-4 rounded-xl font-semibold text-white transition-all text-sm",
              loading
                ? "bg-indigo-400/30 cursor-not-allowed"
                : "bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-500/25 active:scale-[0.98]",
            )}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="text-center text-indigo-300/50 text-sm mt-6">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-indigo-300 hover:text-white transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 px-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-20 w-[400px] h-[400px] rounded-full bg-violet-600/10 blur-3xl" />
      <div className="max-w-md w-full relative z-10 animate-fadeIn">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">FinancerBuddy</h1>
          <p className="text-indigo-300/60 text-sm mt-1.5 font-medium">
            Your money, organised
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
