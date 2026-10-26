import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthContext";
import { RequireAuth, RequirePlatformAdmin } from "@/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { InviteAcceptPage } from "@/pages/InviteAcceptPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { MembersPage } from "@/pages/MembersPage";
import { BillingPage } from "@/pages/BillingPage";
import { UsagePage } from "@/pages/UsagePage";
import { AuditLogPage } from "@/pages/AuditLogPage";
import { AdminPage } from "@/pages/AdminPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/invite/:token" element={<InviteAcceptPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
            <Route element={<RequirePlatformAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
