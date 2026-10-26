import { NavLink, Outlet } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { OrgSwitcher } from "./OrgSwitcher";
import { cn } from "@/lib/cn";

const navItems = [
  { to: "/", label: "Projects", end: true },
  { to: "/members", label: "Members" },
  { to: "/billing", label: "Billing" },
  { to: "/usage", label: "Usage" },
  { to: "/audit-log", label: "Audit Log" },
];

export function AppShell() {
  const { user, activeRole } = useAuth();
  const logoutMutation = useMutation({ mutationFn: () => apiClient.post("/api/auth/logout") });

  return (
    <div className="min-h-screen bg-slate-50">
      <ImpersonationBanner />
      <div className="flex min-h-screen">
        <aside className="flex w-60 flex-col border-r border-slate-200 bg-white px-4 py-5">
          <div className="mb-6">
            <h1 className="text-lg font-semibold text-slate-900">SaaS Platform</h1>
            <OrgSwitcher />
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100",
                    isActive && "bg-slate-900 text-white hover:bg-slate-900",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            {user?.isPlatformAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    "mt-4 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100",
                    isActive && "border-solid bg-slate-900 text-white hover:bg-slate-900",
                  )
                }
              >
                Platform Admin
              </NavLink>
            )}
          </nav>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
            {activeRole && <p className="text-xs capitalize text-slate-400">{activeRole}</p>}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start px-0"
              loading={logoutMutation.isPending}
              onClick={async () => {
                await logoutMutation.mutateAsync();
                window.location.href = "/login";
              }}
            >
              Log out
            </Button>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
