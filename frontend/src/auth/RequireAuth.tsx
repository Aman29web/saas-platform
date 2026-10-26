import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { PageSpinner } from "@/components/ui/Spinner";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function RequirePlatformAdmin() {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user?.isPlatformAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
