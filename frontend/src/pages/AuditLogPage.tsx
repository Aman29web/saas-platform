import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/auth/AuthContext";
import type { AuditLogEntry } from "@/types";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";

export function AuditLogPage() {
  const { activeOrgId, activeRole } = useAuth();
  const [actionFilter, setActionFilter] = useState("");
  const canView = activeRole === "owner" || activeRole === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", activeOrgId, actionFilter],
    queryFn: async () =>
      (
        await apiClient.get<AuditLogEntry[]>("/api/audit-log", {
          params: actionFilter ? { action: actionFilter } : undefined,
        })
      ).data,
    enabled: Boolean(activeOrgId) && canView,
  });

  if (!activeOrgId) return <p className="text-sm text-slate-500">No active organization.</p>;
  if (!canView) return <p className="text-sm text-slate-500">You don't have access to the audit log.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-500">Append-only record of sensitive actions in this organization.</p>
      </div>

      <Input
        placeholder="Filter by action (e.g. membership.role_changed)"
        value={actionFilter}
        onChange={(e) => setActionFilter(e.target.value)}
        className="max-w-sm"
      />

      <Card>
        <CardHeader>
          <CardTitle>Events ({data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-slate-100 p-0">
          {isLoading ? (
            <PageSpinner />
          ) : !data || data.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No audit entries found.</p>
          ) : (
            data.map((entry) => (
              <div key={entry._id} className="flex flex-col gap-1 px-5 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900">{entry.action}</span>
                  <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>actor: {entry.actorId}</span>
                  {entry.impersonatorId && <Badge variant="warning">impersonated by {entry.impersonatorId}</Badge>}
                  <span>
                    target: {entry.targetType}/{entry.targetId}
                  </span>
                  {entry.ip && <span>ip: {entry.ip}</span>}
                </div>
                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <pre className="mt-1 max-w-full overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
