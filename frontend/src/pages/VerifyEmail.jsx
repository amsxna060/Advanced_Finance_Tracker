import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../lib/api";

/** FB-3.3 — landing page for the verification link sent at signup. */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState("verifying"); // verifying | ok | error
  const [message, setMessage] = useState("");
  const requested = useRef(false);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setState("error");
      setMessage("This verification link is incomplete.");
      return;
    }
    if (requested.current) return; // StrictMode double-mount guard
    requested.current = true;
    api
      .post("/api/auth/verify-email", { token })
      .then((resp) => {
        setState("ok");
        setMessage(resp.data.message);
      })
      .catch((err) => {
        setState("error");
        setMessage(err.response?.data?.detail || "Verification failed.");
      });
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 px-4">
      <div className="max-w-md w-full text-center animate-fadeIn">
        <div className="bg-white/[0.07] backdrop-blur-xl rounded-2xl shadow-2xl p-8 border border-white/[0.12]">
          {state === "verifying" && (
            <>
              <div className="w-10 h-10 mx-auto border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-indigo-300/70 text-sm">Verifying your email…</p>
            </>
          )}
          {state === "ok" && (
            <>
              <div className="text-4xl mb-3">✅</div>
              <h2 className="text-lg font-bold text-white mb-2">Email verified</h2>
              <p className="text-indigo-300/60 text-sm mb-6">{message}</p>
              <Link
                to="/login"
                className="inline-block py-3 px-8 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 shadow-lg shadow-indigo-500/25 transition-all"
              >
                Sign in
              </Link>
            </>
          )}
          {state === "error" && (
            <>
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="text-lg font-bold text-white mb-2">Verification failed</h2>
              <p className="text-indigo-300/60 text-sm mb-6">{message}</p>
              <Link
                to="/login"
                className="text-sm font-semibold text-indigo-300 hover:text-white transition-colors"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
