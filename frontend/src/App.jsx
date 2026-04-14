import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ContactList from "./pages/Contacts/ContactList";
import ContactDetail from "./pages/Contacts/ContactDetail";
import ContactForm from "./pages/Contacts/ContactForm";
import LoanList from "./pages/Loans/LoanList";
import LoanDetail from "./pages/Loans/LoanDetail";
import LoanForm from "./pages/Loans/LoanForm";
import LoanStatement from "./pages/Loans/LoanStatement";
import PropertyList from "./pages/Properties/PropertyList";
import PropertyDetail from "./pages/Properties/PropertyDetail";
import PropertyForm from "./pages/Properties/PropertyForm";
import PartnershipList from "./pages/Partnerships/PartnershipList";
import PartnershipDetail from "./pages/Partnerships/PartnershipDetail";
import PartnershipForm from "./pages/Partnerships/PartnershipForm";
import ExpenseList from "./pages/Expenses/ExpenseList";
import Reports from "./pages/Reports/Reports";
import Forecast from "./pages/Analytics/Forecast";
import ExpenseAnalytics from "./pages/Analytics/ExpenseAnalytics";
import Reconciliation from "./pages/Analytics/Reconciliation";
import NetWorth from "./pages/Analytics/NetWorth";
import BeesiList from "./pages/Beesi/BeesiList";
import BeesiForm from "./pages/Beesi/BeesiForm";
import BeesiDetail from "./pages/Beesi/BeesiDetail";
import AccountList from "./pages/Accounts/AccountList";
import AccountForm from "./pages/Accounts/AccountForm";
import AccountDetail from "./pages/Accounts/AccountDetail";
import ObligationList from "./pages/Obligations/ObligationList";

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
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
