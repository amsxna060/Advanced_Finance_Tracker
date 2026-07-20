import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { hasModule } from "../lib/modules";

/**
 * Route guard for optional modules (FB-3.5). Mirrors the backend's
 * require_module: if the tenant hasn't enabled the module, deep links
 * bounce to the dashboard instead of rendering a page whose API calls
 * would all 403. Nest inside <ProtectedRoute>.
 */
export default function RequireModule({ module, children }) {
  const { user } = useAuth();

  if (!hasModule(user, module)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
