import { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RequireAdmin from "./components/RequireAdmin";
import RequireModule from "./components/RequireModule";
import Layout from "./components/Layout";
import Login from "./pages/Login";

// Lazy-load all pages so each route is a separate chunk
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ContactList = lazy(() => import("./pages/Contacts/ContactList"));
const ContactDetail = lazy(() => import("./pages/Contacts/ContactDetail"));
const ContactForm = lazy(() => import("./pages/Contacts/ContactForm"));
const LoanList = lazy(() => import("./pages/Loans/LoanList"));
const LoanDetail = lazy(() => import("./pages/Loans/LoanDetail"));
const LoanForm = lazy(() => import("./pages/Loans/LoanForm"));
const LoanStatement = lazy(() => import("./pages/Loans/LoanStatement"));
const PropertyList = lazy(() => import("./pages/Properties/PropertyList"));
const PropertyDetail = lazy(() => import("./pages/Properties/PropertyDetail"));
const PropertyForm = lazy(() => import("./pages/Properties/PropertyForm"));
const SimulatorPage = lazy(() => import("./pages/Properties/SimulatorPage"));
const PartnershipList = lazy(() => import("./pages/Partnerships/PartnershipList"));
const PartnershipDetail = lazy(() => import("./pages/Partnerships/PartnershipDetail"));
const PartnershipForm = lazy(() => import("./pages/Partnerships/PartnershipForm"));
const ExpenseList = lazy(() => import("./pages/Expenses/ExpenseList"));
const Reports = lazy(() => import("./pages/Reports/Reports"));
const Forecast = lazy(() => import("./pages/Analytics/Forecast"));
const ExpenseAnalytics = lazy(() => import("./pages/Analytics/ExpenseAnalytics"));
const Reconciliation = lazy(() => import("./pages/Analytics/Reconciliation"));
const NetWorth = lazy(() => import("./pages/Analytics/NetWorth"));
const PropertyAnalytics = lazy(() => import("./pages/Analytics/PropertyAnalytics"));
const LoanAnalytics = lazy(() => import("./pages/Analytics/LoanAnalytics"));
const BeesiList = lazy(() => import("./pages/Beesi/BeesiList"));
const BeesiForm = lazy(() => import("./pages/Beesi/BeesiForm"));
const BeesiDetail = lazy(() => import("./pages/Beesi/BeesiDetail"));
const AccountList = lazy(() => import("./pages/Accounts/AccountList"));
const AccountForm = lazy(() => import("./pages/Accounts/AccountForm"));
const AccountDetail = lazy(() => import("./pages/Accounts/AccountDetail"));
const ObligationList = lazy(() => import("./pages/Obligations/ObligationList"));
const ActivityLogs = lazy(() => import("./pages/Logs/ActivityLogs"));
const AdminMigration = lazy(() => import("./pages/Admin/AdminMigration"));
const Signup = lazy(() => import("./pages/Signup"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const Settings = lazy(() => import("./pages/Settings/Settings"));


// Minimal spinner shown while a lazy chunk loads
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <Onboarding />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Settings />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ContactList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts/new"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ContactForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ContactForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ContactDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans"
              element={
                <ProtectedRoute>
                  <RequireModule module="loans">
                  <Layout>
                    <LoanList />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/new"
              element={
                <ProtectedRoute>
                  <RequireModule module="loans">
                  <Layout>
                    <LoanForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id/edit"
              element={
                <ProtectedRoute>
                  <RequireModule module="loans">
                  <Layout>
                    <LoanForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id/statement"
              element={
                <ProtectedRoute>
                  <RequireModule module="loans">
                  <Layout>
                    <LoanStatement />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id"
              element={
                <ProtectedRoute>
                  <RequireModule module="loans">
                  <Layout>
                    <LoanDetail />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties"
              element={
                <ProtectedRoute>
                  <RequireModule module="property">
                  <Layout>
                    <PropertyList />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/new"
              element={
                <ProtectedRoute>
                  <RequireModule module="property">
                  <Layout>
                    <PropertyForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/:id/edit"
              element={
                <ProtectedRoute>
                  <RequireModule module="property">
                  <Layout>
                    <PropertyForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/:id"
              element={
                <ProtectedRoute>
                  <RequireModule module="property">
                  <Layout>
                    <PropertyDetail />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/:id/simulator"
              element={
                <ProtectedRoute>
                  <RequireModule module="property">
                  <Layout>
                    <SimulatorPage />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships"
              element={
                <ProtectedRoute>
                  <RequireModule module="partnerships">
                  <Layout>
                    <PartnershipList />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/new"
              element={
                <ProtectedRoute>
                  <RequireModule module="partnerships">
                  <Layout>
                    <PartnershipForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/:id/edit"
              element={
                <ProtectedRoute>
                  <RequireModule module="partnerships">
                  <Layout>
                    <PartnershipForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/:id"
              element={
                <ProtectedRoute>
                  <RequireModule module="partnerships">
                  <Layout>
                    <PartnershipDetail />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expenses"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ExpenseList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <RequireModule module="reports">
                  <Layout>
                    <Reports />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={<Navigate to="/forecast" replace />}
            />
            <Route
              path="/forecast"
              element={
                <ProtectedRoute>
                  <RequireModule module="forecast">
                  <Layout>
                    <Forecast />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expense-analytics"
              element={
                <ProtectedRoute>
                  <RequireModule module="expense_analytics">
                  <Layout>
                    <ExpenseAnalytics />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reconciliation"
              element={
                <ProtectedRoute>
                  <RequireModule module="reconciliation">
                  <Layout>
                    <Reconciliation />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/net-worth"
              element={
                <ProtectedRoute>
                  <Layout>
                    <NetWorth />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics/property"
              element={
                <ProtectedRoute>
                  <RequireModule module="property">
                  <Layout>
                    <PropertyAnalytics />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics/loans"
              element={
                <ProtectedRoute>
                  <RequireModule module="loans">
                  <Layout>
                    <LoanAnalytics />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/assets"
              element={<Navigate to="/net-worth" replace />}
            />
            <Route
              path="/money-flow"
              element={<Navigate to="/forecast" replace />}
            />
            <Route
              path="/beesi"
              element={
                <ProtectedRoute>
                  <RequireModule module="beesi">
                  <Layout>
                    <BeesiList />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/new"
              element={
                <ProtectedRoute>
                  <RequireModule module="beesi">
                  <Layout>
                    <BeesiForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/:id/edit"
              element={
                <ProtectedRoute>
                  <RequireModule module="beesi">
                  <Layout>
                    <BeesiForm />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/:id"
              element={
                <ProtectedRoute>
                  <RequireModule module="beesi">
                  <Layout>
                    <BeesiDetail />
                  </Layout>
                  </RequireModule>
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AccountList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts/new"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AccountForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AccountForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AccountDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/obligations"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ObligationList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/logs"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ActivityLogs />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/migration"
              element={
                <ProtectedRoute>
                  <RequireAdmin>
                    <Layout>
                      <AdminMigration />
                    </Layout>
                  </RequireAdmin>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
