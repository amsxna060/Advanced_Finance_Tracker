import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Route guard for PLATFORM-admin-only pages (role === "admin").
 *
 * Since the E2 authorization rework, "admin" means operator of the platform —
 * normal users own their data via tenancy and never need these pages. Nest
 * inside <ProtectedRoute> (which handles the loading / not-logged-in states);
 * non-admins are bounced to the dashboard rather than shown a broken page.
 */
export default function RequireAdmin({ children }) {
  const { user } = useAuth();

  if (user?.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
