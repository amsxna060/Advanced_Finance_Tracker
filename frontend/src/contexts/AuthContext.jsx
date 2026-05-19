import React, { createContext, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import api, { setAccessToken, getAccessToken } from "../lib/api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const AuthContext = createContext();

// M-AUTH-10: BroadcastChannel for cross-tab logout sync
const authChannel = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("auth")
  : null;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // M-AUTH-9: handle forced logout triggered by the api interceptor
  const handleForcedLogout = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  const fetchUser = useCallback(async () => {
    try {
      const response = await api.get("/api/auth/me");
      setUser(response.data);
    } catch (error) {
      setAccessToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // C-AUTH-4: On mount, attempt a silent refresh. The httpOnly refresh token cookie
    // is sent automatically (withCredentials). If valid, we get a new access token
    // without the user needing to re-login after a page refresh.
    const trySilentRefresh = async () => {
      try {
        const response = await axios.post(
          `${API_URL}/api/auth/refresh`,
          {},
          { withCredentials: true },
        );
        const { access_token } = response.data;
        setAccessToken(access_token);
        await fetchUser();
      } catch (err) {
        // If the cookie is blacklisted or expired, clear it so login works cleanly next time
        const detail = err?.response?.data?.detail || "";
        if (detail.includes("revoked") || detail.includes("expired") || detail.includes("Invalid")) {
          try {
            await axios.post(`${API_URL}/api/auth/clear-cookie`, {}, { withCredentials: true });
          } catch {
            // ignore — best-effort cleanup
          }
        }
        // No valid refresh cookie — user must log in
        setLoading(false);
      }
    };

    trySilentRefresh();

    // M-AUTH-9: listen for forced logout event from api.js interceptor
    window.addEventListener("auth:logout", handleForcedLogout);

    // M-AUTH-10: sync logout across tabs
    if (authChannel) {
      authChannel.onmessage = (event) => {
        if (event.data === "logout") {
          setAccessToken(null);
          setUser(null);
          navigate("/login", { replace: true });
        }
      };
    }

    return () => {
      window.removeEventListener("auth:logout", handleForcedLogout);
      if (authChannel) {
        authChannel.onmessage = null;
      }
    };
  }, [handleForcedLogout, fetchUser]);

  const login = async (username, password) => {
    const formData = new FormData();
    formData.append("username", username);
    formData.append("password", password);

    const response = await api.post("/api/auth/login", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    const { access_token } = response.data;
    // C-AUTH-4: Store access token in memory only. The refresh token is stored
    // in an httpOnly cookie by the backend — no localStorage involved.
    setAccessToken(access_token);

    // H-SEC-2: Fetch CSRF token after login so admin endpoints have the cookie available
    try {
      await axios.get(`${API_URL}/api/auth/csrf-token`, { withCredentials: true });
    } catch {
      // Non-fatal: admin operations will re-fetch if cookie is missing
    }

    await fetchUser();
    return response.data;
  };

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Proceed with local cleanup even if backend call fails
    }
    setAccessToken(null);
    setUser(null);
    // M-AUTH-10: notify other tabs
    if (authChannel) {
      authChannel.postMessage("logout");
    }
    navigate("/login", { replace: true });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
