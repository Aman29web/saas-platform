import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";

export function ImpersonationBanner() {
  const { user, isImpersonating, refresh, activeOrgId } = useAuth();

  const exitMutation = useMutation({
    mutationFn: () => apiClient.post("/api/admin/impersonate/exit", { orgId: activeOrgId }),
    onSuccess: () => refresh(),
  });

  if (!isImpersonating) return null;

  return (
    <div className="flex items-center justify-between bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <span>Impersonating {user?.email} — actions are logged and destructive permissions are blocked.</span>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-900/30 bg-amber-400 text-amber-950 hover:bg-amber-300"
        loading={exitMutation.isPending}
        onClick={() => exitMutation.mutate()}
      >
        Exit impersonation
      </Button>
    </div>
  );
}
