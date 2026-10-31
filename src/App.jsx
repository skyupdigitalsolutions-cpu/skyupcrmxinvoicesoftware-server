import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Orders from './pages/Orders.jsx';
import OrderForm from './pages/OrderForm.jsx';
import ChequeCalendar from './pages/ChequeCalendar.jsx';
import Communication from './pages/Communication.jsx';
import Invoices from './pages/Invoices.jsx';
import Tracker from './pages/Tracker.jsx';
import Reports from './pages/Reports.jsx';
import DailyReport from './pages/DailyReport.jsx';
import Users from './pages/Users.jsx';
import Leads from './pages/Leads.jsx';
import DeletedContacts from './pages/DeletedContacts.jsx';
import Chat from './pages/Chat.jsx';
import LeadDetail from './pages/LeadDetail.jsx';
import Attendance from './pages/Attendance.jsx';
import DeveloperDashboard from './pages/DeveloperDashboard.jsx';
import Developer from './pages/Developer.jsx';
import Subscription from './pages/Subscription.jsx';
import SensySettings from './pages/SensySettings.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';

const Shell = ({ children, admin }) => (
  <ProtectedRoute adminOnly={admin}><AppLayout>{children}</AppLayout></ProtectedRoute>
);
const DevShell = ({ children }) => (
  <ProtectedRoute developerOnly><AppLayout>{children}</AppLayout></ProtectedRoute>
);

export default function App() {
  const { user, loading, isDeveloper } = useAuth();
  return (
    <Routes>
      {/* ── Public routes (no auth required) ──────────────────────────────── */}
      <Route path="/login"
        element={user && !loading ? <Navigate to={isDeveloper ? '/developer' : '/dashboard'} replace /> : <Login />}
      />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* ── Developer panel ────────────────────────────────────────────────── */}
      <Route path="/developer"               element={<DevShell><DeveloperDashboard /></DevShell>} />
      <Route path="/developer/companies"     element={<DevShell><Developer /></DevShell>} />
      <Route path="/developer/subscriptions" element={<DevShell><Subscription /></DevShell>} />

      {/* ── Company app ────────────────────────────────────────────────────── */}
      <Route path="/dashboard"        element={<Shell><Dashboard /></Shell>} />
      <Route path="/orders"           element={<Shell><Orders /></Shell>} />
      <Route path="/cheques"          element={<Shell><ChequeCalendar /></Shell>} />
      <Route path="/communication"    element={<Shell><Communication /></Shell>} />
      <Route path="/orders/new"       element={<Shell><OrderForm /></Shell>} />
      <Route path="/orders/:id/edit"  element={<Shell><OrderForm /></Shell>} />
      <Route path="/invoices"         element={<Shell><Invoices /></Shell>} />
      <Route path="/tracker"          element={<Shell><Tracker /></Shell>} />
      <Route path="/leads"            element={<Shell><Leads /></Shell>} />
      <Route path="/deleted-contacts" element={<Shell admin><DeletedContacts /></Shell>} />
      <Route path="/leads/:id"        element={<Shell><LeadDetail /></Shell>} />
      <Route path="/reports"          element={<Shell admin><Reports /></Shell>} />
      <Route path="/daily-report"     element={<Shell><DailyReport /></Shell>} />
      <Route path="/users"            element={<Shell admin><Users /></Shell>} />
      <Route path="/attendance"       element={<Shell><Attendance /></Shell>} />
      <Route path="/chat"             element={<Shell><Chat /></Shell>} />
      <Route path="/purchase-orders"    element={<Shell><PurchaseOrders /></Shell>} />
      <Route path="/integrations/sensy" element={<Shell admin><SensySettings /></Shell>} />
      <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}