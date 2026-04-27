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
const PartnershipList = lazy(() => import("./pages/Partnerships/PartnershipList"));
const PartnershipDetail = lazy(() => import("./pages/Partnerships/PartnershipDetail"));
const PartnershipForm = lazy(() => import("./pages/Partnerships/PartnershipForm"));
const ExpenseList = lazy(() => import("./pages/Expenses/ExpenseList"));
const Reports = lazy(() => import("./pages/Reports/Reports"));
const Forecast = lazy(() => import("./pages/Analytics/Forecast"));
const ExpenseAnalytics = lazy(() => import("./pages/Analytics/ExpenseAnalytics"));
const Reconciliation = lazy(() => import("./pages/Analytics/Reconciliation"));
const NetWorth = lazy(() => import("./pages/Analytics/NetWorth"));
const BeesiList = lazy(() => import("./pages/Beesi/BeesiList"));
const BeesiForm = lazy(() => import("./pages/Beesi/BeesiForm"));
const BeesiDetail = lazy(() => import("./pages/Beesi/BeesiDetail"));
const AccountList = lazy(() => import("./pages/Accounts/AccountList"));
const AccountForm = lazy(() => import("./pages/Accounts/AccountForm"));
const AccountDetail = lazy(() => import("./pages/Accounts/AccountDetail"));
const ObligationList = lazy(() => import("./pages/Obligations/ObligationList"));
const AdminMigration = lazy(() => import("./pages/Admin/AdminMigration"));

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
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
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
                  <Layout>
                    <LoanList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/new"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LoanForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LoanForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id/statement"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LoanStatement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LoanDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PropertyList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/new"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PropertyForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PropertyForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PropertyDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PartnershipList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/new"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PartnershipForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PartnershipForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PartnershipDetail />
                  </Layout>
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
                  <Layout>
                    <Reports />
                  </Layout>
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
                  <Layout>
                    <Forecast />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/expense-analytics"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ExpenseAnalytics />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reconciliation"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Reconciliation />
                  </Layout>
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
                  <Layout>
                    <BeesiList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/new"
              element={
                <ProtectedRoute>
                  <Layout>
                    <BeesiForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <BeesiForm />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <BeesiDetail />
                  </Layout>
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
              path="/admin/migration"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AdminMigration />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
