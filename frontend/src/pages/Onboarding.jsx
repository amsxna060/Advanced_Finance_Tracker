import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import api from "../lib/api";
import { QUESTIONNAIRE, DEFAULT_MODULES } from "../lib/modules";
import { cn } from "../lib/utils";

/**
 * FB-3.4 — post-signup questionnaire. A handful of yes/no questions decide
 * which optional modules the account starts with. Fully skippable: the
 * default set (core + assets + expense analytics) already works.
 */
export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  const total = QUESTIONNAIRE.length;
  const current = QUESTIONNAIRE[step];

  const finish = async (finalAnswers) => {
    setSaving(true);
    setError("");
    const modules = new Set(DEFAULT_MODULES);
    for (const q of QUESTIONNAIRE) {
      if (finalAnswers[q.id]) q.modules.forEach((m) => modules.add(m));
    }
    try {
      await api.put("/api/auth/me/modules", { modules: [...modules] });
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save your choices.");
      setSaving(false);
    }
  };

  const answer = (value) => {
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    if (step + 1 < total) {
      setStep(step + 1);
    } else {
      finish(next);
    }
  };

  const skip = () => finish(answers);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 px-4">
      <div className="max-w-lg w-full animate-fadeIn">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Let's set up your workspace
          </h1>
          <p className="text-indigo-300/60 text-sm mt-2">
            A few quick questions — we'll only show you the features you need.
            You can change this anytime in Settings.
          </p>
        </div>

        <div className="bg-white/[0.07] backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-white/[0.12]">
          {/* Progress */}
          <div className="flex items-center gap-1.5 mb-6">
            {QUESTIONNAIRE.map((q, i) => (
              <div
                key={q.id}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i < step ? "bg-indigo-400" : i === step ? "bg-indigo-500" : "bg-white/10",
                )}
              />
            ))}
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-200 px-4 py-3 rounded-xl text-sm mb-4">
              {error}
            </div>
          )}

          <p className="text-[11px] font-semibold text-indigo-300/60 uppercase tracking-widest mb-3">
            Question {step + 1} of {total}
          </p>
          <h2 className="text-lg font-bold text-white mb-8 leading-snug">
            {current.question}
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => answer(true)}
              disabled={saving}
              className="py-3 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-500/25 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              Yes
            </button>
            <button
              onClick={() => answer(false)}
              disabled={saving}
              className="py-3 rounded-xl font-semibold text-indigo-200 text-sm bg-white/[0.06] border border-white/[0.1] hover:bg-white/[0.1] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              No
            </button>
          </div>

          <button
            onClick={skip}
            disabled={saving}
            className="w-full mt-6 text-center text-xs text-indigo-300/50 hover:text-indigo-200 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Skip for now — use the standard setup"}
          </button>
        </div>
      </div>
    </div>
  );
}
