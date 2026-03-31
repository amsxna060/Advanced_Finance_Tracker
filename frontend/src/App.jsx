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
import Analytics from "./pages/Analytics/Analytics";
import Forecast from "./pages/Analytics/Forecast";
import Assets from "./pages/Analytics/Assets";
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
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts"
              element={
                <ProtectedRoute>
                  <ContactList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts/new"
              element={
                <ProtectedRoute>
                  <ContactForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts/:id/edit"
              element={
                <ProtectedRoute>
                  <ContactForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/contacts/:id"
              element={
                <ProtectedRoute>
                  <ContactDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans"
              element={
                <ProtectedRoute>
                  <LoanList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/new"
              element={
                <ProtectedRoute>
                  <LoanForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id/edit"
              element={
                <ProtectedRoute>
                  <LoanForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id/statement"
              element={
                <ProtectedRoute>
                  <LoanStatement />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans/:id"
              element={
                <ProtectedRoute>
                  <LoanDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties"
              element={
                <ProtectedRoute>
                  <PropertyList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/new"
              element={
                <ProtectedRoute>
                  <PropertyForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/:id/edit"
              element={
                <ProtectedRoute>
                  <PropertyForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/properties/:id"
              element={
                <ProtectedRoute>
                  <PropertyDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships"
              element={
                <ProtectedRoute>
                  <PartnershipList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/new"
              element={
                <ProtectedRoute>
                  <PartnershipForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/:id/edit"
              element={
                <ProtectedRoute>
                  <PartnershipForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/partnerships/:id"
              element={
                <ProtectedRoute>
                  <PartnershipDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/expenses"
              element={
                <ProtectedRoute>
                  <ExpenseList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <Reports />
                </ProtectedRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <ProtectedRoute>
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="/forecast"
              element={
                <ProtectedRoute>
                  <Forecast />
                </ProtectedRoute>
              }
            />
            <Route
              path="/assets"
              element={
                <ProtectedRoute>
                  <Assets />
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi"
              element={
                <ProtectedRoute>
                  <BeesiList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/new"
              element={
                <ProtectedRoute>
                  <BeesiForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/:id/edit"
              element={
                <ProtectedRoute>
                  <BeesiForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/beesi/:id"
              element={
                <ProtectedRoute>
                  <BeesiDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts"
              element={
                <ProtectedRoute>
                  <AccountList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts/new"
              element={
                <ProtectedRoute>
                  <AccountForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts/:id/edit"
              element={
                <ProtectedRoute>
                  <AccountForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/accounts/:id"
              element={
                <ProtectedRoute>
                  <AccountDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/obligations"
              element={
                <ProtectedRoute>
                  <ObligationList />
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
