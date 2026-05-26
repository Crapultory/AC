import { Navigate, Outlet, useLocation } from "react-router-dom";

import { hasStoredToken } from "../lib/auth";

export function RequireAuth() {
  const location = useLocation();
  if (!hasStoredToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

