import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Spinner from './ui/Spinner.jsx';

export default function ProtectedRoute({ children, adminOnly, developerOnly }) {
  const { user, loading, isAdmin, isDeveloper } = useAuth();
  if (loading) return <Spinner label="Restoring session…" />;
  if (!user) return <Navigate to="/login" replace />;
  // Developers only belong on developer routes; bounce them there from app pages.
  if (isDeveloper && !developerOnly) return <Navigate to="/developer" replace />;
  if (developerOnly && !isDeveloper) return <Navigate to="/dashboard" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}