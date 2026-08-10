import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAdminSessionStore } from '../stores/session-store.js';

export function ProtectedRoute() {
  const isAuthenticated = useAdminSessionStore(
    (state) => state.isAuthenticated,
  );
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
